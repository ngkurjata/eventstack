// FILE: app/api/trips/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";

/**
 * /api/trips (F1-required Unified Engine)
 *
 * NEW contract:
 * - F1 (Favorite 1) is REQUIRED. The UI enforces it, but API also enforces it.
 * - We DO NOT support "genre-only" scenarios anymore (G1-only, G1+G2-only removed).
 * - Every returned trip window MUST contain at least 1 Favorite anchor event (F1 or F2).
 *
 * Premium behavior (NEW in this version):
 * - Premium is NOT a general “nearby” firehose.
 * - Premium only fills gaps when anchor density is low.
 * - “Strict premium” = either (min ticket price >= threshold) OR (big-venue heuristic) when price absent.
 * - Optional: includeAll=1 returns all events in window for reveal/hide UI toggle.
 *
 * Selection rules:
 * - If F1 only: rank windows containing F1.
 * - If F1 + F2: Option A
 *   - pick crossover(F1+F2) first
 *   - then split remaining between F1-only and F2-only
 *   - then backfill best remaining
 *
 * Diversity rules:
 * - Only when NO city seeds are provided (no-city search):
 *   - max 2 trips per city
 *   - city cooldown gap = 14 days (based on trip start date vs previous trip end date)
 * - Date spreading is ONLY enforced within the same city (no global spread).
 *
 * Performance:
 * - Hard cap: 25 Ticketmaster calls per request (includes attraction resolve + event calls).
 */

/* -------------------- Response helpers -------------------- */

function json(res, status = 200) {
  return NextResponse.json(res, { status });
}

/* -------------------- Date utils (UTC) -------------------- */

function parseISODate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const [y, m, d] = String(s)
    .split("-")
    .map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
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

