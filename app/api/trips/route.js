// FILE: app/api/trips/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * /api/trips
 *
 * TripStyle B (mode=B):
 * - start/end required
 * - uses Genre #1 as anchor scan across POPULAR_IATAS
 * - builds N-day bucket windows around anchors
 * - scores buckets by counting matched genres in window (genre labels forced to selected genres)
 *
 * Primary goal: protect TM key (avoid 429) via:
 * - Redis-backed GLOBAL throttling (spacing gate)
 * - Circuit breaker on 429
 * - Redis cache for TM responses (canonical key excludes apikey)
 * - Per-request TM call budget (ONLY on cache MISS)
 * - Redis cache for /api/trips final payload (prevents rebuild on back nav)
 */

function json(res, status = 200) {
  return NextResponse.json(res, { status });
}

/* -------------------- Date utils -------------------- */

function parseISODate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const ok =
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d;
  return ok ? dt : null;
}

function formatISODateUTC(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysUTC(dt, days) {
  const x = new Date(dt.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function clampInt(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  const iv = Math.trunc(v);
  if (iv < lo) return lo;
  if (iv > hi) return hi;
  return iv;
}

function ymdAddDays(ymd, days) {
  const dt = parseISODate(ymd);
  if (!dt) return null;
  return formatISODateUTC(addDaysUTC(dt, days));
}

function ymdLessEq(aYMD, bYMD) {
  const a = parseISODate(aYMD);
  const b = parseISODate(bYMD);
  if (!a || !b) return false;
  return a.getTime() <= b.getTime();
}

/* -------------------- Server-side request dedupe/cache -------------------- */

const INFLIGHT = new Map(); // key -> Promise<{ status, payload }>
const TTL_CACHE = new Map(); // key -> { ts, status, payload }

const CACHE_TTL_OK_MS = 45_000;
const CACHE_TTL_429_MS = 6_000;
const CACHE_TTL_ERR_MS = 4_000;

function nowMs() {
  return Date.now();
}

function canonicalKeyFromUrl(rawUrl) {
  const u = new URL(rawUrl);
  const entries = [];
  u.searchParams.forEach((v, k) => entries.push([k, v]));
  entries.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });
  const q = new URLSearchParams();
  for (const [k, v] of entries) q.append(k, v);
  return `${u.pathname}?${q.toString()}`;
}

function setDebugHeaders(res, meta) {
  try {
    res.headers.set("x-eventstack-cache", meta.cache);
    res.headers.set("x-eventstack-cachekey", meta.key);
    res.headers.set("x-eventstack-took-ms", String(meta.tookMs ?? 0));
    res.headers.set("cache-control", "no-store, max-age=0");
  } catch {}
  return res;
}

/* -------------------- Redis (Upstash REST) -------------------- */

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const HAS_REDIS = !!(UPSTASH_URL && UPSTASH_TOKEN);

async function redisCommand(cmd, args) {
  if (!HAS_REDIS) throw new Error("Redis not configured");
  const res = await fetch(`${UPSTASH_URL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command: cmd, args }),
    cache: "no-store",
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  return j?.result;
}

async function redisGet(key) {
  if (!HAS_REDIS) return null;
  try {
    return await redisCommand("GET", [key]);
  } catch {
    return null;
  }
}

async function redisSetEx(key, ttlSeconds, value) {
  if (!HAS_REDIS) return false;
  try {
    await redisCommand("SET", [key, value, "EX", String(ttlSeconds)]);
    return true;
  } catch {
    return false;
  }
}

async function redisExpire(key, ttlSeconds) {
  if (!HAS_REDIS) return false;
  try {
    await redisCommand("EXPIRE", [key, String(ttlSeconds)]);
    return true;
  } catch {
    return false;
  }
}

/* -------------------- Ticketmaster gateway (limiter + breaker + cache) -------------------- */

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_EVENTS = `${TM_BASE}/events.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

// Global throttling: one TM call about every ~950ms across the whole deployment.
const TM_GLOBAL_SPACING_MS = 950;

// Circuit breaker: when we see 429, pause TM calls until this timestamp.
const TM_BREAKER_KEY = "tm:breaker:untilMs";

// Response cache: canonical TM request -> response JSON
const TM_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const TM_CACHE_PREFIX = "tm:resp:v2:"; // bump version whenever keying logic changes

// Memory fallback cache (dev / if Redis down)
const MEM_TM_CACHE = new Map(); // key -> { expMs, value }
const MEM_TM_LAST_CALL = { t: 0 };
let MEM_BREAKER_UNTIL = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Canonicalize TM params deterministically, and NEVER include apikey.
function tmCanonicalCacheKey(params) {
  const entries = [];
  for (const [k, v] of params.entries()) {
    if (String(k).toLowerCase() === "apikey") continue;
    entries.push([String(k), String(v)]);
  }
  entries.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });

  const q = new URLSearchParams();
  for (const [k, v] of entries) q.append(k, v);

  // include path so future endpoints don't collide
  const u = new URL(TM_EVENTS);
  return `${TM_CACHE_PREFIX}${u.pathname}?${q.toString()}`;
}

function parseRetryAfterMs(res) {
  const ra = res?.headers?.get?.("retry-after");
  if (!ra) return null;
  const s = String(ra).trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) return Math.max(0, Number(s)) * 1000;

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;

  const ms = dt.getTime() - Date.now();
  return ms > 0 ? ms : 0;
}

