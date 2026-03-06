import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_EVENTS = `${TM_BASE}/events.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

// -------------------- Tunables --------------------

const PROBE_SIZE = 1;
const DEFAULT_MONTHS_AHEAD = 8;

const CONCURRENCY = 6;
const TM_THROTTLE_MS = 110;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// -------------------- In-memory cache (warm instance) --------------------

function getCache() {
  if (!globalThis.__EVENTSTACK_CITY_RECO_CACHE__) {
    globalThis.__EVENTSTACK_CITY_RECO_CACHE__ = { map: new Map() };
  }
  return globalThis.__EVENTSTACK_CITY_RECO_CACHE__.map;
}

function cacheGet(key) {
  const m = getCache();
  const hit = m.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    m.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  const m = getCache();
  m.set(key, { ts: Date.now(), value });
}

// -------------------- Helpers --------------------

function json(payload, status = 200, extraHeaders = {}) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function toYMDUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addMonthsUTC(d, months) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  dt.setUTCMonth(dt.getUTCMonth() + Number(months || 0));
  return dt;
}

function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const iv = Math.trunc(n);
  if (iv < lo) return lo;
  if (iv > hi) return hi;
  return iv;
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
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

function cityLabel(c) {
  const name = String(c?.name || "").trim();
  const region = String(c?.region || "").trim();
  const country = String(c?.country || "").trim();
  return `${name}${region ? `, ${region}` : ""}${country ? ` (${country})` : ""}`;
}

/**
 * Accepts favorites in a few shapes:
 * - object form from UI: { key,label,kind,attractionId?,classificationName? }
 * - string form: "team:<LEAGUE>:<ATTRACTION_ID>:<NAME>" | "artist:<ATTRACTION_ID>:<NAME>" | "Country"
 */
function parseFavorite(raw) {
  if (!raw) return null;

  // Object form (B)
  if (typeof raw === "object") {
    const kind = String(raw.kind || "").toLowerCase();
    const key = String(raw.key || raw.id || "").trim();
    const label = String(raw.label || "").trim() || key;
    const attractionId = raw.attractionId ? String(raw.attractionId).trim() : "";
    const classificationName = raw.classificationName ? String(raw.classificationName).trim() : "";

    if (!key) return null;

    if ((kind === "team" || kind === "artist") && attractionId) {
      return { kind: "attraction", key, label, attractionId };
    }

    if (kind === "genre" && (classificationName || label)) {
      return {
        kind: "genre",
        key,
        label: label || classificationName,
        classificationName: classificationName || label,
      };
    }

    return {
      kind: "genre",
      key,
      label,
      classificationName: classificationName || label,
    };
  }

  // String form (legacy)
  const s = String(raw || "").trim();
  if (!s) return null;

  if (s.startsWith("team:")) {
    const parts = s.split(":");
    const attractionId = parts[2] ? String(parts[2]).trim() : "";
    const label = parts.slice(3).join(":").trim() || s;
    if (!attractionId) return { kind: "genre", key: s, label, classificationName: label };
    return { kind: "attraction", key: s, label, attractionId };
  }

  if (s.startsWith("artist:")) {
    const parts = s.split(":");
    const attractionId = parts[1] ? String(parts[1]).trim() : "";
    const label = parts.slice(2).join(":").trim() || s;
    if (!attractionId) return { kind: "genre", key: s, label, classificationName: label };
    return { kind: "attraction", key: s, label, attractionId };
  }

  return { kind: "genre", key: s, label: s, classificationName: s };
}

async function fetchTM(url) {
  await sleep(TM_THROTTLE_MS);

  const res = await fetch(url, { cache: "no-store" });

  if ((res.status === 429 || res.status >= 500) && res.status !== 501) {
    await sleep(350);
    return fetch(url, { cache: "no-store" });
  }

  return res;
}

async function probeCityFavorite({ fav, city, radiusMiles, countryCodes, startYMD, endYMD }) {
  const cacheKey = [
    "v2",
    fav.key,
    city.id || cityLabel(city),
    String(radiusMiles),
    countryCodes.join(","),
    startYMD,
    endYMD,
  ].join("|");

  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const startDateTime = `${startYMD}T00:00:00Z`;

  const [Y, M, D] = endYMD.split("-").map((x) => Number(x));
  const dtEnd = new Date(Date.UTC(Y, M - 1, D));
  dtEnd.setUTCDate(dtEnd.getUTCDate() + 1);
  const endDateTime = `${toYMDUTC(dtEnd)}T00:00:00Z`;

  let best = { ok: true, hasEvent: false, earliestDate: null, status: 0 };

  for (const cc of countryCodes) {
    const u = new URL(TM_EVENTS);
    u.searchParams.set("apikey", TM_KEY);
    u.searchParams.set("size", String(PROBE_SIZE));
    u.searchParams.set("page", "0");
    u.searchParams.set("sort", "date,asc");

    u.searchParams.set("latlong", `${city.lat},${city.lon}`);
    u.searchParams.set("radius", String(radiusMiles));
    u.searchParams.set("unit", "miles");

    u.searchParams.set("startDateTime", startDateTime);
    u.searchParams.set("endDateTime", endDateTime);

    if (cc) u.searchParams.set("countryCode", cc);

    if (fav.kind === "attraction" && fav.attractionId) {
      u.searchParams.set("attractionId", fav.attractionId);
    } else if (fav.kind === "genre" && fav.classificationName) {
      u.searchParams.set("classificationName", fav.classificationName);
    }

    const res = await fetchTM(u.toString());
    best.status = res.status;

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) continue;

    const evs = data?._embedded?.events || [];
    if (Array.isArray(evs) && evs.length > 0) {
      const first = evs[0];
      const localDate = first?.dates?.start?.localDate || null;
      best = { ok: true, hasEvent: true, earliestDate: localDate, status: res.status };
      break;
    }
  }

  cacheSet(cacheKey, best);
  return best;
}

async function mapWithConcurrency(list, limit, mapper) {
  const out = new Array(list.length);
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= list.length) return;
      out[idx] = await mapper(list[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return out;
}

// -------------------- Route --------------------

export async function POST(req) {
  if (!TM_KEY) return json({ ok: false, error: "Missing TICKETMASTER_API_KEY" }, 500);

  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const favoritesRaw = Array.isArray(body?.favorites) ? body.favorites : [];
  const citiesRaw = Array.isArray(body?.cities) ? body.cities : [];

  const parsedFavorites = favoritesRaw.map(parseFavorite).filter(Boolean).slice(0, 4);

  if (parsedFavorites.length < 1) {
    return json({ ok: false, error: "favorites[] required (at least 1, up to 4)." }, 400);
  }

  const cities = (citiesRaw || [])
    .map((c) => ({
      id: String(c?.id || "").trim() || null,
      name: String(c?.name || "").trim(),
      region: String(c?.region || "").trim(),
      country: String(c?.country || "").trim(),
      lat: toNumber(c?.lat),
      lon: toNumber(c?.lon),
      airportIata: c?.airportIata ? String(c.airportIata).trim().toUpperCase() : null,
    }))
    .filter((c) => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon));

  if (cities.length < 1) {
    return json({ ok: false, error: "cities[] required with valid lat/lon." }, 400);
  }

  const radiusMiles = clampInt(body?.radiusMiles, 1, 200, 120);
  const probeCities = clampInt(body?.probeCities, 5, 80, 30);
  const top = clampInt(body?.top, 5, 80, 30);

  const countryCodes = normalizeCountryCodes(body?.countryCode || "US,CA");
  const countryCode = countryCodes.join(",");

  const now = new Date();
  const defaultStart = toYMDUTC(now);
  const defaultEnd = toYMDUTC(addMonthsUTC(now, DEFAULT_MONTHS_AHEAD));

  const startYMD = isYMD(body?.start) ? String(body.start).trim() : defaultStart;
  const endYMD = isYMD(body?.end) ? String(body.end).trim() : defaultEnd;

  if (endYMD < startYMD) {
    return json({ ok: false, error: `Invalid range: end (${endYMD}) is before start (${startYMD}).` }, 400);
  }

  const sortedCities = cities.slice().sort((a, b) => {
    const aHas = a.airportIata ? 0 : 1;
    const bHas = b.airportIata ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    return cityLabel(a).localeCompare(cityLabel(b));
  });

  const candidateCities = sortedCities.slice(0, probeCities);

  const jobs = [];
  for (const c of candidateCities) {
    for (const fav of parsedFavorites) jobs.push({ city: c, fav });
  }

  const debug = {
    probedCities: candidateCities.length,
    totalProbes: jobs.length,
    hits: 0,
    misses: 0,
  };

  const results = await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
    const r = await probeCityFavorite({
      fav: job.fav,
      city: job.city,
      radiusMiles,
      countryCodes,
      startYMD,
      endYMD,
    });

    if (r?.hasEvent) debug.hits += 1;
    else debug.misses += 1;

    return { ...job, result: r };
  });

  const byCityKey = new Map();
  for (const c of candidateCities) {
    const key = c.id || cityLabel(c);
    byCityKey.set(key, { city: c, coverage: new Map() });
  }

  for (const row of results) {
    const cKey = row.city.id || cityLabel(row.city);
    const bucket = byCityKey.get(cKey);
    if (!bucket) continue;
    bucket.coverage.set(row.fav.key, {
      hasEvent: !!row.result?.hasEvent,
      earliestDate: row.result?.earliestDate || null,
    });
  }

  const scored = [];
  for (const { city, coverage } of byCityKey.values()) {
    let coverageCount = 0;
    let earliest = null;

    const missingKeys = [];
    for (const fav of parsedFavorites) {
      const hit = coverage.get(fav.key);
      if (hit?.hasEvent) {
        coverageCount += 1;
        const d = hit.earliestDate;
        if (d && (!earliest || String(d) < String(earliest))) earliest = d;
      } else {
        missingKeys.push(fav.key);
      }
    }

    const dateBonus =
      earliest && isYMD(earliest)
        ? Math.max(
            0,
            365 -
              Math.min(
                365,
                Math.floor(
                  (Date.parse(`${earliest}T00:00:00Z`) - Date.parse(`${startYMD}T00:00:00Z`)) / 86400000
                )
              )
          )
        : 0;

    const score = coverageCount * 1000 + dateBonus;

    scored.push({
      id: city.id || "",
      label: cityLabel(city),
      lat: city.lat,
      lon: city.lon,
      airportIata: city.airportIata || null,
      score,
      coverageCount,
      missingKeys,
      earliestDate: earliest,
    });
  }

  scored.sort((a, b) => {
    if (b.coverageCount !== a.coverageCount) return b.coverageCount - a.coverageCount;
    if (b.score !== a.score) return b.score - a.score;
    const aE = a.earliestDate || "9999-12-31";
    const bE = b.earliestDate || "9999-12-31";
    if (aE !== bE) return aE.localeCompare(bE);
    return a.label.localeCompare(b.label);
  });

  return json({
    ok: true,
    start: startYMD,
    end: endYMD,
    radiusMiles,
    countryCode,
    favorites: parsedFavorites.map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      attractionId: f.attractionId || undefined,
      classificationName: f.classificationName || undefined,
    })),
    cities: scored.slice(0, top),
    debug,
  });
}

export async function GET() {
  return json(
    {
      ok: false,
      error: "Use POST with JSON body. See route.js header comment for payload shape.",
    },
    405
  );
}