function addMonthsUTC(dt, months) {
  const x = new Date(dt.getTime());
  x.setUTCMonth(x.getUTCMonth() + months);
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

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function tomorrowUTC() {
  return addDaysUTC(todayUTC(), 1);
}

function daysBetweenInclusiveUTC(aDt, bDt) {
  const ms = bDt.getTime() - aDt.getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

/**
 * Unified window rules (handles missing start/end):
 * - none: [tomorrow .. tomorrow+6 months]
 * - start only: [max(start, tomorrow) .. start+6 months]
 * - end only: [tomorrow .. max(end, tomorrow)]
 * - both: [max(start, tomorrow) .. max(end, start)]
 */
function resolveDateWindow({ startRaw, endRaw }) {
  const startIn = parseISODate(startRaw);
  const endIn = parseISODate(endRaw);
  const tmr = tomorrowUTC();

  const start = startIn && startIn.getTime() < tmr.getTime() ? tmr : startIn;

  if (!start && !endIn) {
    const s = tmr;
    const e = addMonthsUTC(s, 6);
    return { startDt: s, endDt: e, startYMD: formatISODateUTC(s), endYMD: formatISODateUTC(e) };
  }

  if (start && !endIn) {
    const s = start;
    const e = addMonthsUTC(s, 6);
    return { startDt: s, endDt: e, startYMD: formatISODateUTC(s), endYMD: formatISODateUTC(e) };
  }

  if (!start && endIn) {
    const s = tmr;
    const e = endIn.getTime() < s.getTime() ? s : endIn;
    return { startDt: s, endDt: e, startYMD: formatISODateUTC(s), endYMD: formatISODateUTC(e) };
  }

  const s = start || tmr;
  const e0 = endIn || addMonthsUTC(s, 6);
  const e = e0.getTime() < s.getTime() ? s : e0;
  return { startDt: s, endDt: e, startYMD: formatISODateUTC(s), endYMD: formatISODateUTC(e) };
}

/* -------------------- Server-side request dedupe/cache (memory) -------------------- */

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
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
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

/* -------------------- Hash helpers -------------------- */

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

/* -------------------- Ticketmaster gateway (limiter + breaker + cache) -------------------- */

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_EVENTS = `${TM_BASE}/events.json`;
const TM_ATTRACTIONS = `${TM_BASE}/attractions.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

const TM_GLOBAL_SPACING_MS = 950;
const TM_BREAKER_KEY = "tm:breaker:untilMs";

const TM_CACHE_TTL_SECONDS = 6 * 60 * 60;
const TM_CACHE_PREFIX = "tm:resp:v2:";

const MEM_TM_CACHE = new Map(); // key -> { expMs, value }
const MEM_TM_LAST_CALL = { t: 0 };
let MEM_BREAKER_UNTIL = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeTmCacheKeyFromParams(params) {
  const u = new URL(TM_EVENTS);
  for (const [k, v] of params.entries()) {
    if (k.toLowerCase() === "apikey") continue;
    u.searchParams.append(k, v);
  }
  const entries = [];
  u.searchParams.forEach((v, k) => entries.push([k, v]));
  entries.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });
  const q = new URLSearchParams();
  for (const [k, v] of entries) q.append(k, v);
  const canonical = `${u.pathname}?${q.toString()}`;
  return `${TM_CACHE_PREFIX}${sha1(canonical)}`;
}

/** UPDATED: keep priceRanges + classifications so we can do strict premium */
function pruneTmEvent(e) {
  const v = e?._embedded?.venues?.[0] || null;
  const city = v?.city?.name ?? null;
  const state = v?.state?.stateCode ?? null;
  const country = v?.country?.countryCode ?? null;
  const lat = v?.location?.latitude ?? null;
  const lon = v?.location?.longitude ?? null;

  return {
    id: e?.id ?? null,
    name: e?.name ?? "",
    url: e?.url ?? null,
    dates: { start: { localDate: e?.dates?.start?.localDate ?? null, localTime: e?.dates?.start?.localTime ?? null } },

    // premium signals
    priceRanges: Array.isArray(e?.priceRanges) ? e.priceRanges : [],
    classifications: Array.isArray(e?.classifications) ? e.classifications : [],

    _embedded: {
      venues: [
        {
          id: v?.id ?? null,
          name: v?.name ?? null,
          city: { name: city },
          state: { stateCode: state },
          country: { countryCode: country },
          location: { latitude: lat, longitude: lon },
        },
      ],
    },
  };
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
  const key = "tm:gate:nextAllowedMs";

  if (HAS_REDIS) {
    const now = Date.now();
    const cur = await redisGet(key);
    const nextAllowed = Number(cur);
    const waitMs = Number.isFinite(nextAllowed) && nextAllowed > now ? nextAllowed - now : 0;

    if (waitMs > 0) await sleep(waitMs);

    const next = Date.now() + TM_GLOBAL_SPACING_MS;
    await redisSetEx(key, 5, String(next));
    return;
  }

  const now = Date.now();
  const waitMs = Math.max(0, MEM_TM_LAST_CALL.t + TM_GLOBAL_SPACING_MS - now);
  if (waitMs > 0) await sleep(waitMs);
  MEM_TM_LAST_CALL.t = Date.now();
}

async function tmFetchJson(params, { budget, debugArr, tag }) {
  if (!TM_KEY) return { ok: false, status: 500, events: [], error: "Missing TICKETMASTER_API_KEY", budget };

  if (budget.remaining <= 0) {
    return { ok: false, status: 429, events: [], error: "TM budget exhausted (hard cap 25)", budget };
  }

  const until = await breakerUntilMs();
  if (until && until > Date.now()) {
    return { ok: false, status: 429, events: [], error: "TM circuit breaker active", budget, breakerUntilMs: until };
  }

  const cacheKey = safeTmCacheKeyFromParams(params);
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
    const events = Array.isArray(cached?.events) ? cached.events : [];
    debugArr?.push({ tag, cache: "HIT", key: cacheKey, count: events.length, remainingBudget: budget.remaining });
    return { ok: true, status: 200, events, error: null, budget, cache: "HIT" };
  }

  await globalThrottleWait();
  budget.remaining -= 1;

  params.set("apikey", TM_KEY);
  const url = `${TM_EVENTS}?${params.toString()}`;
  const safeUrl = url.replace(/apikey=[^&]+/i, "apikey=REDACTED");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const raw = await res.json().catch(() => ({}));

    const eventsRaw =
      (Array.isArray(raw?._embedded?.events) && raw._embedded.events) ||
      (Array.isArray(raw?.events) && raw.events) ||
      [];

    const events = eventsRaw.map(pruneTmEvent);
    const retryAfterMs = res.status === 429 ? parseRetryAfterMs(res) : null;

    if (res.status === 429) {
      const untilMs = Date.now() + (retryAfterMs != null ? retryAfterMs : 60_000);
      await setBreakerMs(untilMs);

      debugArr?.push({ tag, cache: "MISS", key: cacheKey, status: 429, ok: false, url: safeUrl, count: 0 });
      return { ok: false, status: 429, events: [], error: "Rate limited (429)", budget, retryAfterMs };
    }

    if (res.ok) {
      const cacheObj = { events };
      const str = JSON.stringify(cacheObj);

      if (HAS_REDIS) await redisSetEx(cacheKey, TM_CACHE_TTL_SECONDS, str);
      else MEM_TM_CACHE.set(cacheKey, { expMs: Date.now() + TM_CACHE_TTL_SECONDS * 1000, value: cacheObj });
    }

    debugArr?.push({
      tag,
      cache: "MISS",
      key: cacheKey,
      status: res.status,
      ok: res.ok,
      url: safeUrl,
      count: events.length,
    });
    return { ok: res.ok, status: res.status, events, error: res.ok ? null : `TM error (${res.status})`, budget };
  } catch (e) {
    debugArr?.push({ tag, cache: "MISS", key: cacheKey, status: null, ok: false, error: String(e?.message || e) });
    return { ok: false, status: null, events: [], error: String(e?.message || e), budget };
  } finally {
    clearTimeout(t);
  }
}

/* -------------------- Attractions resolve (server-side) -------------------- */

function pruneTmAttraction(a) {
  return {
    id: a?.id ?? null,
    name: a?.name ?? "",
    classifications: a?.classifications ?? [],
    type: a?.type ?? null,
    url: a?.url ?? null,
  };
}

function looksLikeLeagueMatch(classifications, league) {
  if (!league) return true;
  const want = String(league).toUpperCase();
  const cls = Array.isArray(classifications) ? classifications : [];
  const blob = JSON.stringify(cls).toUpperCase();
  return blob.includes(want);
}

async function resolveAttractionIdServerSide({ keyword, league, budget, debugArr }) {
  const q = String(keyword || "").trim();
  if (!q) return null;
  if (!TM_KEY) return null;
  if (budget.remaining <= 0) return null;

  await globalThrottleWait();
  budget.remaining -= 1;

  const p = new URLSearchParams();
  p.set("apikey", TM_KEY);
  p.set("keyword", q);
  p.set("size", "10");
  p.set("sort", "relevance,desc");

  const url = `${TM_ATTRACTIONS}?${p.toString()}`;
  const safeUrl = url.replace(/apikey=[^&]+/i, "apikey=REDACTED");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const raw = await res.json().catch(() => ({}));

    if (res.status === 429) {
      const ra = parseRetryAfterMs(res);
      const untilMs = Date.now() + (ra != null ? ra : 60_000);
      await setBreakerMs(untilMs);
      debugArr?.push({ tag: "attr:resolve", ok: false, status: 429, url: safeUrl });
      return null;
    }

    const arr = Array.isArray(raw?._embedded?.attractions) ? raw._embedded.attractions : [];
    const atts = arr.map(pruneTmAttraction);

    let best = null;
    if (league) best = atts.find((a) => looksLikeLeagueMatch(a.classifications, league)) || null;
    if (!best) best = atts[0] || null;

    debugArr?.push({
      tag: "attr:resolve",
      ok: res.ok,
      status: res.status,
      url: safeUrl,
      keyword: q,
      league: league || null,
      picked: best?.id || null,
      pickedName: best?.name || null,
    });

    return best?.id || null;
  } catch (e) {
    debugArr?.push({ tag: "attr:resolve", ok: false, status: null, url: safeUrl, error: String(e?.message || e) });
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* -------------------- General helpers for event parsing -------------------- */

function eventLocalDate(e) {
  return e?.dates?.start?.localDate ?? null;
}
function eventLocalTime(e) {
  return e?.dates?.start?.localTime ?? null;
}
function eventName(e) {
  return e?.name ?? "";
}
function eventUrl(e) {
  return e?.url ?? null;
}
function venueName(e) {
  return e?._embedded?.venues?.[0]?.name ?? null;
}
function eventCity(e) {
  return e?._embedded?.venues?.[0]?.city?.name ?? null;
}
function eventRegion(e) {
  return e?._embedded?.venues?.[0]?.state?.stateCode ?? e?._embedded?.venues?.[0]?.country?.countryCode ?? null;
}
function eventCountry(e) {
  return e?._embedded?.venues?.[0]?.country?.countryCode ?? null;
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

/* -------------------- Event cleanup: noise + strict dedupe -------------------- */

function normStr(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// OPTIONAL personal exclusion
function isNoiseEvent(e) {
  const n = normStr(e?.name);
  if (!n) return true;

  // Personal content exclusion
  if (/\bdrag show\b/i.test(e?.name || "")) return true;

  const t = String(e?.localTime || "").trim();
  const looksMidnight = t === "00:00:00" || t === "00:00";

  const noise =
    /\b(deposit|ticket deposit|season deposit|payment|payment plan|initial payment|late fee|fee|service fee|convenience fee|plan|pick plan|renewal|invoice)\b/.test(
      n
    ) ||
    /\b(season ticket|half season|full season|membership)\b/.test(n) ||
    /\b(voucher|vouchers|levy items?|pass guest|parking)\b/.test(n) ||
    /\b(gift cards?|group(s)? sales?|groups? gift cards?)\b/.test(n);

  if (looksMidnight && noise) return true;
  if (noise) return true;

  return false;
}

function canonicalizeTitleForDedupe(name) {
  let s = String(name || "");

  s = s.replace(/\bacfc\b/gi, "Angel City FC");
  s = s.replace(/\*[^*]*\*/g, " ");
  s = s.replace(/^(pinstripe pass|premium seating)\s+/i, "");
  s = s.replace(/\b(premium seating)\b/gi, " ");
  s = s.replace(/\bv\.\b/gi, "vs");
  s = s.replace(/[*•|]+/g, " ").replace(/\s+/g, " ").trim();

  return s;
}

function timeBucketHHMM(localTime, bucketMinutes = 30) {
  const t = String(localTime || "").trim();
  if (!t) return "no-time";
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "no-time";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "no-time";
  const total = hh * 60 + mm;
  const b = Math.floor(total / bucketMinutes) * bucketMinutes;
  const bh = String(Math.floor(b / 60)).padStart(2, "0");
  const bm = String(b % 60).padStart(2, "0");
  return `${bh}:${bm}`;
}

function locationSig(e) {
  const v = normStr(e?.venueName);
  if (v) return `v:${v}`;
  const c = normStr(e?.city);
  const r = normStr(e?.region);
  if (c || r) return `cr:${c}|${r}`;
  const co = normStr(e?.country);
  if (co) return `co:${co}`;
  return "loc:unknown";
}

function eventSignatureStrict(e) {
  const title = normStr(canonicalizeTitleForDedupe(e?.name));
  const date = String(e?.localDate || "").slice(0, 10) || "no-date";
  const tb = timeBucketHHMM(e?.localTime, 30);
  const loc = locationSig(e);
  return `${title}__${date}__${tb}__${loc}`;
}

function canonicalEventScore(e) {
  let s = 0;
  if (e?.url) s += 5;
  if (e?.venueName) s += 2;
  if (e?.localTime) s += 1;

  const n = normStr(e?.name);
  if (/\b(vs)\b/.test(n) || /\b(presents)\b/.test(n) || /\btour\b/.test(n)) s += 2;

  const ah = Array.isArray(e?.anchorIds) ? e.anchorIds.length : 1;
  s += Math.min(ah, 5);
  return s;
}

function mergeEventMeta(base, incoming) {
  const out = { ...base };

  for (const k of ["url", "venueName", "city", "region", "country", "localTime"]) {
    if (!out[k] && incoming[k]) out[k] = incoming[k];
  }

  // Preserve premium signals if winner is missing them
  if ((!out.priceRanges || !out.priceRanges.length) && incoming?.priceRanges?.length) out.priceRanges = incoming.priceRanges;
  if ((!out.classifications || !out.classifications.length) && incoming?.classifications?.length)
    out.classifications = incoming.classifications;

  const aA = Array.isArray(out.anchorIds) ? out.anchorIds : [out.anchorId].filter(Boolean);
  const aB = Array.isArray(incoming.anchorIds) ? incoming.anchorIds : [incoming.anchorId].filter(Boolean);
  out.anchorIds = Array.from(new Set([...aA, ...aB])).filter(Boolean);

  const lA = Array.isArray(out.anchorLabels) ? out.anchorLabels : [out.anchorLabel].filter(Boolean);
  const lB = Array.isArray(incoming.anchorLabels) ? incoming.anchorLabels : [incoming.anchorLabel].filter(Boolean);
  out.anchorLabels = Array.from(new Set([...lA, ...lB])).filter(Boolean);

  const addOns = new Set([...(out.addOns || []), ...(incoming.addOns || [])]);
  out.addOns = Array.from(addOns);

  out.anchorId = out.anchorIds[0] || out.anchorId;
  out.anchorLabel = out.anchorLabels[0] || out.anchorLabel;

  return out;
}

function dedupeAndFilterEvents(events) {
  const map = new Map();
  let noiseDropped = 0;

  for (const raw of events || []) {
    if (!raw) continue;

    if (isNoiseEvent(raw)) {
      noiseDropped += 1;
      continue;
    }

    const rawName = String(raw.name || "");
    const addOns = [];
    if (/\bpremium seating\b/i.test(rawName)) addOns.push("Premium Seating");
    if (/^pinstripe pass\b/i.test(rawName)) addOns.push("Pass");

    const e = {
      ...raw,
      name: canonicalizeTitleForDedupe(rawName),
      anchorIds: Array.isArray(raw.anchorIds) ? raw.anchorIds : [raw.anchorId].filter(Boolean),
      anchorLabels: Array.isArray(raw.anchorLabels) ? raw.anchorLabels : [raw.anchorLabel].filter(Boolean),
      addOns,
    };

    const sig = eventSignatureStrict(e);
    const cur = map.get(sig);

    if (!cur) {
      map.set(sig, e);
      continue;
    }

    const keepCur = canonicalEventScore(cur) >= canonicalEventScore(e);
    const winner = keepCur ? mergeEventMeta(cur, e) : mergeEventMeta(e, cur);
    map.set(sig, winner);
  }

  return { events: Array.from(map.values()), meta: { in: (events || []).length, out: map.size, noiseDropped } };
}

function collapseSameDayPerformancesKeepEvening(events) {
  const map = new Map();

  for (const e of events) {
    const key = [normStr(e.name), e.localDate, normStr(e.venueName), normStr(e.city)].join("|");
    const existing = map.get(key);
    if (!existing) {
      map.set(key, e);
      continue;
    }
    const tA = existing.localTime || "00:00:00";
    const tB = e.localTime || "00:00:00";
    if (tB > tA) map.set(key, e);
  }

  return Array.from(map.values());
}

function collapseSubEventsKeepPrimary(events) {
  const groups = new Map();

  for (const e of events || []) {
    const key = [
      e.seedKey || "",
      e.localDate || "",
      e.localTime || "",
      normStr(e.venueName),
      normStr(e.city),
      normStr(e.region),
    ].join("|");

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const result = [];

  for (const [, group] of groups.entries()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    const scored = group.map((e) => {
      const name = String(e.name || "");
      let score = 0;
      if (/\bvs\b/i.test(name)) score += 5;
      if (/\bpresents\b/i.test(name)) score += 3;
      if (/\btour\b/i.test(name)) score += 3;
      if (/\b(flag|tunnel|parade|table|field pass|rally|scoreboard|premium spaces)\b/i.test(name)) score -= 5;
      score += Math.min(name.length / 20, 3);
      return { e, score };
    });

    scored.sort((a, b) => b.score - a.score);
    result.push(scored[0].e);
  }

  return result;
}

/* -------------------- Nearby upsell noise dropper -------------------- */

function isLikelyUpsellPremiumName(name) {
  const n = normStr(name);
  return (
    /\b(member offer|member|season member|offer)\b/.test(n) ||
    /\b(anthem|halftime|pregame|primetime|runway|court of dream|color guard|dream team)\b/.test(n)
  );
}

function dropUpsellNoise(events) {
  return (events || []).filter((e) => {
    if (!e?.name) return false;
    if (e.anchorId === "nearby:all" && isLikelyUpsellPremiumName(e.name)) return false;
    return true;
  });
}

/* -------------------- Strict Premium helpers (NEW) -------------------- */

function minTicketPriceUSDish(e) {
  const arr = Array.isArray(e?.priceRanges) ? e.priceRanges : [];
  let best = null;
  for (const pr of arr) {
    const v = Number(pr?.min);
    if (!Number.isFinite(v)) continue;
    if (best == null || v < best) best = v;
  }
  return best; // number | null
}

function looksLikeBigVenueName(vn) {
  const s = normStr(vn);
  if (!s) return false;

  const big =
    /\b(arena|stadium|coliseum|dome|ballpark|fieldhouse|garden|centre|center|amphitheatre|amphitheater)\b/.test(s);

  const small = /\b(bar|pub|lounge|club|cafe|restaurant|taproom|brew|casino lounge)\b/.test(s);

  return big && !small;
}

function isStrictPremiumCandidate(e) {
  const MIN_PRICE = 90; // tune this
  const p = minTicketPriceUSDish(e);
  if (p != null) return p >= MIN_PRICE;
  return looksLikeBigVenueName(e?.venueName);
}

/* -------------------- Parsing helpers -------------------- */

function plusToSpace(s) {
  return String(s || "").replace(/\+/g, " ");
}

function deepDecodeParam(raw, maxPasses = 2) {
  let s = plusToSpace(String(raw || ""));
  for (let i = 0; i < maxPasses; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) break;
    try {
      const decoded = decodeURIComponent(s);
      if (decoded === s) break;
      s = decoded;
    } catch {
      break;
    }
  }
  return s.trim();
}

function normalizeCountryCodesFromParts(parts) {
  const out = [];
  for (const part of parts || []) {
    const s = String(part || "").trim();
    if (!s) continue;
    for (const token of s
      .split(/[,\s]+/g)
      .map((x) => String(x || "").trim().toUpperCase())
      .filter(Boolean)) {
      if (/^[A-Z]{2}$/.test(token)) out.push(token);
    }
  }
  const uniq = Array.from(new Set(out));
  return uniq.length ? uniq : ["US", "CA"];
}

function readCountryCodes(searchParams) {
  const all = searchParams.getAll("countryCode").map(deepDecodeParam).filter(Boolean);
  if (all.length) return normalizeCountryCodesFromParts(all);

  const one = deepDecodeParam(searchParams.get("countryCode") || "");
  if (one) return normalizeCountryCodesFromParts([one]);

  return ["US", "CA"];
}

function effectiveCountryCodesForSeed(seedCountry, requestedCodes) {
  const c = String(seedCountry || "").trim().toUpperCase();
  if (!c) return requestedCodes;
  return requestedCodes.includes(c) ? [c] : requestedCodes;
}

function readCityCenters(searchParams) {
  const seeds = [];
  for (let i = 1; i <= 10; i += 1) {
    const latRaw = searchParams.get(`cityLat${i}`);
    const lonRaw = searchParams.get(`cityLon${i}`);
    if (latRaw == null || lonRaw == null) continue;

    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const label = String(searchParams.get(`cityLabel${i}`) || `City ${i}`).trim() || `City ${i}`;
    const country = String(searchParams.get(`cityCountry${i}`) || "").trim().toUpperCase() || null;

    seeds.push({ key: `CITY${i}`, label, lat, lon, country });
  }
  return seeds;
}

/**
 * Favorites[] IDs supported:
 * - team:NHL:K8vZ...:Edmonton Oilers
 * - team:NHL:Edmonton Oilers          (no id -> resolve by keyword+league)
 * - artist:K8vZ...:Taylor Swift
 * - artist:Taylor Swift               (no id -> resolve by keyword)
 *
 * Also tolerates accidental duplication like:
 * - artist:artist:Chris_Isaak:Chris Isaak
 */
function parseFavoriteIdString(id) {
  const sRaw = String(id || "").trim();
  if (!sRaw) return null;

  const s = deepDecodeParam(sRaw);
  if (!s) return null;

  let parts = s
    .split(":")
    .map((x) => deepDecodeParam(x).trim())
    .filter(Boolean);

  const kindRaw0 = (parts[0] || "").toLowerCase();

  if (parts.length >= 2 && (parts[1] || "").toLowerCase() === kindRaw0 && (kindRaw0 === "artist" || kindRaw0 === "team")) {
    parts = [parts[0], ...parts.slice(2)];
  }

  const kindRaw = (parts[0] || "").toLowerCase();

  let kind = "unknown";
  if (kindRaw === "team") kind = "team";
  else if (kindRaw === "artist") kind = "artist";

  const league = kind === "team" ? String(parts[1] || "").trim().toUpperCase() || null : null;

  const attractionId =
    parts.find((p) => /^K8vZ/i.test(p)) ||
    parts.find((p) => /^K[0-9A-Za-z]+$/.test(p)) ||
    null;

  const label = deepDecodeParam(parts[parts.length - 1] || s);

  return { id: s, kind, league, label, attractionId };
}

function readFavoritesFromParams(searchParams) {
  const favIds = searchParams
    .getAll("favorites")
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  // At most two favorites (F1, F2)
  return favIds.map(parseFavoriteIdString).filter(Boolean).slice(0, 2);
}

function readGenreAnchorsFromParams(searchParams) {
  const music = searchParams.getAll("musicGenres").map(deepDecodeParam).filter(Boolean).slice(0, 2);
  const sports = searchParams.getAll("sportsGenres").map(deepDecodeParam).filter(Boolean).slice(0, 2);
  const arts = searchParams.getAll("artsGenres").map(deepDecodeParam).filter(Boolean).slice(0, 2);
  return { music, sports, arts };
}

/* -------------------- Travel-popularity city boost list -------------------- */
/**
 * IMPORTANT:
 * - This list is used ONLY to order the no-city seed scan.
 * - If your rankings file is alphabetical/odd, this overrides it so we scan NYC/LA/etc first.
 */
const TOP_TRAVEL_CITIES = [
  "New York City, NY",
  "Los Angeles, CA",
  "Chicago, IL",
  "San Francisco, CA",
  "Washington, DC",
  "Las Vegas, NV",
  "Miami, FL",
  "Boston, MA",
  "Seattle, WA",
  "New Orleans, LA",
  "Orlando, FL",
  "San Diego, CA",
  "Austin, TX",
  "Philadelphia, PA",
  "Atlanta, GA",
  "Nashville, TN",
  "Denver, CO",
  "Phoenix, AZ",
  "Dallas, TX",
  "Houston, TX",
  "Minneapolis, MN",
  "Detroit, MI",
  "Tampa, FL",
  "Charlotte, NC",
  "Portland, OR",
  "Salt Lake City, UT",
  "Pittsburgh, PA",
  "Cleveland, OH",
  "Kansas City, MO",
  "St. Louis, MO",
  "Cincinnati, OH",
  "Indianapolis, IN",
  "Baltimore, MD",
  "Raleigh, NC",
  "San Antonio, TX",
  "Sacramento, CA",

  "Toronto, ON",
  "Vancouver, BC",
  "Montreal, QC",
  "Calgary, AB",
  "Ottawa, ON",
  "Edmonton, AB",
  "Quebec City, QC",
  "Winnipeg, MB",
  "Halifax, NS",
];

function normalizeTravelCityName(label) {
  const s = String(label || "").trim();
  if (!s) return "";
  const first = s.split(",")[0] || s;
  return first.trim();
}

function travelPopularityIndex(label) {
  const city = normalizeTravelCityName(label);
  if (!city) return null;

  const sn = normStr(city);

  for (let i = 0; i < TOP_TRAVEL_CITIES.length; i++) {
    const cn = normStr(normalizeTravelCityName(TOP_TRAVEL_CITIES[i]));
    if (!cn) continue;

    if (sn === cn) return i;
    if (sn.includes(cn)) return i;
    if (cn.includes(sn) && sn.length >= 6) return i;
  }
  return null;
}

/* -------------------- City rankings (auto seeds) -------------------- */

const RANKINGS_PATHS = ["data/cityRankings.v2.json", "data/cityRankings.v1.json", "data/cities.json"];

let CITY_RANKINGS = null;
let CITY_RANKINGS_AT = 0;
const CITY_RANKINGS_TTL_MS = 10 * 60 * 1000;

function extractCitiesFromUnknownRankingsSchema(j) {
  if (!j) return [];
  if (Array.isArray(j)) return j;

  const directArrays = [j.cities, j.rankedCities, j.cityRankings, j.data, j.items, j.results, j.rows].filter(Array.isArray);
  if (directArrays.length) return directArrays[0];

  const domains = j.domains || j.byDomain || j.rankings || null;
  if (domains && typeof domains === "object") {
    const out = [];
    const visit = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        out.push(...node);
        return;
      }
      if (typeof node !== "object") return;

      for (const k of ["cities", "rankedCities", "topCities", "items", "results", "rows"]) {
        if (Array.isArray(node[k])) out.push(...node[k]);
      }
      for (const v of Object.values(node)) {
        if (v && (Array.isArray(v) || typeof v === "object")) visit(v);
      }
    };
    visit(domains);
    return out;
  }

  return [];
}

function normalizeCityRows(arr) {
  const norm = (arr || [])
    .map((x, idx) => {
      const label = String(x?.label || x?.name || x?.city || x?.cityLabel || "").trim();
      const lat = Number(x?.lat ?? x?.latitude ?? x?.centerLat ?? x?.y);
      const lon = Number(x?.lon ?? x?.lng ?? x?.longitude ?? x?.centerLon ?? x?.x);

      const country =
        x?.country
          ? String(x.country).trim().toUpperCase()
          : x?.countryCode
          ? String(x.countryCode).trim().toUpperCase()
          : x?.cc
          ? String(x.cc).trim().toUpperCase()
          : null;

      const rank = Number(x?.rank ?? x?.scoreRank ?? x?.position ?? idx + 1);

      if (!label) return null;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      return { key: `RANK_${idx + 1}`, label, lat, lon, country, rank: Number.isFinite(rank) ? rank : idx + 1 };
    })
    .filter(Boolean);

  norm.sort((a, b) => (a.rank || 0) - (b.rank || 0));
  return norm;
}

async function readJsonFileIfExists(relPath) {
  const abs = path.join(process.cwd(), relPath);
  const raw = await fs.readFile(abs, "utf8");
  return JSON.parse(raw);
}

async function loadCityRankings() {
  const now = Date.now();
  if (CITY_RANKINGS && now - CITY_RANKINGS_AT < CITY_RANKINGS_TTL_MS) return CITY_RANKINGS;

  for (const rel of RANKINGS_PATHS) {
    try {
      const j = await readJsonFileIfExists(rel);
      const rows = extractCitiesFromUnknownRankingsSchema(j);
      const norm = normalizeCityRows(rows);
      if (norm.length) {
        CITY_RANKINGS = norm;
        CITY_RANKINGS_AT = now;
        return norm;
      }
    } catch {}
  }

  CITY_RANKINGS = [];
  CITY_RANKINGS_AT = now;
  return CITY_RANKINGS;
}

/**
 * rankedSeeds(countryCodes, limit)
 * - Filter by requested countries
 * - Order by travel-popularity list FIRST (NYC, LA, etc)
 * - Then fallback to ranking-file "rank"
 */
async function rankedSeeds(countryCodes, limit) {
  const ranked = await loadCityRankings();
  const want = new Set((countryCodes || ["US", "CA"]).map((x) => String(x).toUpperCase()));

  const filtered = ranked.filter((c) => {
    const cc = String(c.country || "").toUpperCase();
    if (!want.size) return true;
    if (!cc) return true;
    return want.has(cc);
  });

  const ordered = filtered
    .map((c) => ({ ...c, _tIdx: travelPopularityIndex(c.label) }))
    .sort((a, b) => {
      const ai = a._tIdx;
      const bi = b._tIdx;
      const aHas = ai != null;
      const bHas = bi != null;

      if (aHas && bHas) return ai - bi;
      if (aHas) return -1;
      if (bHas) return 1;

      return (a.rank || 999999) - (b.rank || 999999);
    });

  return ordered.slice(0, limit).map((c, i) => ({
    key: c.key || `RANK_${i + 1}`,
    label: c.label,
    lat: c.lat,
    lon: c.lon,
    country: c.country || null,
    rank: c.rank || i + 1,
  }));
}

/* -------------------- Anchor model -------------------- */

function anchorIdForGenre(domain, name) {
  return `genre:${domain}:${String(name || "").trim()}`;
}

function segmentNameForGenreDomain(domain) {
  const d = String(domain || "").trim().toLowerCase();
  if (d === "music") return "Music";
  if (d === "sports") return "Sports";
  if (d === "arts") return "Arts & Theatre";
  return null;
}

function tmParamsForAnchor(p, anchor) {
  if (anchor.kind === "favorite_attr") {
    p.set("attractionId", String(anchor.attractionId));
    return;
  }
  if (anchor.kind === "genre") {
    const seg = segmentNameForGenreDomain(anchor.domain);
    if (seg) p.set("segmentName", seg);
    p.set("classificationName", String(anchor.classificationName));
    return;
  }
}

function buildAnchors({ favorites, musicGenres, sportsGenres, artsGenres }) {
  const anchors = [];

  for (let i = 0; i < favorites.length; i++) {
    const f = favorites[i];
    anchors.push({
      id: `favorite:${i + 1}:${f.id}`,
      kind: "favorite_attr",
      label: f.label || f.id,
      weight: i === 0 ? 10 : 9,
      league: f.league || null,
      attractionId: f.attractionId || null,
      _raw: f,
    });
  }

  for (let i = 0; i < (sportsGenres || []).length; i++) {
    const g = sportsGenres[i];
    anchors.push({
      id: anchorIdForGenre("sports", g),
      kind: "genre",
      domain: "sports",
      classificationName: g,
      label: g,
      weight: i === 0 ? 3 : 2,
    });
  }

  for (let i = 0; i < (musicGenres || []).length; i++) {
    const g = musicGenres[i];
    anchors.push({
      id: anchorIdForGenre("music", g),
      kind: "genre",
      domain: "music",
      classificationName: g,
      label: g,
      weight: i === 0 ? 3 : 2,
    });
  }

  for (let i = 0; i < (artsGenres || []).length; i++) {
    const g = artsGenres[i];
    anchors.push({
      id: anchorIdForGenre("arts", g),
      kind: "genre",
      domain: "arts",
      classificationName: g,
      label: g,
      weight: i === 0 ? 3 : 2,
    });
  }

  return anchors;
}

/* -------------------- Fetch events per (seed × anchor) -------------------- */

async function fetchEventsForSeedAnchor({
  seed,
  anchor,
  startYMD,
  endYMD,
  radiusMiles,
  countryCodes,
  budget,
  debugArr,
  size = 80,
  maxPages = 1,
  perAnchorCap = 160,
}) {
  const ccList = effectiveCountryCodesForSeed(seed.country, countryCodes);

  const eventsOut = [];
  const SIZE = size;
  const MAX_PAGES = maxPages;
  const PER_ANCHOR_CAP = perAnchorCap;

  for (const cc of ccList) {
    for (let page = 0; page < MAX_PAGES; page++) {
      if (budget.remaining <= 0) break;

      const p = new URLSearchParams();
      p.set("sort", "date,asc");
      p.set("latlong", `${seed.lat},${seed.lon}`);
      p.set("radius", String(radiusMiles));
      p.set("unit", "miles");
      p.set("startDateTime", `${startYMD}T00:00:00Z`);
      p.set("endDateTime", `${endYMD}T23:59:59Z`);
      p.set("size", String(SIZE));
      p.set("page", String(page));
      if (cc) p.set("countryCode", cc);

      tmParamsForAnchor(p, anchor);

      const tag =
        anchor.kind === "genre"
          ? `scan:${seed.key}:${cc}:genre:${anchor.classificationName}:p${page}`
          : `scan:${seed.key}:${cc}:attr:${anchor.attractionId}:p${page}`;

      const r = await tmFetchJson(p, { budget, debugArr, tag });
      if (!r.ok) {
        if (Number(r.status) === 429) return { ok: false, status: 429, events: [] };
        break;
      }

      const raw = Array.isArray(r.events) ? r.events : [];

      for (const e of raw) {
        const date = eventLocalDate(e);
        const url = eventUrl(e);
        if (!date || !url) continue;

        if (!ymdLessEq(startYMD, date)) continue;
        if (!ymdLessEq(date, endYMD)) continue;

        eventsOut.push({
          id: String(e?.id || url),
          name: sanitizeDisplayName(eventName(e)),
          url,
          localDate: date,
          localTime: eventLocalTime(e),
          venueName: venueName(e),
          city: eventCity(e) || "",
          region: eventRegion(e) || "",
          country: eventCountry(e) || "",

          // premium signals
          priceRanges: Array.isArray(e?.priceRanges) ? e.priceRanges : [],
          classifications: Array.isArray(e?.classifications) ? e.classifications : [],

          seedKey: seed.key,
          seedLabel: seed.label,
          seedLat: seed.lat,
          seedLon: seed.lon,

          anchorId: anchor.kind === "genre" ? anchor.id : `fav:attr:${anchor.attractionId}`,
          anchorLabel: anchor.label,
        });

        if (eventsOut.length >= PER_ANCHOR_CAP) break;
      }

      if (eventsOut.length >= PER_ANCHOR_CAP) break;
      if (raw.length < SIZE) break;
    }
  }

  return { ok: true, status: 200, events: eventsOut };
}

/* -------------------- Nearby proxy fetch -------------------- */

async function fetchNearbyEventsForSeed({ seed, startYMD, endYMD, radiusMiles, countryCodes, budget, debugArr, size = 80 }) {
  const ccList = effectiveCountryCodesForSeed(seed.country, countryCodes);
  const out = [];

  for (const cc of ccList) {
    if (budget.remaining <= 0) break;

    const p = new URLSearchParams();
    p.set("sort", "date,asc");
    p.set("latlong", `${seed.lat},${seed.lon}`);
    p.set("radius", String(radiusMiles));
    p.set("unit", "miles");
    p.set("startDateTime", `${startYMD}T00:00:00Z`);
    p.set("endDateTime", `${endYMD}T23:59:59Z`);
    p.set("size", String(size));
    p.set("page", "0");
    if (cc) p.set("countryCode", cc);

    const tag = `nearby:${seed.key}:${cc}:p0`;
    const r = await tmFetchJson(p, { budget, debugArr, tag });
    if (!r.ok) {
      if (Number(r.status) === 429) return { ok: false, status: 429, events: [] };
      continue;
    }

    for (const e of r.events || []) {
      const date = eventLocalDate(e);
      const url = eventUrl(e);
      if (!date || !url) continue;

      out.push({
        id: String(e?.id || url),
        name: sanitizeDisplayName(eventName(e)),
        url,
        localDate: date,
        localTime: eventLocalTime(e),
        venueName: venueName(e),
        city: eventCity(e) || "",
        region: eventRegion(e) || "",
        country: eventCountry(e) || "",

        // premium signals
        priceRanges: Array.isArray(e?.priceRanges) ? e.priceRanges : [],
        classifications: Array.isArray(e?.classifications) ? e.classifications : [],

        seedKey: seed.key,
        seedLabel: seed.label,
        seedLat: seed.lat,
        seedLon: seed.lon,

        anchorId: "nearby:all",
        anchorLabel: "Nearby",
      });
    }

    break;
  }

  return { ok: true, status: 200, events: out };
}

/* -------------------- Windows + scoring -------------------- */

const WEEKEND_WEIGHTS = { fri: 8, sat: 14, sun: 10 };

function weekdayUTCFromYMD(ymd) {
  const dt = parseISODate(ymd);
  if (!dt) return null;
  return dt.getUTCDay(); // 0=Sun..6=Sat
}

function weekendBonusForWindow(startYMD, tripDays) {
  let bonus = 0;
  for (let i = 0; i < tripDays; i++) {
    const d = ymdAddDays(startYMD, i);
    if (!d) continue;
    const wd = weekdayUTCFromYMD(d);
    if (wd == null) continue;
    if (wd === 5) bonus += WEEKEND_WEIGHTS.fri;
    else if (wd === 6) bonus += WEEKEND_WEIGHTS.sat;
    else if (wd === 0) bonus += WEEKEND_WEIGHTS.sun;
  }
  return bonus;
}

function windowKey(seedKey, ws) {
  return `${seedKey}|${ws}`;
}

function buildWindowsFromEvents({ events, tripDays, startYMD, endYMD }) {
  const latestStart = ymdAddDays(endYMD, -(tripDays - 1));
  if (!latestStart) return [];

  const byKey = new Map();

  for (const e of events) {
    const d = String(e.localDate || "").slice(0, 10);
    if (!d) continue;

    for (let k = 0; k <= tripDays - 1; k++) {
      const ws = ymdAddDays(d, -k);
      if (!ws) continue;

      if (!ymdLessEq(startYMD, ws)) continue;
      if (!ymdLessEq(ws, latestStart)) continue;

      const we = ymdAddDays(ws, tripDays - 1);
      if (!we) continue;

      const key = windowKey(e.seedKey, ws);

      let w = byKey.get(key);
      if (!w) {
        w = {
          key,
          seedKey: e.seedKey,
          seedLabel: e.seedLabel,
          center: { lat: e.seedLat, lon: e.seedLon },
          windowStart: ws,
          windowEnd: we,
          tripDays,
          events: [],
          anchorsHit: new Set(),
          anchorBreakdown: {},
        };
        byKey.set(key, w);
      }

      if (w.events.length < 90) w.events.push(e);

      const aids = Array.isArray(e.anchorIds) ? e.anchorIds : [e.anchorId].filter(Boolean);
      const als = Array.isArray(e.anchorLabels) ? e.anchorLabels : [e.anchorLabel].filter(Boolean);

      for (const aid of aids) {
        if (!aid) continue;
        w.anchorsHit.add(aid);
        w.anchorBreakdown[aid] = (w.anchorBreakdown[aid] || 0) + 1;
      }

      e.anchorIds = aids;
      e.anchorLabels = als;
    }
  }

  return Array.from(byKey.values());
}

function classifyTier({ hasBothFavorites, hasFavoriteAndGenre, hasAnyFavorite }) {
  if (hasBothFavorites) return 1;
  if (hasFavoriteAndGenre) return 2;
  if (hasAnyFavorite) return 3;
  return 9;
}

function scoreWindow(w, { favoriteIds, genreIds, anchorWeightsById }, tripDays) {
  const anchors = Array.from(w.anchorsHit || []);
  const totalEvents = Array.isArray(w.events) ? w.events.length : 0;

  const favHits = favoriteIds.filter((id) => w.anchorsHit?.has?.(id));
  const genreHits = genreIds.filter((id) => w.anchorsHit?.has?.(id));

  const hasAnyFavorite = favHits.length > 0;
  const hasBothFavorites = favoriteIds.length >= 2 && favHits.length >= 2;
  const hasFavoriteAndGenre = favHits.length > 0 && genreHits.length > 0;

  const tier = classifyTier({ hasBothFavorites, hasFavoriteAndGenre, hasAnyFavorite });

  let weightedCoverage = 0;
  for (const a of anchors) weightedCoverage += anchorWeightsById.get(a) || 0;

  let favEventCount = 0;
  let genreEventCount = 0;
  let nearbyProxy = 0;

  for (const e of w.events || []) {
    const ids = Array.isArray(e.anchorIds) ? e.anchorIds : [e.anchorId].filter(Boolean);
    const isFavOrGenre = ids.some((id) => favoriteIds.includes(id) || genreIds.includes(id));
    if (!isFavOrGenre) nearbyProxy += 1;

    for (const id of ids) {
      if (favoriteIds.includes(id)) favEventCount += 1;
      else if (genreIds.includes(id)) genreEventCount += 1;
    }
  }

  const favEventScore = Math.min(favEventCount, 10) * 520;
  const genreEventScore = Math.min(genreEventCount, 14) * 120;
  const nearbyScore = Math.min(nearbyProxy, 25) * 18;
  const densityScore = Math.min(totalEvents, 18) * 12;
  const weekendBonus = weekendBonusForWindow(w.windowStart, tripDays);

  const tierBoost = tier === 1 ? 2200 : tier === 2 ? 800 : tier === 3 ? 250 : 0;

  const overlapScore =
    tierBoost + favEventScore + genreEventScore + nearbyScore + weightedCoverage * 40 + densityScore + weekendBonus;

  const coverageCount = anchors.length;

  return {
    tier,
    overlapScore,
    coverageCount,
    totalEvents,
    weightedCoverage,
    weekendBonus,
    favHitsCount: favHits.length,
    genreHitsCount: genreHits.length,
    favEventCount,
    genreEventCount,
    nearbyProxy,
  };
}

/* -------------------- Final selection with city cooldown -------------------- */

function ymdToMs(ymd) {
  const dt = parseISODate(ymd);
  return dt ? dt.getTime() : NaN;
}

function cityLabelKey(s) {
  return normStr(String(s || "")) || "city";
}

function canPlaceInCityWithCooldown(existingTripsInCity, candStartYMD, minEndToStartGapDays) {
  const gap = Number(minEndToStartGapDays || 0);
  if (!Number.isFinite(gap) || gap <= 0) return true;

  const candStartMs = ymdToMs(candStartYMD);
  if (!Number.isFinite(candStartMs)) return false;

  for (const t of existingTripsInCity || []) {
    const endMs = ymdToMs(t.windowEnd);
    if (!Number.isFinite(endMs)) continue;
    const minStartMs = endMs + gap * 86400000;
    if (candStartMs < minStartMs) return false;
  }
  return true;
}

function pickWindowsSinglePass(windowsSorted, { limit, maxPerCity, cityGapDays }) {
  const picked = [];
  const perCity = new Map();

  for (const w of windowsSorted) {
    if (!w) continue;
    if (picked.length >= limit) break;

    const cityK = cityLabelKey(w.seedLabel);
    const list = perCity.get(cityK) || [];
    if (list.length >= maxPerCity) continue;

    if (!canPlaceInCityWithCooldown(list, w.windowStart, cityGapDays)) continue;

    picked.push(w);
    list.push(w);
    perCity.set(cityK, list);
  }

  return picked;
}

/* -------------------- F1+F2 Option A bucket fill -------------------- */

function hasHit(w, favId) {
  return !!w?.anchorsHit?.has?.(favId);
}

function bucketizeFavorites(windows, favoriteIds) {
  if (favoriteIds.length < 2) {
    return { crossover: [], f1only: windows.slice(), f2only: [] };
  }
  const [f1, f2] = favoriteIds;
  const crossover = [];
  const f1only = [];
  const f2only = [];

  for (const w of windows) {
    const h1 = hasHit(w, f1);
    const h2 = hasHit(w, f2);
    if (h1 && h2) crossover.push(w);
    else if (h1) f1only.push(w);
    else if (h2) f2only.push(w);
  }
  return { crossover, f1only, f2only };
}

function sortBest(arr) {
  return arr.sort((a, b) => {
    if ((b.overlapScore || 0) !== (a.overlapScore || 0)) return (b.overlapScore || 0) - (a.overlapScore || 0);
    if ((b.favEventCount || 0) !== (a.favEventCount || 0)) return (b.favEventCount || 0) - (a.favEventCount || 0);
    if ((b.nearbyProxy || 0) !== (a.nearbyProxy || 0)) return (b.nearbyProxy || 0) - (a.nearbyProxy || 0);
    return String(a.windowStart).localeCompare(String(b.windowStart));
  });
}

function pickF1F2WithCrossoverFirst(windows, { limit, maxPerCity, cityGapDays, favoriteIds }) {
  const { crossover, f1only, f2only } = bucketizeFavorites(windows, favoriteIds);

  sortBest(crossover);
  sortBest(f1only);
  sortBest(f2only);

  const picked = [];
  const used = new Set();

  const takeFrom = (arr, want) => {
    if (want <= 0) return;
    const pool = arr.filter((w) => !used.has(w.key));
    const slice = pickWindowsSinglePass(pool, { limit: want, maxPerCity, cityGapDays });
    for (const w of slice) {
      used.add(w.key);
      picked.push(w);
    }
  };

  takeFrom(crossover, limit);

  const remaining = Math.max(0, limit - picked.length);
  if (remaining > 0) {
    const half = Math.floor(remaining / 2);
    takeFrom(f1only, half);
    takeFrom(f2only, half);
  }

  const remaining2 = Math.max(0, limit - picked.length);
  if (remaining2 > 0) {
    const backfill = sortBest([...f1only, ...f2only, ...crossover].filter((w) => !used.has(w.key)));
    takeFrom(backfill, remaining2);
  }

  picked.sort((a, b) => (b.overlapScore || 0) - (a.overlapScore || 0));
  return picked.slice(0, limit);
}

/* -------------------- Trips output cache (Redis) -------------------- */

const TRIPS_CACHE_PREFIX = "trips:resp:v4_f1req:";
const TRIPS_CACHE_TTL_SECONDS = 60;

function tripsCacheKeyForReq(req) {
  const canonical = canonicalKeyFromUrl(req.url);
  return `${TRIPS_CACHE_PREFIX}${sha1(canonical)}`;
}

/* -------------------- Unified compute -------------------- */

async function computeTrips(req) {
  const { searchParams } = new URL(req.url);
  const includeAll = String(searchParams.get("includeAll") || "").trim() === "1";

  const countryCodes = readCountryCodes(searchParams);

  const tripDays = clampInt(searchParams.get("tripDays"), 1, 14, 4);
  const radiusMiles = clampInt(searchParams.get("radiusMiles"), 25, 500, 120);

  const startRaw = String(searchParams.get("start") || "").trim();
  const endRaw = String(searchParams.get("end") || "").trim();
  const startDt = parseISODate(startRaw);
  const endDt = parseISODate(endRaw);

  if (startRaw && !startDt) return { status: 400, payload: { ok: false, error: "Invalid start (YYYY-MM-DD)." } };
  if (endRaw && !endDt) return { status: 400, payload: { ok: false, error: "Invalid end (YYYY-MM-DD)." } };

  const { startDt: startResolvedDt, endDt: endResolvedDt, startYMD, endYMD } = resolveDateWindow({ startRaw, endRaw });
  const rangeDays = daysBetweenInclusiveUTC(startResolvedDt, endResolvedDt);

  const userSeedsAll = readCityCenters(searchParams);
  const hasSeeds = userSeedsAll.length > 0;
  const hasStart = !!startDt;
  const hasEnd = !!endDt;

  const favorites = readFavoritesFromParams(searchParams);
  const { music: musicGenres, sports: sportsGenres, arts: artsGenres } = readGenreAnchorsFromParams(searchParams);

  if (!favorites.length) {
    return {
      status: 400,
      payload: {
        ok: false,
        error: "F1 (Favorite 1) is required.",
        debug: { hasSeeds, hasStart, hasEnd, startYMD, endYMD },
      },
    };
  }

  const anchorsAll = buildAnchors({ favorites, musicGenres, sportsGenres, artsGenres });
  const hasAnchors = anchorsAll.length > 0;

  const scenarioId = (hasSeeds ? 8 : 0) + (hasStart ? 4 : 0) + (hasEnd ? 2 : 0) + (hasAnchors ? 1 : 0);

  if (!TM_KEY) return { status: 500, payload: { ok: false, error: "Missing TICKETMASTER_API_KEY" } };

  const tripsKey = tripsCacheKeyForReq(req);

  const debug = {
    scenarioId,
    redis: { enabled: HAS_REDIS, tripsCache: null, tripsKey },
    inputs: {
      hasSeeds,
      hasStart,
      hasEnd,
      startYMD,
      endYMD,
      rangeDays,
      tripDays,
      radiusMiles,
      countryCodes,
      favorites,
      musicGenres,
      sportsGenres,
      artsGenres,
      includeAll,
    },
    safety: { tmGlobalSpacingMs: TM_GLOBAL_SPACING_MS, tmBudgetHardCap: 25 },
    tm: { calls: [] },
    scanMeta: [],
    dedupe: null,
  };

  if (HAS_REDIS) {
    const cachedTripsStr = await redisGet(tripsKey);
    if (cachedTripsStr) {
      try {
        const cachedPayload = JSON.parse(cachedTripsStr);
        debug.redis.tripsCache = "HIT";
        cachedPayload.debug = cachedPayload.debug || {};
        cachedPayload.debug.redis = { ...(cachedPayload.debug.redis || {}), enabled: true, tripsCache: "HIT", tripsKey };
        return { status: 200, payload: cachedPayload };
      } catch {}
    }
    debug.redis.tripsCache = "MISS";
  } else {
    debug.redis.tripsCache = "DISABLED";
  }

  const breaker = await breakerUntilMs();
  if (breaker && breaker > Date.now()) {
    const payload = {
      ok: false,
      scenarioId,
      count: 0,
      trips: [],
      error: `Ticketmaster is throttling right now. Try again in ~${Math.ceil((breaker - Date.now()) / 1000)}s.`,
      dateRange: { start: startYMD, end: endYMD, tripDays },
      debug: { ...debug, breakerUntilMs: breaker },
    };
    if (HAS_REDIS) await redisSetEx(tripsKey, TRIPS_CACHE_TTL_SECONDS, JSON.stringify(payload));
    return { status: 200, payload };
  }

  const budget = { remaining: 25 };

  for (const a of anchorsAll) {
    if (a.kind === "favorite_attr" && !a.attractionId) {
      const raw = a._raw || {};
      const keyword = a.label || raw.label || raw.id;
      const league = raw.league || a.league;
      const resolved = await resolveAttractionIdServerSide({ keyword, league, budget, debugArr: debug.tm.calls });
      if (resolved) a.attractionId = resolved;
    }
  }

  const badFavorites = anchorsAll
    .filter((a) => a.kind === "favorite_attr")
    .filter((a) => !a.attractionId)
    .map((a) => ({
      label: a.label || a.id,
      raw: a?._raw?.id || a.id,
      hint: "Favorite must include a Ticketmaster attractionId (K8vZ...) or be resolvable by name.",
    }));

  const favoriteAnchorObjs = anchorsAll.filter((a) => a.kind === "favorite_attr").slice(0, 2);
  if (!favoriteAnchorObjs.length || !favoriteAnchorObjs[0]?.attractionId) {
    const payload = {
      ok: false,
      scenarioId,
      count: 0,
      trips: [],
      error: "F1 could not be resolved to a Ticketmaster attractionId.",
      badFavorites: badFavorites.length ? badFavorites : undefined,
      dateRange: { start: startYMD, end: endYMD, tripDays },
      debug: { ...debug, remainingBudget: budget.remaining },
    };
    if (HAS_REDIS) await redisSetEx(tripsKey, TRIPS_CACHE_TTL_SECONDS, JSON.stringify(payload));
    return { status: 400, payload };
  }

  const genreAnchorObjs = anchorsAll.filter((a) => a.kind === "genre").slice(0, 3);

  const LIMIT = 10;

  let seeds = [];
  if (hasSeeds) {
    seeds = userSeedsAll.slice(0, 6);
  } else {
    const ranked = await rankedSeeds(countryCodes, 40);

    const perSeedCost = favoriteAnchorObjs.length >= 2 ? 3 : 2;
    const maxSeedsByBudget = Math.max(2, Math.min(12, Math.floor(Math.max(0, budget.remaining - 2) / perSeedCost)));
    const targetSeeds = favoriteAnchorObjs.length >= 2 ? Math.min(8, maxSeedsByBudget) : Math.min(10, maxSeedsByBudget);

    seeds = ranked.slice(0, targetSeeds);
  }

  if (!seeds.length) {
    return {
      status: 500,
      payload: {
        ok: false,
        scenarioId,
        error:
          "No city seeds available (rankings file missing/empty and no cities provided). Check data/cityRankings.v2.json or data/cities.json schema/path.",
      },
    };
  }

  debug.inputs.seeds = seeds;

  const anchorWeightsById = new Map();
  const anchorLabelById = new Map();

  const favoriteIds = [];
  const genreIds = [];

  for (const a of favoriteAnchorObjs) {
    const id = `fav:attr:${a.attractionId}`;
    anchorWeightsById.set(id, a.weight || 1);
    anchorLabelById.set(id, a.label || a.id);
    favoriteIds.push(id);
  }

  for (const a of genreAnchorObjs) {
    anchorWeightsById.set(a.id, a.weight || 1);
    anchorLabelById.set(a.id, a.label || a.id);
    genreIds.push(a.id);
  }

  const allEvents = [];

  for (const seed of seeds) {
    if (budget.remaining <= 0) break;

    for (const anchor of favoriteAnchorObjs) {
      if (budget.remaining <= 0) break;

      const r = await fetchEventsForSeedAnchor({
        seed,
        anchor,
        startYMD,
        endYMD,
        radiusMiles,
        countryCodes,
        budget,
        debugArr: debug.tm.calls,
        size: 80,
        maxPages: 1,
      });

      debug.scanMeta.push({
        seed: seed.label,
        anchor: anchor.label,
        kind: anchor.kind,
        ok: !!r.ok,
        status: r.status,
        count: r.events.length,
        remainingBudget: budget.remaining,
      });

      if (!r.ok) {
        const b = await breakerUntilMs();
        if (Number(r.status) === 429 || (b && b > Date.now())) break;
        continue;
      }

      allEvents.push(...r.events);
    }

    if (budget.remaining > 0) {
      const nearby = await fetchNearbyEventsForSeed({
        seed,
        startYMD,
        endYMD,
        radiusMiles,
        countryCodes,
        budget,
        debugArr: debug.tm.calls,
      });

      debug.scanMeta.push({
        seed: seed.label,
        anchor: "Nearby proxy",
        kind: "nearby",
        ok: !!nearby.ok,
        status: nearby.status,
        count: nearby.events.length,
        remainingBudget: budget.remaining,
      });

      if (nearby.ok) allEvents.push(...nearby.events);
      else {
        const b = await breakerUntilMs();
        if (Number(nearby.status) === 429 || (b && b > Date.now())) break;
      }
    }

    if (genreAnchorObjs.length && budget.remaining > 0) {
      for (const g of genreAnchorObjs) {
        if (budget.remaining <= 0) break;

        const r = await fetchEventsForSeedAnchor({
          seed,
          anchor: g,
          startYMD,
          endYMD,
          radiusMiles,
          countryCodes,
          budget,
          debugArr: debug.tm.calls,
          size: 80,
          maxPages: 1,
        });

        debug.scanMeta.push({
          seed: seed.label,
          anchor: g.label,
          kind: "genre",
          ok: !!r.ok,
          status: r.status,
          count: r.events.length,
          remainingBudget: budget.remaining,
        });

        if (!r.ok) {
          const b = await breakerUntilMs();
          if (Number(r.status) === 429 || (b && b > Date.now())) break;
          continue;
        }

        allEvents.push(...r.events);
      }
    }
  }

  if (!allEvents.length) {
    const payload = {
      ok: true,
      scenarioId,
      dateRange: { start: startYMD, end: endYMD, tripDays },
      count: 0,
      trips: [],
      error: badFavorites.length
        ? "No events found. Also note: one or more favorites could not be resolved to Ticketmaster attractionIds."
        : "No events found for favorites in the selected cities/date range.",
      badFavorites: badFavorites.length ? badFavorites : undefined,
      debug: { ...debug, remainingBudget: budget.remaining },
    };
    if (HAS_REDIS) await redisSetEx(tripsKey, TRIPS_CACHE_TTL_SECONDS, JSON.stringify(payload));
    return { status: 200, payload };
  }

  const cleaned = dedupeAndFilterEvents(allEvents);
  let eventsClean = cleaned.events;
  debug.dedupe = cleaned.meta;

  eventsClean = dropUpsellNoise(eventsClean);
  eventsClean = collapseSameDayPerformancesKeepEvening(eventsClean);
  eventsClean = collapseSubEventsKeepPrimary(eventsClean);

  const windowsRaw = buildWindowsFromEvents({ events: eventsClean, tripDays, startYMD, endYMD });

  for (const w of windowsRaw) {
    Object.assign(
      w,
      scoreWindow(
        w,
        {
          favoriteIds,
          genreIds,
          anchorWeightsById,
        },
        tripDays
      )
    );
  }

  const windowsFiltered = windowsRaw.filter((w) => (w.favHitsCount || 0) > 0);

  sortBest(windowsFiltered);

  function toTrip(w) {
    const breakdown = {};
    for (const [aid, cnt] of Object.entries(w.anchorBreakdown || {})) {
      const label = anchorLabelById.get(aid) || (aid === "nearby:all" ? "Nearby events proxy" : aid);
      breakdown[label] = cnt;
    }

    const reasons = [
      favoriteIds.length >= 2
        ? "Option A: Crossover first, then split fill (F1-only / F2-only), then backfill."
        : "F1 required: windows must contain Favorite 1.",
      `Fav events: ${w.favEventCount || 0} • Genre events: ${w.genreEventCount || 0} • Nearby proxy: ${w.nearbyProxy || 0}`,
      `Events in window: ${w.totalEvents}`,
      `Within ${radiusMiles} miles of ${w.seedLabel}`,
      includeAll ? "includeAll=1: returning allEvents for reveal/hide UI." : "Curated sampleEvents only (anchors + strict premium gap-fill).",
    ];

    const evs = Array.isArray(w.events) ? w.events : [];

    const isAnchorEvent = (e) => {
      const ids = Array.isArray(e.anchorIds) ? e.anchorIds : [e.anchorId].filter(Boolean);
      return ids.some((id) => favoriteIds.includes(id) || genreIds.includes(id));
    };

    const anchorEvents = evs.filter(isAnchorEvent);

    const anchorDensity = (w.favEventCount || 0) + (w.genreEventCount || 0);
    const LOW_DENSITY_THRESHOLD = Math.max(2, Math.floor(tripDays / 2)); // tune if needed
    const shouldFillWithPremium = anchorDensity < LOW_DENSITY_THRESHOLD;

    let premiumFill = [];
    if (shouldFillWithPremium) {
      premiumFill = evs
        .filter((e) => !isAnchorEvent(e))
        .filter((e) => isStrictPremiumCandidate(e))
        .sort((a, b) => {
          const ap = minTicketPriceUSDish(a);
          const bp = minTicketPriceUSDish(b);
          if (bp != null && ap != null && bp !== ap) return bp - ap;
          if ((b.venueName || "") !== (a.venueName || "")) return String(b.venueName || "").localeCompare(String(a.venueName || ""));
          return String(a.name || "").localeCompare(String(b.name || ""));
        })
        .slice(0, 8);
    }

    const curated = [...anchorEvents, ...premiumFill].slice(0, 14).map((e) => ({
      date: e.localDate,
      name: e.name,
      location: [e.city, e.region].filter(Boolean).join(", "),
      favKey: (Array.isArray(e.anchorLabels) && e.anchorLabels.length ? e.anchorLabels : [e.anchorLabel])
        .filter(Boolean)
        .join(" | "),
      url: e.url,
      minPrice: minTicketPriceUSDish(e),
      isPremium: !isAnchorEvent(e) && isStrictPremiumCandidate(e),
    }));

    const allEvents = includeAll
      ? evs.slice(0, 120).map((e) => ({
          date: e.localDate,
          name: e.name,
          location: [e.city, e.region].filter(Boolean).join(", "),
          favKey: (Array.isArray(e.anchorLabels) && e.anchorLabels.length ? e.anchorLabels : [e.anchorLabel])
            .filter(Boolean)
            .join(" | "),
          url: e.url,
          minPrice: minTicketPriceUSDish(e),
          isPremium: !isAnchorEvent(e) && isStrictPremiumCandidate(e),
        }))
      : undefined;

    return {
      id: `trip_${w.seedKey}_${w.windowStart}_${w.windowEnd}`,
      dest: { label: w.seedLabel, lat: w.center.lat, lon: w.center.lon },
      windowStart: w.windowStart,
      windowEnd: w.windowEnd,
      tripDays,
      radiusMiles,
      score: Math.round((w.overlapScore || 0) * 100) / 100,
      breakdown,
      sampleEvents: curated,
      ...(includeAll ? { allEvents } : null),
      reasons,
      openUrl: "",
    };
  }

  const maxPerCity = hasSeeds ? 6 : 2;
  const cityGapDays = hasSeeds ? 0 : 14;

  let pickedWindows = [];
  if (favoriteIds.length >= 2) {
    pickedWindows = pickF1F2WithCrossoverFirst(windowsFiltered, {
      limit: LIMIT,
      maxPerCity,
      cityGapDays,
      favoriteIds,
    });
  } else {
    pickedWindows = pickWindowsSinglePass(windowsFiltered, { limit: LIMIT, maxPerCity, cityGapDays });
  }

  const tripsTop = pickedWindows.map(toTrip);
  tripsTop.sort((a, b) => (b.score || 0) - (a.score || 0));

  const breakerNow = await breakerUntilMs();
  const warning =
    breakerNow && breakerNow > Date.now()
      ? `TM throttled during processing. Returning best-so-far. Try again in ~${Math.ceil(
          (breakerNow - Date.now()) / 1000
        )}s for fuller results.`
      : null;

  const payload = {
    ok: true,
    scenarioId,
    anchors: [...favoriteAnchorObjs, ...genreAnchorObjs].map((a) => ({
      id: a.id,
      kind: a.kind,
      label: a.label,
      weight: a.weight,
    })),
    dateRange: { start: startYMD, end: endYMD, tripDays },
    count: tripsTop.length,
    trips: tripsTop,
    ...(warning ? { warning } : null),
    ...(badFavorites.length ? { badFavorites } : null),
    debug: {
      ...debug,
      breakerUntilMs: breakerNow || 0,
      remainingBudget: budget.remaining,
      scoring: {
        favorites: favoriteIds.map((id) => anchorLabelById.get(id) || id),
        genres: genreIds.map((id) => anchorLabelById.get(id) || id),
        diversity: { maxPerCity, cityGapDays, appliesOnlyWhenNoCitySeeds: !hasSeeds },
        notes: [
          "F1 required (genre-only scenarios removed).",
          "Trips must contain at least one favorite event (F1 or F2).",
          "Curated sampleEvents = anchors + strict premium gap-fill (only when anchors are sparse).",
          "Use includeAll=1 to additionally return allEvents for UI reveal/hide.",
          "No-city: max 2 trips per city, 14-day cooldown (end -> next start).",
          "No global date spreading across different cities.",
          "Hard TM cap 25 calls (includes attraction resolve + event queries).",
        ],
      },
      premium: {
        strictMinPrice: 90,
        lowDensityThresholdRule: "max(2, floor(tripDays/2))",
        maxPremiumFillPerTrip: 8,
        maxAllEventsReturnedWhenIncludeAll: 120,
      },
    },
  };

  if (HAS_REDIS) await redisSetEx(tripsKey, TRIPS_CACHE_TTL_SECONDS, JSON.stringify(payload));
  return { status: 200, payload };
}

/* -------------------- Handler (with dedupe/cache) -------------------- */

export async function GET(req) {
  const t0 = nowMs();
  const key = canonicalKeyFromUrl(req.url);

  const cached = TTL_CACHE.get(key);
  if (cached) {
    const age = nowMs() - cached.ts;
    const ttl = cached.status === 200 ? CACHE_TTL_OK_MS : cached.status === 429 ? CACHE_TTL_429_MS : CACHE_TTL_ERR_MS;
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
      return { status: 500, payload: { ok: false, error: "Trips API error", detail: String(e?.message || e) } };
    }
  })();

  INFLIGHT.set(key, p);

  const { status, payload } = await p.finally(() => INFLIGHT.delete(key));

  TTL_CACHE.set(key, { ts: nowMs(), status, payload });

  const res = NextResponse.json(payload, { status });
  return setDebugHeaders(res, { cache: "MISS", key, tookMs: nowMs() - t0 });
}