async function breakerUntilMs() {
  if (HAS_REDIS) {
    const v = await redisGet(TM_BREAKER_KEY);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return MEM_BREAKER_UNTIL || 0;
}

async function setBreakerMs(untilMs) {
  const ttlSec = Math.max(5, Math.ceil((untilMs - Date.now()) / 1000));
  if (HAS_REDIS) {
    await redisSetEx(TM_BREAKER_KEY, ttlSec, String(untilMs));
    return;
  }
  MEM_BREAKER_UNTIL = untilMs;
}

async function globalThrottleWait() {
  // Redis-backed spacing gate using a single "next allowed time" key.
  const key = "tm:gate:nextAllowedMs";

  if (HAS_REDIS) {
    const now = Date.now();
    const cur = await redisGet(key);
    const nextAllowed = Number(cur);
    const waitMs =
      Number.isFinite(nextAllowed) && nextAllowed > now ? nextAllowed - now : 0;

    if (waitMs > 0) await sleep(waitMs);

    const next = Date.now() + TM_GLOBAL_SPACING_MS;
    await redisSetEx(key, 5, String(next));
    return;
  }

  // Memory fallback
  const now = Date.now();
  const waitMs = Math.max(0, MEM_TM_LAST_CALL.t + TM_GLOBAL_SPACING_MS - now);
  if (waitMs > 0) await sleep(waitMs);
  MEM_TM_LAST_CALL.t = Date.now();
}

// IMPORTANT: budget is ONLY spent after cache MISS and after breaker check.
async function tmFetchJson(params, { budget, debugArr, tag }) {
  if (!TM_KEY) {
    return {
      ok: false,
      status: 500,
      events: [],
      raw: null,
      safeUrl: null,
      error: "Missing TICKETMASTER_API_KEY",
      budget,
    };
  }

  // Circuit breaker check (before cache miss spend is fine)
  const until = await breakerUntilMs();
  if (until && until > Date.now()) {
    debugArr?.push({
      tag,
      cache: "SKIP",
      status: 429,
      ok: false,
      url: null,
      count: 0,
      remainingBudget: budget?.remaining ?? null,
      error: "TM circuit breaker active (protecting key)",
      breakerUntilMs: until,
    });
    return {
      ok: false,
      status: 429,
      events: [],
      raw: null,
      safeUrl: null,
      error: "TM circuit breaker active (protecting key)",
      budget,
      breakerUntilMs: until,
    };
  }

  // Cache check
  const cacheKey = tmCanonicalCacheKey(params);
  let cached = null;

  if (HAS_REDIS) {
    const str = await redisGet(cacheKey);
    if (str) {
      try {
        cached = JSON.parse(str);
      } catch {}
    }
  } else {
    const m = MEM_TM_CACHE.get(cacheKey);
    if (m && m.expMs > Date.now()) cached = m.value;
  }

  if (cached) {
    const events =
      (Array.isArray(cached?._embedded?.events) && cached._embedded.events) ||
      (Array.isArray(cached?.events) && cached.events) ||
      [];
    debugArr?.push({
      tag,
      cache: "HIT",
      key: cacheKey,
      status: 200,
      ok: true,
      url: null,
      count: events.length,
      remainingBudget: budget?.remaining ?? null,
    });
    return {
      ok: true,
      status: 200,
      events,
      raw: cached,
      safeUrl: null,
      error: null,
      budget,
      cache: "HIT",
    };
  }

  // Budget enforcement ONLY on MISS
  if (budget && budget.remaining <= 0) {
    debugArr?.push({
      tag,
      cache: "MISS",
      key: cacheKey,
      status: 429,
      ok: false,
      url: null,
      count: 0,
      remainingBudget: 0,
      error: "TM budget exhausted (protecting key)",
    });
    return {
      ok: false,
      status: 429,
      events: [],
      raw: null,
      safeUrl: null,
      error: "TM budget exhausted (protecting key)",
      budget,
    };
  }

  // Global throttle before calling TM
  await globalThrottleWait();

  // Spend budget now (only on true miss)
  if (budget) budget.remaining -= 1;

  // Build URL
  params.set("apikey", TM_KEY);
  const url = `${TM_EVENTS}?${params.toString()}`;
  const safeUrl = url.replace(/apikey=[^&]+/i, "apikey=REDACTED");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const raw = await res.json().catch(() => ({}));
    const events =
      (Array.isArray(raw?._embedded?.events) && raw._embedded.events) ||
      (Array.isArray(raw?.events) && raw.events) ||
      [];

    const retryAfterMs = res.status === 429 ? parseRetryAfterMs(res) : null;

    let setOk = null;
    if (res.ok) {
      const str = JSON.stringify(raw);
      if (HAS_REDIS) {
        setOk = await redisSetEx(cacheKey, TM_CACHE_TTL_SECONDS, str);
      } else {
        MEM_TM_CACHE.set(cacheKey, {
          expMs: Date.now() + TM_CACHE_TTL_SECONDS * 1000,
          value: raw,
        });
        setOk = true;
      }
    }

    debugArr?.push({
      tag,
      cache: "MISS",
      key: cacheKey,
      status: res.status,
      ok: res.ok,
      url: safeUrl,
      count: events.length,
      remainingBudget: budget?.remaining ?? null,
      setOk,
    });

    if (res.status === 429) {
      const untilMs = Date.now() + (retryAfterMs != null ? retryAfterMs : 60_000);
      await setBreakerMs(untilMs);
      return {
        ok: false,
        status: 429,
        events: [],
        raw,
        safeUrl,
        error: "Rate limited (429)",
        budget,
        retryAfterMs,
      };
    }

    return {
      ok: res.ok,
      status: res.status,
      events,
      raw,
      safeUrl,
      error: res.ok ? null : `TM error (${res.status})`,
      budget,
    };
  } catch (e) {
    debugArr?.push({
      tag,
      cache: "MISS",
      status: null,
      ok: false,
      url: safeUrl,
      error: String(e?.message || e),
      remainingBudget: budget?.remaining ?? null,
    });
    return {
      ok: false,
      status: null,
      events: [],
      raw: null,
      safeUrl,
      error: String(e?.message || e),
      budget,
    };
  } finally {
    clearTimeout(t);
  }
}

