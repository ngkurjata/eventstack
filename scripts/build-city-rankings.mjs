// FILE: scripts/build-city-rankings.mjs
//
// PowerShell run:
//   $env:TICKETMASTER_API_KEY="YOUR_KEY"
//   node .\scripts\build-city-rankings.mjs --out .\data\cityRankings.v2.json --days 180
//
// What it does:
// - Offline job that ranks candidate cities per (domain, genre) using Ticketmaster Discovery API.
// - Outputs:
//   1) Whole-horizon rankings (v1-compatible-ish): rankings[domain][genreKey][countryCode] = rows[]
//   2) ✅ Date-specific bins: dailyCounts[domain][genreKey][countryCode][YYYY-MM-DD][cityKey] = count
//
// Notes:
// - This script is ESM (.mjs).
// - "dailyCounts" lets your API rank cities for arbitrary user date windows by summing only those dates.

import fs from "fs";
import path from "path";
import crypto from "crypto";

/* -------------------- Config -------------------- */

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_EVENTS = `${TM_BASE}/events.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

if (!TM_KEY) {
  console.error("Missing TICKETMASTER_API_KEY");
  process.exit(1);
}

// Ranking job behavior
const DEFAULT_HORIZON_DAYS = 180;
const DEFAULT_RADIUS_MILES = 70;     // tighter than 120 to avoid metro overlap (NYC/PHL, etc.)
const DEFAULT_SIZE = 80;             // TM page size (max 200)
const DEFAULT_MAX_PAGES = 2;         // cap paging to protect quota
const DEFAULT_SPACING_MS = 400;      // spacing between TM calls to reduce 429s
const DEFAULT_TIMEOUT_MS = 12_000;

// Conservative noise filter to avoid bar lessons/closures dominating rankings.
const NOISE_REGEX = new RegExp(
  [
    "\\b(closed|private event|maintenance)\\b",
    "\\b(instruction|lesson|lessons|class|classes|workshop|two step|twostep|line dance|linedance)\\b",
    "\\b(open mic|open-mic|karaoke|trivia|dj|dance night)\\b",
    "\\b(free|happy hour)\\b",
  ].join("|"),
  "i"
);

/* -------------------- CLI args -------------------- */

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const OUT = argValue("--out", "./data/cityRankings.v2.json");

const DAYS = Number(argValue("--days", String(DEFAULT_HORIZON_DAYS)));
const HORIZON_DAYS = Number.isFinite(DAYS) ? Math.max(30, Math.min(DAYS, 365)) : DEFAULT_HORIZON_DAYS;

const RADIUS_MILES = Number(argValue("--radius", String(DEFAULT_RADIUS_MILES)));
const RADIUS = Number.isFinite(RADIUS_MILES) ? Math.max(25, Math.min(RADIUS_MILES, 250)) : DEFAULT_RADIUS_MILES;

const SIZE = Number(argValue("--size", String(DEFAULT_SIZE)));
const PAGE_SIZE = Number.isFinite(SIZE) ? Math.max(10, Math.min(SIZE, 200)) : DEFAULT_SIZE;

const MAX_PAGES = Number(argValue("--pages", String(DEFAULT_MAX_PAGES)));
const PAGES = Number.isFinite(MAX_PAGES) ? Math.max(1, Math.min(MAX_PAGES, 5)) : DEFAULT_MAX_PAGES;

const SPACING_MS = Number(argValue("--spacingMs", String(DEFAULT_SPACING_MS)));
const SPACING = Number.isFinite(SPACING_MS) ? Math.max(0, Math.min(SPACING_MS, 5000)) : DEFAULT_SPACING_MS;

/* -------------------- Helpers -------------------- */

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ymdUTC(dt) {
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

function toUTCDateFromYMD(ymd) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

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

function isRankingNoise(e) {
  const name = String(e?.name || "").trim();
  if (!name) return true;
  if (NOISE_REGEX.test(name)) return true;
  return false;
}

// Light dedupe by (name+date+venue+city) — sufficient for ranking
function dedupeEvents(events) {
  const map = new Map();
  for (const e of events || []) {
    const name = normStr(e?.name);
    const date = String(e?.dates?.start?.localDate || "");
    const v = e?._embedded?.venues?.[0] || {};
    const venue = normStr(v?.name);
    const city = normStr(v?.city?.name);
    if (!name || !date) continue;
    const key = `${name}|${date}|${venue}|${city}`;
    if (!map.has(key)) map.set(key, e);
  }
  return Array.from(map.values());
}

function eventToLite(e) {
  const v = e?._embedded?.venues?.[0] || {};
  return {
    id: e?.id || null,
    name: e?.name || "",
    date: e?.dates?.start?.localDate || null,
    venue: v?.name || null,
    city: v?.city?.name || null,
  };
}

function countByDateMap(events) {
  const m = new Map();
  for (const e of events || []) {
    const d = e?.dates?.start?.localDate;
    if (!d) continue;
    m.set(d, (m.get(d) || 0) + 1);
  }
  return m;
}

// Best N-day window by event count (simple; good enough for ranking)
function bestTripWindowScore(events, tripDays = 4) {
  const countByDate = countByDateMap(events);
  const dates = Array.from(countByDate.keys()).sort();
  if (!dates.length) return { bestWindowEvents: 0, bestWindowStart: null };

  let best = 0;
  let bestStart = null;

  for (const d0 of dates) {
    const startDt = toUTCDateFromYMD(d0);
    let total = 0;
    for (let i = 0; i < tripDays; i++) {
      const di = ymdUTC(addDaysUTC(startDt, i));
      total += countByDate.get(di) || 0;
    }
    if (total > best) {
      best = total;
      bestStart = d0;
    }
  }

  return { bestWindowEvents: best, bestWindowStart: bestStart };
}

// Diminishing returns + diversity + best-window density
function cityScore({ eventCount, uniqueVenues, uniqueDays, bestWindowEvents }) {
  const log1p = (x) => Math.log(1 + Math.max(0, x));
  return (
    40 * log1p(eventCount) +
    18 * log1p(uniqueVenues) +
    18 * log1p(uniqueDays) +
    25 * log1p(bestWindowEvents)
  );
}

async function fetchJsonWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json: j, headers: res.headers };
  } finally {
    clearTimeout(t);
  }
}

function parseRetryAfterMs(headers) {
  const ra = headers?.get?.("retry-after");
  if (!ra) return null;
  const s = String(ra).trim();
  if (/^\d+$/.test(s)) return Math.max(0, Number(s)) * 1000;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  const ms = dt.getTime() - Date.now();
  return ms > 0 ? ms : 0;
}

/* -------------------- Candidate Cities -------------------- */
/**
 * Only include cities you are willing to recommend.
 * Keep them “metro centers” to avoid weird suggestions.
 */
const CANDIDATE_SEEDS = [
  // 🇺🇸 United States
  { key: "POP_NYC", label: "New York, NY",               lat: 40.7128, lon: -74.0060,  country: "US" },
  { key: "POP_LA",  label: "Los Angeles, CA",            lat: 34.0522, lon: -118.2437, country: "US" },
  { key: "POP_CHI", label: "Chicago, IL",                lat: 41.8781, lon: -87.6298,  country: "US" },
  { key: "POP_DAL", label: "Dallas, TX",                 lat: 32.7767, lon: -96.7970,  country: "US" },
  { key: "POP_HOU", label: "Houston, TX",                lat: 29.7604, lon: -95.3698,  country: "US" },
  { key: "POP_PHX", label: "Phoenix, AZ",                lat: 33.4484, lon: -112.0740, country: "US" },
  { key: "POP_PHI", label: "Philadelphia, PA",           lat: 39.9526, lon: -75.1652,  country: "US" },
  { key: "POP_SAT", label: "San Antonio, TX",            lat: 29.4241, lon: -98.4936,  country: "US" },
  { key: "POP_SDN", label: "San Diego, CA",              lat: 32.7157, lon: -117.1611, country: "US" },
  { key: "POP_DTW", label: "Detroit, MI",                lat: 42.3314, lon: -83.0458,  country: "US" },
  { key: "POP_ATL", label: "Atlanta, GA",                lat: 33.7490, lon: -84.3880,  country: "US" },
  { key: "POP_MIA", label: "Miami, FL",                  lat: 25.7617, lon: -80.1918,  country: "US" },
  { key: "POP_BOS", label: "Boston, MA",                 lat: 42.3601, lon: -71.0589,  country: "US" },
  { key: "POP_SEA", label: "Seattle, WA",                lat: 47.6062, lon: -122.3321, country: "US" },
  { key: "POP_DEN", label: "Denver, CO",                 lat: 39.7392, lon: -104.9903, country: "US" },
  { key: "POP_NAS", label: "Nashville, TN",              lat: 36.1627, lon: -86.7816,  country: "US" },
  { key: "POP_ATX", label: "Austin, TX",                 lat: 30.2672, lon: -97.7431,  country: "US" },
  { key: "POP_SJC", label: "San Jose, CA",               lat: 37.3382, lon: -121.8863, country: "US" },
  { key: "POP_CLV", label: "Cleveland, OH",              lat: 41.4993, lon: -81.6944,  country: "US" },
  { key: "POP_MIN", label: "Minneapolis, MN",            lat: 44.9778, lon: -93.2650,  country: "US" },
  { key: "POP_SLC", label: "Salt Lake City, UT",         lat: 40.7608, lon: -111.8910, country: "US" },
  { key: "POP_PRT", label: "Portland, OR",               lat: 45.5051, lon: -122.6750, country: "US" },
  { key: "POP_ORL", label: "Orlando, FL",                lat: 28.5383, lon: -81.3792,  country: "US" },
  { key: "POP_PIT", label: "Pittsburgh, PA",             lat: 40.4406, lon: -79.9959,  country: "US" },
  { key: "POP_STL", label: "St. Louis, MO",              lat: 38.6270, lon: -90.1994,  country: "US" },
  { key: "POP_CINF",label: "Cincinnati, OH",             lat: 39.1031, lon: -84.5120,  country: "US" },
  { key: "POP_BAL", label: "Baltimore, MD",              lat: 39.2904, lon: -76.6122,  country: "US" },
  { key: "POP_SAN", label: "San Juan, PR",               lat: 18.4655, lon: -66.1057,  country: "US" },
  { key: "POP_KC",  label: "Kansas City, MO",            lat: 39.0997, lon: -94.5786,  country: "US" },
  { key: "POP_COH", label: "Charlotte, NC",              lat: 35.2271, lon: -80.8431,  country: "US" },
  { key: "POP_IND", label: "Indianapolis, IN",           lat: 39.7684, lon: -86.1581,  country: "US" },
  { key: "POP_CMH", label: "Columbus, OH",               lat: 39.9612, lon: -82.9988,  country: "US" },
  { key: "POP_LVU", label: "Las Vegas, NV",              lat: 36.1699, lon: -115.1398, country: "US" },
  { key: "POP_JAX", label: "Jacksonville, FL",           lat: 30.3322, lon: -81.6557,  country: "US" },
  { key: "POP_TUL", label: "Tulsa, OK",                  lat: 36.1539, lon: -95.9928,  country: "US" },
  { key: "POP_NEW", label: "New Orleans, LA",            lat: 29.9511, lon: -90.0715,  country: "US" },
  { key: "POP_RAL", label: "Raleigh, NC",                lat: 35.7796, lon: -78.6382,  country: "US" },
  { key: "POP_MIL", label: "Milwaukee, WI",              lat: 43.0389, lon: -87.9065,  country: "US" },
  { key: "POP_VEG", label: "Virginia Beach, VA",         lat: 36.8529, lon: -75.9780,  country: "US" },
  { key: "POP_RENO",label: "Reno, NV",                   lat: 39.5296, lon: -119.8138, country: "US" },
  { key: "POP_OMA", label: "Omaha, NE",                  lat: 41.2565, lon: -95.9345,  country: "US" },
  { key: "POP_TUC", label: "Tucson, AZ",                 lat: 32.2226, lon: -110.9747, country: "US" },
  { key: "POP_HRL", label: "Hartford, CT",               lat: 41.7658, lon: -72.6734,  country: "US" },
  { key: "POP_ONT", label: "Ontario, CA",                lat: 34.0633, lon: -117.6509, country: "US" },
  { key: "POP_CBUS",label: "Columbia, SC",               lat: 34.0007, lon: -81.0348,  country: "US" },

  // 🇨🇦 Canada
  { key: "POP_YYZ", label: "Toronto, ON",            lat: 43.6532, lon: -79.3832,  country: "CA" },
  { key: "POP_YVR", label: "Vancouver, BC",          lat: 49.2827, lon: -123.1207, country: "CA" },
  { key: "POP_YUL", label: "Montreal, QC",           lat: 45.5019, lon: -73.5674,  country: "CA" },
  { key: "POP_YYC", label: "Calgary, AB",            lat: 51.0447, lon: -114.0719, country: "CA" },
  { key: "POP_YEG", label: "Edmonton, AB",           lat: 53.5461, lon: -113.4938, country: "CA" },
  { key: "POP_WPG", label: "Winnipeg, MB",           lat: 49.8951, lon: -97.1384,  country: "CA" },
  { key: "POP_YSJ", label: "Saint John, NB",         lat: 45.2730, lon: -66.0633,  country: "CA" },
  { key: "POP_YQR", label: "Regina, SK",             lat: 50.4452, lon: -104.6189, country: "CA" },
  { key: "POP_YTZ", label: "Toronto Island, ON",     lat: 43.6289, lon: -79.3969,  country: "CA" },
  { key: "POP_HFX", label: "Halifax, NS",            lat: 44.6488, lon: -63.5752,  country: "CA" },
];

const SPORTS_OVERRIDE_SEEDS = [
  { key: "SP_GBR", label: "Green Bay, WI", lat: 44.5133, lon: -88.0133, country: "US" },
  { key: "SP_BUF", label: "Buffalo, NY",   lat: 42.8864, lon: -78.8784, country: "US" },
  { key: "SP_CLE", label: "Cleveland, OH", lat: 41.4993, lon: -81.6944, country: "US" },
];

function mergeSeedsUniqueByKey(...lists) {
  const m = new Map();
  for (const list of lists) {
    for (const s of list || []) {
      if (!s?.key) continue;
      if (!m.has(s.key)) m.set(s.key, s);
    }
  }
  return Array.from(m.values());
}

const ALL_SEEDS = mergeSeedsUniqueByKey(CANDIDATE_SEEDS, SPORTS_OVERRIDE_SEEDS);

/* -------------------- Genres to index -------------------- */
/**
 * Keep these as internal keys + the TM classificationName you want to query.
 */
const TARGETS = [
  // Music
  { domain: "music", genreKey: "country", classificationName: "Country" },
  { domain: "music", genreKey: "rock",    classificationName: "Rock" },
  { domain: "music", genreKey: "pop",     classificationName: "Pop" },
  { domain: "music", genreKey: "rnb",     classificationName: "R&B" },
  { domain: "music", genreKey: "hiphop",  classificationName: "Hip-Hop/Rap" },
  { domain: "music", genreKey: "latin",   classificationName: "Latin" },
  { domain: "music", genreKey: "edm",     classificationName: "Dance/Electronic" },
  { domain: "music", genreKey: "jazz",    classificationName: "Jazz" },

  // Sports
  { domain: "sports", genreKey: "baseball",   classificationName: "Baseball" },
  { domain: "sports", genreKey: "football",   classificationName: "Football" },
  { domain: "sports", genreKey: "basketball", classificationName: "Basketball" },
  { domain: "sports", genreKey: "hockey",     classificationName: "Hockey" },
  { domain: "sports", genreKey: "soccer",     classificationName: "Soccer" },
];

function segmentNameForDomain(domain) {
  const d = String(domain || "").toLowerCase();
  if (d === "music") return "Music";
  if (d === "sports") return "Sports";
  if (d === "arts") return "Arts & Theatre";
  return null;
}

/* -------------------- TM fetch per (seed, target) -------------------- */

async function tmFetchEvents({ seed, domain, classificationName, countryCode, startYMD, endYMD }) {
  const seg = segmentNameForDomain(domain);
  const all = [];

  for (let page = 0; page < PAGES; page++) {
    const p = new URLSearchParams();
    p.set("apikey", TM_KEY);
    p.set("sort", "date,asc");
    p.set("latlong", `${seed.lat},${seed.lon}`);
    p.set("radius", String(RADIUS));
    p.set("unit", "miles");
    p.set("startDateTime", `${startYMD}T00:00:00Z`);
    p.set("endDateTime", `${endYMD}T23:59:59Z`);
    p.set("size", String(PAGE_SIZE));
    p.set("page", String(page));
    p.set("includeFamily", "no");

    if (countryCode) p.set("countryCode", countryCode);
    if (seg) p.set("segmentName", seg);
    if (classificationName) p.set("classificationName", classificationName);

    const url = `${TM_EVENTS}?${p.toString()}`;

    // Basic retry for 429
    let attempt = 0;
    while (attempt < 2) {
      attempt++;
      const { ok, status, json, headers } = await fetchJsonWithTimeout(url, DEFAULT_TIMEOUT_MS);

      if (status === 429) {
        const ra = parseRetryAfterMs(headers) ?? 30_000;
        console.warn(`429 rate limited. Waiting ${Math.ceil(ra / 1000)}s (seed=${seed.key} page=${page})`);
        await sleep(ra);
        continue;
      }

      if (!ok) {
        console.warn(`TM error status=${status} (seed=${seed.key} page=${page})`);
        return all; // best-so-far for this seed
      }

      const events = Array.isArray(json?._embedded?.events) ? json._embedded.events : [];
      all.push(...events);

      if (events.length < PAGE_SIZE) return all; // no more pages
      break;
    }

    await sleep(SPACING);
  }

  return all;
}

/* -------------------- Build rankings -------------------- */

let PARTIAL_RESULT = null;
let DID_INTERRUPT = false;

process.on("SIGINT", () => {
  DID_INTERRUPT = true;
  console.warn("\nCaught Ctrl+C. Will write partial output if available...");
});

async function buildRankings() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = addDaysUTC(start, HORIZON_DAYS);

  const startYMD = ymdUTC(start);
  const endYMD = ymdUTC(end);

  const result = {
    version: 2,
    builtAt: new Date().toISOString(),
    horizonDays: HORIZON_DAYS,
    startYMD,
    endYMD,
    params: { radiusMiles: RADIUS, pageSize: PAGE_SIZE, maxPages: PAGES, spacingMs: SPACING },
    seeds: ALL_SEEDS,
    rankings: {},     // rankings[domain][genreKey][countryCode] = rows[]
    dailyCounts: {},  // ✅ dailyCounts[domain][genreKey][countryCode][ymd][cityKey] = count
  };

  for (const t of TARGETS) {
    if (DID_INTERRUPT) break;

    result.rankings[t.domain] = result.rankings[t.domain] || {};
    result.rankings[t.domain][t.genreKey] = result.rankings[t.domain][t.genreKey] || {};

    result.dailyCounts[t.domain] = result.dailyCounts[t.domain] || {};
    result.dailyCounts[t.domain][t.genreKey] = result.dailyCounts[t.domain][t.genreKey] || {};

    for (const cc of ["US", "CA"]) {
      if (DID_INTERRUPT) break;

      const seeds = ALL_SEEDS.filter((s) => s.country === cc);
      const rows = [];

      result.dailyCounts[t.domain][t.genreKey][cc] = result.dailyCounts[t.domain][t.genreKey][cc] || {};
      const dailyBucket = result.dailyCounts[t.domain][t.genreKey][cc]; // alias

      for (let i = 0; i < seeds.length; i++) {
        if (DID_INTERRUPT) break;

        const seed = seeds[i];
        console.log(`[${t.domain}/${t.genreKey}/${cc}] (${i + 1}/${seeds.length}) ${seed.label}`);

        const raw = await tmFetchEvents({
          seed,
          domain: t.domain,
          classificationName: t.classificationName,
          countryCode: cc,
          startYMD,
          endYMD,
        });

        // Filter noise -> dedupe
        const filtered = (raw || []).filter((e) => !isRankingNoise(e));
        const events = dedupeEvents(filtered);

        // ✅ write date bins (sparse; only dates present)
        const byDate = countByDateMap(events);
        for (const [d, c] of byDate.entries()) {
          dailyBucket[d] = dailyBucket[d] || {};
          dailyBucket[d][seed.key] = (dailyBucket[d][seed.key] || 0) + c;
        }

        // Compute whole-horizon meta (keep v1-style rows)
        const venues = new Set();
        const days = new Set();
        for (const e of events) {
          const v = e?._embedded?.venues?.[0]?.name;
          const d = e?.dates?.start?.localDate;
          if (v) venues.add(normStr(v));
          if (d) days.add(d);
        }

        const { bestWindowEvents, bestWindowStart } = bestTripWindowScore(events, 4);
        const eventCount = events.length;
        const uniqueVenues = venues.size;
        const uniqueDays = days.size;

        const score = cityScore({ eventCount, uniqueVenues, uniqueDays, bestWindowEvents });

        rows.push({
          cityKey: seed.key,
          label: seed.label,
          countryCode: cc,
          score: Math.round(score * 1000) / 1000,
          meta: {
            eventCount,
            uniqueVenues,
            uniqueDays,
            bestWindowEvents,
            bestWindowStart,
            sample: events.slice(0, 3).map(eventToLite),
          },
        });

        await sleep(SPACING);
      }

      rows.sort((a, b) => (b.score || 0) - (a.score || 0));
      result.rankings[t.domain][t.genreKey][cc] = rows;

      // Update partial result continuously so Ctrl+C still yields useful output
      PARTIAL_RESULT = result;
    }
  }

  return result;
}

async function main() {
  const data = await buildRankings();
  const toWrite = data || PARTIAL_RESULT;

  if (!toWrite) {
    console.error("No output produced.");
    process.exit(1);
  }

  ensureDir(OUT);
  fs.writeFileSync(OUT, JSON.stringify(toWrite, null, 2), "utf8");
  const hash = sha1(fs.readFileSync(OUT, "utf8"));

  if (DID_INTERRUPT) {
    console.warn(`Wrote PARTIAL output to ${OUT} (sha1=${hash})`);
  } else {
    console.log(`Wrote ${OUT} (sha1=${hash})`);
  }
}

main().catch((e) => {
  console.error(e);
  try {
    if (PARTIAL_RESULT) {
      ensureDir(OUT);
      fs.writeFileSync(OUT, JSON.stringify(PARTIAL_RESULT, null, 2), "utf8");
      console.warn(`Wrote PARTIAL output to ${OUT} after error.`);
    }
  } catch {}
  process.exit(1);
});