/* -------------------- Airports / where resolution (unchanged) -------------------- */

const AIRPORTS_PATH = path.join(process.cwd(), "public", "airports.min.json");

let AIRPORTS_CACHE = null;
let AIRPORTS_INDEX = null;

function loadAirports() {
  if (AIRPORTS_CACHE && AIRPORTS_INDEX) return { list: AIRPORTS_CACHE, index: AIRPORTS_INDEX };

  try {
    const raw = fs.readFileSync(AIRPORTS_PATH, "utf8");
    const list = JSON.parse(raw);
    const clean = Array.isArray(list) ? list : [];

    const index = new Map();
    for (const a of clean) {
      const iata = String(a?.iata || a?.IATA || "").trim().toUpperCase();
      if (!iata) continue;

      const lat = Number(a?.lat ?? a?.latitude);
      const lon = Number(a?.lon ?? a?.lng ?? a?.longitude);

      index.set(iata, {
        iata,
        name: String(a?.name || a?.airport || a?.city || "").trim(),
        city: String(a?.city || "").trim(),
        region: String(a?.state || a?.region || a?.country || "").trim(),
        country: String(a?.country || "").trim(),
        lat,
        lon,
      });
    }

    AIRPORTS_CACHE = clean;
    AIRPORTS_INDEX = index;
    return { list: AIRPORTS_CACHE, index: AIRPORTS_INDEX };
  } catch {
    AIRPORTS_CACHE = [];
    AIRPORTS_INDEX = new Map();
    return { list: AIRPORTS_CACHE, index: AIRPORTS_INDEX };
  }
}

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseWhereInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return { city: "", region: "" };
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  const city = parts[0] || s;
  const region = parts[1] || "";
  return { city, region };
}

function airportToLabel(a) {
  const city = String(a?.city || "").trim();
  const region = String(a?.region || "").trim();
  const bits = [city, region].filter(Boolean);
  const loc = bits.length ? bits.join(", ") : String(a?.name || "").trim();
  return loc ? `${loc} (${a.iata})` : `${a.iata}`;
}

function resolveCenterFromParams(searchParams) {
  const whereRaw = (searchParams.get("where") || "").trim();
  const iataRaw = (searchParams.get("iata") || "").trim().toUpperCase();
  const latRaw = searchParams.get("lat");
  const lonRaw = searchParams.get("lon");

  const hasLat = latRaw !== null && latRaw !== "";
  const hasLon = lonRaw !== null && lonRaw !== "";

  if (hasLat && hasLon) {
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon, label: "Custom location", source: "latlon" };
    }
    return { error: "Invalid lat/lon. Expected lat and lon numeric.", source: "latlon" };
  }

  const { index } = loadAirports();

  if (iataRaw) {
    const a = index.get(iataRaw);
    if (!a || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) {
      return { error: `Unknown/invalid iata=${iataRaw}`, source: "iata" };
    }
    return { lat: a.lat, lon: a.lon, label: airportToLabel(a), source: "iata", iata: iataRaw };
  }

  if (whereRaw) {
    const { city, region } = parseWhereInput(whereRaw);
    const cityN = norm(city);
    const regionN = norm(region);

    let best = null;

    for (const a of index.values()) {
      const aCity = norm(a.city);
      const aRegion = norm(a.region);
      if (!aCity) continue;

      const cityMatch = aCity === cityN;
      const regionMatch = regionN ? aRegion === regionN : true;

      if (cityMatch && regionMatch && Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
        best = a;
        break;
      }
    }

    if (!best) {
      for (const a of index.values()) {
        const aCity = norm(a.city);
        if (aCity === cityN && Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
          best = a;
          break;
        }
      }
    }

    if (!best) {
      return {
        error: `Could not resolve where="${whereRaw}". Try iata=OAK or where="Oakland, CA".`,
        source: "where",
      };
    }

    return { lat: best.lat, lon: best.lon, label: airportToLabel(best), source: "where", where: whereRaw };
  }

  return null;
}

/* -------------------- Event helpers -------------------- */

function eventLocalDate(e) {
  return e?.dates?.start?.localDate ?? null;
}
function eventName(e) {
  return e?.name ?? "";
}
function eventUrl(e) {
  return e?.url ?? null;
}
function eventCity(e) {
  return e?._embedded?.venues?.[0]?.city?.name ?? null;
}
function eventRegion(e) {
  return (
    e?._embedded?.venues?.[0]?.state?.stateCode ??
    e?._embedded?.venues?.[0]?.country?.countryCode ??
    null
  );
}
function eventLatLon(e) {
  const v = e?._embedded?.venues?.[0];
  const lat = v?.location?.latitude;
  const lon = v?.location?.longitude;
  const la = lat != null ? Number(lat) : NaN;
  const lo = lon != null ? Number(lon) : NaN;
  if (Number.isFinite(la) && Number.isFinite(lo)) return { lat: la, lon: lo };
  return null;
}
function sanitizeDisplayName(name) {
  const raw = String(name || "Event");
  return raw
    .replace(/\*[^*]*\*/g, " ")
    .replace(/[*•|]+/g, " ")
    .replace(/\(([^)]*)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* -------------------- Mode B: Popular destination seed list (IATA) -------------------- */

const POPULAR_IATAS = [
  "JFK","LAX","ORD","YYZ","DCA","SFO","MIA","MCO","LAS","BOS","SAN","YVR","YUL","MSY","SEA","ATL","AUS","DEN","PHL","BNA",
  "IAH","PHX","DFW","SAT","HNL","CHS","SAV","YQB","YYC","YOW","PDX","MSP","STL","BWI","PIT","TPA","CLT","SAF","SLC","YYJ",
  "PVD","MSN","ORF","IND","CLE","MKE","CVG","SDF","MEM","JAX",
];

/* -------------------- Mode B helpers -------------------- */

function dedupeLimit(arr, max) {
  const seen = new Set();
  const out = [];
  for (const g of arr) {
    const k = String(g).toLowerCase();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
    if (out.length >= max) break;
  }
  return out;
}

function parseGenresFromRequest(searchParams) {
  const genreOrder = String(searchParams.get("genreOrder") || "").trim();
  if (genreOrder) {
    const parts = genreOrder.split(",").map((x) => String(x || "").trim()).filter(Boolean);
    return dedupeLimit(parts, 4);
  }

  const sports = (searchParams.getAll("sportsGenres") || []).map((s) => String(s || "").trim()).filter(Boolean);
  const music = (searchParams.getAll("musicGenres") || []).map((s) => String(s || "").trim()).filter(Boolean);
  const combined = [...sports, ...music].filter(Boolean);
  if (combined.length) return dedupeLimit(combined, 4);

  const raw = String(searchParams.get("genres") || "");
  const csv = raw.split(",").map((x) => String(x || "").trim()).filter(Boolean);
  return dedupeLimit(csv, 4);
}

function airportSeedFromIata(index, iata) {
  const a = index.get(iata);
  if (!a) return null;
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return null;

  const regionShort =
    a.region && String(a.region).includes("-") ? String(a.region).split("-")[1] : String(a.region || "");

  const label = [a.city, regionShort].filter(Boolean).join(", ") || airportToLabel(a);

  const cc = String(a.country || "").trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(cc) ? cc : null;

  return {
    key: iata,
    iata,
    label,
    lat: a.lat,
    lon: a.lon,
    country,
  };
}

function normalizeCountryCodes(raw) {
  const s = String(raw || "").trim();
  if (!s) return ["US", "CA"];
  const parts = s
    .split(",")
    .map((x) => String(x || "").trim().toUpperCase())
    .filter(Boolean)
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return parts.length ? parts : ["US", "CA"];
}

// Prefer local-country only when we know it (cuts TM calls ~in half).
function effectiveCountryCodesForSeed(seed, fallbackCountryCodes) {
  const cc = String(seed?.country || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cc)) return [cc];
  return Array.isArray(fallbackCountryCodes) && fallbackCountryCodes.length
    ? fallbackCountryCodes
    : ["US", "CA"];
}

function effectiveCountryCodesForBucket(bucket, fallbackCountryCodes) {
  const cc = String(bucket?.seedCountry || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cc)) return [cc];
  return Array.isArray(fallbackCountryCodes) && fallbackCountryCodes.length
    ? fallbackCountryCodes
    : ["US", "CA"];
}

/**
 * Anchors: query ONLY Genre #1 (classificationName=genre1) for seed city.
 * Uses TM gateway with cache/breaker/budget.
 */
async function fetchGenreAnchorsForSeed({ seed, genre1, startYMD, endYMD, radiusMiles, countryCodes, budget, debugArr }) {
  const anchors = [];
  const perCountry = [];

  const ccs = effectiveCountryCodesForSeed(seed, countryCodes);

  for (const cc of ccs) {
    const p = new URLSearchParams();
    p.set("sort", "date,asc");
    p.set("latlong", `${seed.lat},${seed.lon}`);
    p.set("radius", String(radiusMiles));
    p.set("unit", "miles");
    p.set("startDateTime", `${startYMD}T00:00:00Z`);
    p.set("endDateTime", `${endYMD}T23:59:59Z`);
    p.set("classificationName", genre1);
    p.set("size", "30");
    p.set("page", "0");
    if (cc) p.set("countryCode", cc);

    const r = await tmFetchJson(p, { budget, debugArr, tag: `anchor:${seed.iata}:${cc}:${genre1}` });

    perCountry.push({
      cc,
      ok: !!r.ok,
      status: r.status ?? null,
      count: Array.isArray(r.events) ? r.events.length : 0,
      error: r.error || null,
    });

    if (!r.ok) {
      if (Number(r.status) === 429) break;
      continue;
    }

    const raw = Array.isArray(r.events) ? r.events : [];
    for (const e of raw) {
      const date = eventLocalDate(e);
      const url = eventUrl(e);
      if (!date || !url) continue;

      const ll = eventLatLon(e);
      anchors.push({
        date,
        name: sanitizeDisplayName(eventName(e)),
        location: [eventCity(e), eventRegion(e)].filter(Boolean).join(", "),
        genre: genre1, // force to selected genre
        url,
        ...(ll ? { lat: ll.lat, lon: ll.lon } : null),
      });

      if (anchors.length >= 20) break;
    }

    if (anchors.length >= 20) break;
  }

  return {
    seed,
    anchors,
    anchorCount: anchors.length,
    ok: anchors.length > 0,
    perCountry,
  };
}

function buildBucketCandidatesFromAnchors({ activeSeeds, startYMD, endYMD, tripDays }) {
  const latestStart = ymdAddDays(endYMD, -(tripDays - 1));
  if (!latestStart) return [];

  const byKey = new Map();

  for (const s of activeSeeds) {
    for (const a of s.anchors) {
      const d = a?.date;
      if (!d) continue;

      for (let k = 0; k <= tripDays - 1; k += 1) {
        const ws = ymdAddDays(d, -k);
        if (!ws) continue;

        if (!ymdLessEq(startYMD, ws)) continue;
        if (!ymdLessEq(ws, latestStart)) continue;

        const we = ymdAddDays(ws, tripDays - 1);
        if (!we) continue;

        const key = `${s.key}|${ws}`;
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, {
            key,
            destKey: s.key,
            iata: s.iata,
            label: s.label,
            center: { lat: s.lat, lon: s.lon },
            windowStart: ws,
            windowEnd: we,
            seedAnchorCount: 1,
            seedCountry: s.country || null,
          });
        } else {
          existing.seedAnchorCount += 1;
        }
      }
    }
  }

  return Array.from(byKey.values());
}

/**
 * Bucket fetch (safe version):
 * - query TM per selected genre using classificationName=<genre>
 * - force returned row.genre to exactly that selected genre
 * - de-dupe by url
 * Uses TM gateway (cache/breaker/budget).
 */
async function fetchEventsForBucket({ bucket, radiusMiles, countryCodes, genres, budget, debugArr }) {
  const wanted = Array.isArray(genres) ? genres.map((g) => String(g || "").trim()).filter(Boolean) : [];
  const byUrl = new Map();
  const debug = [];

  const SIZE_PER_QUERY = 120;
  const ccs = effectiveCountryCodesForBucket(bucket, countryCodes);

  for (const cc of ccs) {
    for (const gWanted of wanted) {
      const p = new URLSearchParams();
      p.set("sort", "date,asc");
      p.set("latlong", `${bucket.center.lat},${bucket.center.lon}`);
      p.set("radius", String(radiusMiles));
      p.set("unit", "miles");
      p.set("startDateTime", `${bucket.windowStart}T00:00:00Z`);
      p.set("endDateTime", `${bucket.windowEnd}T23:59:59Z`);
      p.set("classificationName", gWanted);
      p.set("size", String(SIZE_PER_QUERY));
      p.set("page", "0");
      if (cc) p.set("countryCode", cc);

      const r = await tmFetchJson(p, {
        budget,
        debugArr,
        tag: `bucket:${bucket.iata}:${bucket.windowStart}:${cc}:${gWanted}`,
      });

      const raw = Array.isArray(r.events) ? r.events : [];

      debug.push({
        cc,
        genre: gWanted,
        ok: !!r.ok,
        status: r.status ?? null,
        count: raw.length,
        error: r.error || null,
      });

      if (!r.ok) {
        if (Number(r.status) === 429) {
          return { ok: false, status: 429, events: [], debug };
        }
        continue;
      }

      for (const e of raw) {
        const date = eventLocalDate(e);
        const url = eventUrl(e);
        if (!date || !url) continue;

        const ll = eventLatLon(e);
        const row = {
          date,
          name: sanitizeDisplayName(eventName(e)),
          location: [eventCity(e), eventRegion(e)].filter(Boolean).join(", "),
          genre: gWanted, // forced
          url,
          ...(ll ? { lat: ll.lat, lon: ll.lon } : null),
        };

        if (!byUrl.has(url)) byUrl.set(url, row);
      }
    }
  }

  return {
    ok: debug.some((x) => x.ok),
    status: debug.find((x) => x.ok)?.status ?? debug[0]?.status ?? null,
    events: Array.from(byUrl.values()),
    debug,
  };
}

function scoreBucketEvents(genres, events) {
  const gNorm = genres.map((g) => String(g).trim());
  const gLower = gNorm.map((g) => g.toLowerCase());

  const w = [10, 6, 4, 3];

  const counts = new Array(gNorm.length).fill(0);
  const byDay = new Map();

  for (const e of events || []) {
    const g = String(e?.genre || "").trim();
    const d = String(e?.date || "").slice(0, 10);
    if (!g || !d) continue;

    const idx = gLower.indexOf(g.toLowerCase());
    if (idx < 0) continue;

    counts[idx] += 1;
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }

  let score = 0;
  for (let i = 0; i < counts.length; i += 1) score += w[i] * Math.sqrt(counts[i]);

  const uniqueDays = byDay.size;
  score += uniqueDays * 1.5;

  return {
    score,
    breakdown: Object.fromEntries(gNorm.map((g, i) => [g, counts[i]])),
    uniqueDays,
    totalMatched: counts.reduce((a, b) => a + b, 0),
  };
}

/* -------------------- /api/trips output cache (Redis) -------------------- */

const TRIPS_CACHE_TTL_SECONDS = 12 * 60; // 12 minutes
const TRIPS_CACHE_PREFIX = "trips:resp:v1:";

function stableJsonStringify(obj) {
  // deterministic key order for objects
  const seen = new WeakSet();
  const norm = (x) => {
    if (x === null || typeof x !== "object") return x;
    if (seen.has(x)) return null;
    seen.add(x);
    if (Array.isArray(x)) return x.map(norm);
    const out = {};
    for (const k of Object.keys(x).sort()) out[k] = norm(x[k]);
    return out;
  };
  return JSON.stringify(norm(obj));
}

function tripsCacheKeyFromInputs(inputs) {
  // Keep this purely derived from query-relevant inputs + guardrail knobs that change outputs.
  const s = stableJsonStringify(inputs);
  // tiny hash to keep key length reasonable
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${TRIPS_CACHE_PREFIX}${hex}`;
}

async function tripsCacheGet(key) {
  if (!HAS_REDIS) return null;
  const str = await redisGet(key);
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

async function tripsCacheSet(key, payload) {
  if (!HAS_REDIS) return false;
  try {
    const str = JSON.stringify(payload);
    return await redisSetEx(key, TRIPS_CACHE_TTL_SECONDS, str);
  } catch {
    return false;
  }
}

/* -------------------- Core compute -------------------- */

async function computeTrips(req) {
  const { searchParams } = new URL(req.url);

  const tripStyle = String(searchParams.get("tripStyle") || "").trim().toUpperCase();
  const modeRaw = (searchParams.get("mode") || "").trim();
  const mode = (modeRaw || (tripStyle === "B" ? "B" : "1d")).toUpperCase();

  const tripDays = clampInt(searchParams.get("tripDays"), 2, 14, 4);
  const radiusMiles = clampInt(searchParams.get("radiusMiles"), 25, 500, 120);

  const startRaw = searchParams.get("start");
  const endRaw = searchParams.get("end");

  const startDt = parseISODate(startRaw);
  const endDt = parseISODate(endRaw);

  if (!startDt || !endDt) {
    return {
      status: 400,
      payload: {
        error: "Missing/invalid start or end. Expected start=YYYY-MM-DD&end=YYYY-MM-DD",
        received: { start: startRaw, end: endRaw },
      },
    };
  }

  const start = startDt.getTime() <= endDt.getTime() ? startDt : endDt;
  const end = startDt.getTime() <= endDt.getTime() ? endDt : startDt;

  const startYMD = formatISODateUTC(start);
  const endYMD = formatISODateUTC(end);

  const countryCodes = normalizeCountryCodes(searchParams.get("countryCode") || "US,CA");

  const genres = parseGenresFromRequest(searchParams);
  const genre1 = genres[0] || null;

  if (!TM_KEY) {
    return { status: 500, payload: { error: "Missing TICKETMASTER_API_KEY" } };
  }

  // -------------------- Mode B --------------------
  if (mode === "B") {
    if (!genre1) {
      return {
        status: 400,
        payload: { error: "TripStyle B requires Genre #1 (genreOrder=... or sportsGenres/musicGenres or genres=CSV)." },
      };
    }

    // Guardrails (safe defaults)
    const TM_BUDGET_MAX = 18;
    const ACTIVE_CITY_TARGET = 8;
    const ANCHOR_TARGET = 120;
    const BUCKETS_TO_SCORE = 24;

    // Trips output cache key (prevents rebuild on back nav / repeated identical pastes)
    const tripsInputs = {
      mode: "B",
      start: startYMD,
      end: endYMD,
      tripDays,
      radiusMiles,
      genres: [...genres].map(String),
      // normalize ordering to keep key stable
      countryCodes: [...countryCodes].map(String).sort(),
      safety: {
        tmGlobalSpacingMs: TM_GLOBAL_SPACING_MS,
        tmBudgetMax: TM_BUDGET_MAX,
        activeCityTarget: ACTIVE_CITY_TARGET,
        anchorTarget: ANCHOR_TARGET,
        bucketsToScore: BUCKETS_TO_SCORE,
      },
    };

    const tripsKey = tripsCacheKeyFromInputs(tripsInputs);
    const cachedTrips = await tripsCacheGet(tripsKey);
    if (cachedTrips) {
      // Add a tiny hint for debugging without changing payload structure
      if (cachedTrips?.debug?.redis) cachedTrips.debug.redis.tripsCache = "HIT";
      return { status: 200, payload: cachedTrips };
    }

    const budget = { remaining: TM_BUDGET_MAX };

    const { index } = loadAirports();
    const seedList = [];
    for (const iata of POPULAR_IATAS) {
      const seed = airportSeedFromIata(index, iata);
      if (!seed) continue;
      seedList.push(seed);
    }

    const debug = {
      mode: "B",
      redis: { enabled: HAS_REDIS, tripsCache: "MISS", tripsKey },
      inputs: { start: startYMD, end: endYMD, tripDays, radiusMiles, genres, countryCodes },
      safety: {
        tmGlobalSpacingMs: TM_GLOBAL_SPACING_MS,
        tmBudgetMax: TM_BUDGET_MAX,
        activeCityTarget: ACTIVE_CITY_TARGET,
        anchorTarget: ANCHOR_TARGET,
        bucketsToScore: BUCKETS_TO_SCORE,
      },
      scan: { totalSeeds: seedList.length, scanned: 0, activeCities: 0, anchorsCollected: 0, stopReason: null },
      tm: { calls: [], anchorChecks: [], bucketFetches: [] },
    };

    // If breaker already active, bail early with friendly response
    const breaker = await breakerUntilMs();
    if (breaker && breaker > Date.now()) {
      const payload = {
        ok: false,
        tripStyle: "B",
        mode: "B",
        constraints: { start: startYMD, end: endYMD, tripDays, radiusMiles, genres, countryCodes },
        count: 0,
        trips: [],
        error: `Ticketmaster is throttling right now. Try again in ~${Math.ceil((breaker - Date.now()) / 1000)}s.`,
        debug: { ...debug, breakerUntilMs: breaker, remainingBudget: budget.remaining },
      };
      // cache the throttled response briefly (optional)
      await tripsCacheSet(tripsKey, payload);
      return { status: 200, payload };
    }

    const active = [];
    let scanned = 0;

    // Sequential scan (safe): find active cities with Genre #1 anchors
    for (const seed of seedList) {
      if (budget.remaining <= 0) {
        debug.scan.stopReason = "tmBudgetExhausted";
        break;
      }

      const r = await fetchGenreAnchorsForSeed({
        seed,
        genre1,
        startYMD,
        endYMD,
        radiusMiles,
        countryCodes,
        budget,
        debugArr: debug.tm.calls,
      });

      scanned += 1;
      debug.scan.scanned = scanned;

      debug.tm.anchorChecks.push({
        iata: r.seed?.iata || null,
        label: r.seed?.label || null,
        ok: !!r.ok,
        anchorCount: r.anchorCount,
        perCountry: r.perCountry || [],
        remainingBudget: budget.remaining,
      });

      if (r.ok && r.anchorCount > 0) {
        active.push({ ...r.seed, anchors: r.anchors });
        debug.scan.activeCities = active.length;
        debug.scan.anchorsCollected += r.anchorCount;
      }

      if (active.length >= ACTIVE_CITY_TARGET) {
        debug.scan.stopReason = `activeCities>=${ACTIVE_CITY_TARGET}`;
        break;
      }
      if (debug.scan.anchorsCollected >= ANCHOR_TARGET) {
        debug.scan.stopReason = `anchorsCollected>=${ANCHOR_TARGET}`;
        break;
      }

      // If breaker tripped mid-scan, stop immediately
      const b2 = await breakerUntilMs();
      if (b2 && b2 > Date.now()) {
        debug.scan.stopReason = "breakerTrippedDuringAnchorScan";
        break;
      }
    }

    if (!debug.scan.stopReason) debug.scan.stopReason = "scannedAllSeeds";

    if (active.length === 0) {
      const b3 = await breakerUntilMs();
      const errMsg =
        b3 && b3 > Date.now()
          ? `Ticketmaster throttled. Try again in ~${Math.ceil((b3 - Date.now()) / 1000)}s.`
          : null;

      const payload = {
        ok: true,
        tripStyle: "B",
        mode: "B",
        constraints: { start: startYMD, end: endYMD, tripDays, radiusMiles, genres, countryCodes },
        count: 0,
        trips: [],
        ...(errMsg ? { error: errMsg } : null),
        debug: { ...debug, breakerUntilMs: b3 || 0, remainingBudget: budget.remaining },
      };

      await tripsCacheSet(tripsKey, payload);
      return { status: 200, payload };
    }

    // Build buckets around anchors
    let buckets = buildBucketCandidatesFromAnchors({ activeSeeds: active, startYMD, endYMD, tripDays });

    buckets.sort((a, b) => {
      if (b.seedAnchorCount !== a.seedAnchorCount) return b.seedAnchorCount - a.seedAnchorCount;
      return POPULAR_IATAS.indexOf(a.iata) - POPULAR_IATAS.indexOf(b.iata);
    });

    const toScore = buckets.slice(0, Math.max(10, Math.min(BUCKETS_TO_SCORE, buckets.length)));

    const scored = [];

    for (const bucket of toScore) {
      if (budget.remaining <= 0) break;

      const fetch = await fetchEventsForBucket({
        bucket,
        radiusMiles,
        countryCodes,
        genres,
        budget,
        debugArr: debug.tm.calls,
      });

      debug.tm.bucketFetches.push({
        bucketKey: bucket.key,
        iata: bucket.iata,
        windowStart: bucket.windowStart,
        windowEnd: bucket.windowEnd,
        ok: !!fetch.ok,
        status: fetch.status,
        debug: fetch.debug,
        eventCount: Array.isArray(fetch.events) ? fetch.events.length : 0,
        remainingBudget: budget.remaining,
      });

      if (!fetch.ok) {
        const b = await breakerUntilMs();
        if (Number(fetch.status) === 429 || (b && b > Date.now())) break;
        continue;
      }

      const s = scoreBucketEvents(genres, fetch.events);

      // Ensure Genre #1 exists in bucket
      const g1Lower = String(genre1).toLowerCase();
      const hasG1 = (fetch.events || []).some((e) => String(e?.genre || "").toLowerCase() === g1Lower);
      if (!hasG1) continue;

      const anchorEvent =
        (fetch.events || []).find((e) => String(e?.genre || "").toLowerCase() === g1Lower) || null;

      const sampleEvents = (fetch.events || [])
        .filter((e) => genres.some((g) => String(g).toLowerCase() === String(e?.genre || "").toLowerCase()))
        .slice(0, 12)
        .map((e) => ({
          date: e.date,
          name: e.name,
          location: e.location,
          genre: e.genre,
          url: e.url,
          ...(Number.isFinite(e.lat) && Number.isFinite(e.lon) ? { lat: e.lat, lon: e.lon } : {}),
        }));

      const openQs = new URLSearchParams();
      openQs.set("tripStyle", "B");
      openQs.set("destIata", bucket.iata);
      openQs.set("destCityLabel", bucket.label);
      openQs.set("lat", String(bucket.center.lat));
      openQs.set("lon", String(bucket.center.lon));
      openQs.set("start", bucket.windowStart);
      openQs.set("end", bucket.windowEnd);
      openQs.set("radiusMiles", String(radiusMiles));
      openQs.set("countryCode", countryCodes.join(","));
      openQs.set("genreOrder", genres.join(","));
      for (const g of genres) openQs.append("musicGenres", g);

      scored.push({
        id: `b_${bucket.iata}_${bucket.windowStart}_${bucket.windowEnd}`,
        dest: { iata: bucket.iata, label: bucket.label, lat: bucket.center.lat, lon: bucket.center.lon },
        windowStart: bucket.windowStart,
        windowEnd: bucket.windowEnd,
        tripDays,
        radiusMiles,
        score: Math.round(s.score * 100) / 100,
        breakdown: s.breakdown,
        uniqueDays: s.uniqueDays,
        totalMatched: s.totalMatched,
        seedAnchorCount: bucket.seedAnchorCount,
        anchorEvent: anchorEvent
          ? { date: anchorEvent.date, name: anchorEvent.name, genre: anchorEvent.genre, url: anchorEvent.url }
          : null,
        sampleEvents,
        reasons: [
          `Includes Genre #1 anchor: ${genre1}`,
          `Matched events: ${s.totalMatched} across ${s.uniqueDays} day(s)`,
          `Within ${radiusMiles} miles of ${bucket.label}`,
        ],
        openUrl: `/events?${openQs.toString()}`,
      });

      if (scored.length >= 10) break;
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 10);

    const breakerNow = await breakerUntilMs();
    const warning =
      breakerNow && breakerNow > Date.now()
        ? `TM throttled during processing. Returning best-so-far. Try again in ~${Math.ceil((breakerNow - Date.now()) / 1000)}s for fuller results.`
        : null;

    const payload = {
      ok: true,
      tripStyle: "B",
      mode: "B",
      constraints: { start: startYMD, end: endYMD, tripDays, radiusMiles, genres, countryCodes },
      count: top.length,
      trips: top,
      ...(warning ? { warning } : null),
      debug: { ...debug, breakerUntilMs: breakerNow || 0, remainingBudget: budget.remaining },
    };

    await tripsCacheSet(tripsKey, payload);
    return { status: 200, payload };
  }

  // -------------------- Non-B modes (unchanged fallback) --------------------

  const center = resolveCenterFromParams(searchParams);
  if (center?.error) {
    return {
      status: 400,
      payload: {
        error: center.error,
        received: {
          where: searchParams.get("where") || null,
          iata: searchParams.get("iata") || null,
          lat: searchParams.get("lat") || null,
          lon: searchParams.get("lon") || null,
        },
      },
    };
  }

  const candidates = [];
  let cursor = new Date(start.getTime());
  const lastPossibleStart = addDaysUTC(end, -(tripDays - 1));

  while (cursor.getTime() <= lastPossibleStart.getTime()) {
    const windowStart = new Date(cursor.getTime());
    const windowEnd = addDaysUTC(windowStart, tripDays - 1);

    const dayIndex = Math.round((windowStart.getTime() - start.getTime()) / 86400000);
    const score = Math.max(0, 100 - dayIndex) + Math.min(genres.length, 4) * 5 + (center ? 7 : 0);

    const id = `win_${formatISODateUTC(windowStart)}_${formatISODateUTC(windowEnd)}${
      center ? `_near_${Math.round(center.lat * 100) / 100}_${Math.round(center.lon * 100) / 100}` : ""
    }`;

    const reasons = [
      `Fixed ${tripDays}-day window`,
      `Within ${radiusMiles} miles`,
      genres.length ? `Genres: ${genres.slice(0, 4).join(", ")}` : "No genres selected",
    ];

    if (center) reasons.unshift(`Destination center: ${center.label}`);

    candidates.push({
      id,
      windowStart: formatISODateUTC(windowStart),
      windowEnd: formatISODateUTC(windowEnd),
      tripDays,
      radiusMiles,
      score,
      reasons,
      buildTripParams: {
        start: formatISODateUTC(windowStart),
        end: formatISODateUTC(windowEnd),
        tripDays,
        radiusMiles,
        genres,
        mode: modeRaw || "1d",
        ...(center?.source === "latlon" ? { lat: String(center.lat), lon: String(center.lon) } : null),
        ...(center?.source === "iata" ? { iata: center.iata } : null),
        ...(center?.source === "where" ? { where: center.where } : null),
      },
    });

    cursor = addDaysUTC(cursor, 1);
  }

  return {
    status: 200,
    payload: {
      ok: true,
      mode: modeRaw || "1d",
      constraints: {
        start: startYMD,
        end: endYMD,
        tripDays,
        radiusMiles,
        genres,
        destination: center ? { source: center.source, label: center.label, lat: center.lat, lon: center.lon } : null,
      },
      count: candidates.length,
      candidates,
    },
  };
}

/* -------------------- Handler (with dedupe/cache) -------------------- */

export async function GET(req) {
  const t0 = nowMs();
  const key = canonicalKeyFromUrl(req.url);

  const cached = TTL_CACHE.get(key);
  if (cached) {
    const age = nowMs() - cached.ts;
    const ttl =
      cached.status === 200 ? CACHE_TTL_OK_MS : cached.status === 429 ? CACHE_TTL_429_MS : CACHE_TTL_ERR_MS;

    if (age >= 0 && age <= ttl) {
      const res = NextResponse.json(cached.payload, { status: cached.status });
      return setDebugHeaders(res, { cache: "HIT", key, tookMs: nowMs() - t0 });
    } else {
      TTL_CACHE.delete(key);
    }
  }

  const inflight = INFLIGHT.get(key);
  if (inflight) {
    const { status, payload } = await inflight;
    const res = NextResponse.json(payload, { status });
    return setDebugHeaders(res, { cache: "INFLIGHT", key, tookMs: nowMs() - t0 });
  }

  const p = (async () => {
    try {
      return await computeTrips(req);
    } catch (e) {
      return { status: 500, payload: { error: "Trips API error", detail: String(e?.message || e) } };
    }
  })();

  INFLIGHT.set(key, p);

  const { status, payload } = await p.finally(() => {
    INFLIGHT.delete(key);
  });

  TTL_CACHE.set(key, { ts: nowMs(), status, payload });

  const res = NextResponse.json(payload, { status });
  return setDebugHeaders(res, { cache: "MISS", key, tookMs: nowMs() - t0 });
}