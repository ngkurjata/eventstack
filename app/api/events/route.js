// FILE: app/api/events/route.js
import { NextResponse } from "next/server";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_EVENTS = `${TM_BASE}/events.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

const PAGE_SIZE = 200; // TM max ~200
const MAX_PAGES = 6; // per country, per genre bucket
const HARD_EVENT_CAP = 600;

// light throttle to reduce 429s
const TM_THROTTLE_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(res, status = 200) {
  return NextResponse.json(res, { status });
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function isYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const iv = Math.trunc(n);
  if (iv < lo) return lo;
  if (iv > hi) return hi;
  return iv;
}

function ymdToISOStringStart(ymd) {
  return `${ymd}T00:00:00Z`;
}

function ymdToISOStringEndExclusive(ymd) {
  const [Y, M, D] = String(ymd).split("-").map((v) => Number(v));
  const dt = new Date(Date.UTC(Y, M - 1, D));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}T00:00:00Z`;
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

async function fetchTM(url) {
  await sleep(TM_THROTTLE_MS);

  const res = await fetch(url, { cache: "no-store" });

  // naive single retry for 429/5xx
  if ((res.status === 429 || res.status >= 500) && res.status !== 501) {
    await sleep(350);
    return fetch(url, { cache: "no-store" });
  }
  return res;
}

async function fetchGenreBucket({
  lat,
  lon,
  radiusMiles,
  countryCodes,
  startYMD,
  endYMD,
  classificationName,
}) {
  const startDateTime = ymdToISOStringStart(startYMD);
  const endDateTime = ymdToISOStringEndExclusive(endYMD);

  const out = [];
  const debug = [];

  for (const cc of countryCodes) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const u = new URL(TM_EVENTS);
      u.searchParams.set("apikey", TM_KEY);
      u.searchParams.set("size", String(PAGE_SIZE));
      u.searchParams.set("page", String(page));

      u.searchParams.set("latlong", `${lat},${lon}`);
      u.searchParams.set("radius", String(radiusMiles));
      u.searchParams.set("unit", "miles");

      u.searchParams.set("startDateTime", startDateTime);
      u.searchParams.set("endDateTime", endDateTime);

      // IMPORTANT: one country per request
      if (cc) u.searchParams.set("countryCode", cc);

      // classificationName bucket
      if (classificationName) u.searchParams.set("classificationName", classificationName);

      const res = await fetchTM(u.toString());

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      const evs = data?._embedded?.events || [];
      const count = Array.isArray(evs) ? evs.length : 0;

      debug.push({ cc, page, status: res.status, count });

      if (!res.ok) break;
      if (!Array.isArray(evs) || evs.length === 0) break;

      out.push(...evs);

      const totalPages = Number(data?.page?.totalPages ?? 0);
      if (Number.isFinite(totalPages) && page + 1 >= totalPages) break;

      if (out.length >= HARD_EVENT_CAP * 2) break;
    }

    if (out.length >= HARD_EVENT_CAP * 2) break;
  }

  return { events: out, debug };
}

function simplifyEvent(ev, matchedGenres, pillGenre) {
  const id = String(ev?.id || "");
  const name = String(ev?.name || "").trim();

  const dates = ev?.dates?.start || {};
  const localDate = dates?.localDate || null;
  const localTime = dates?.localTime || null;

  const venue = ev?._embedded?.venues?.[0] || null;
  const city = venue?.city?.name || "";
  const state = venue?.state?.stateCode || venue?.state?.name || "";
  const venueName = venue?.name || "";
  const url = ev?.url || null;

  return {
    id,
    name,
    localDate,
    localTime,
    city: String(city || ""),
    region: String(state || ""),
    venueName: String(venueName || ""),
    url,
    matchedGenres: Array.isArray(matchedGenres) ? matchedGenres : [],
    pillGenre: pillGenre || "",
  };
}

export async function GET(req) {
  if (!TM_KEY) return json({ error: "Missing TICKETMASTER_API_KEY" }, 500);

  const { searchParams } = new URL(req.url);

  const lat = toNumber(searchParams.get("lat"));
  const lon = toNumber(searchParams.get("lon"));
  const radiusMiles = clampInt(searchParams.get("radiusMiles"), 10, 300, 120);

  // Accept start/end plus common aliases to prevent “silent” breakages
  const start =
    String(searchParams.get("start") || "").trim() ||
    String(searchParams.get("startDate") || "").trim() ||
    String(searchParams.get("startYMD") || "").trim();

  const end =
    String(searchParams.get("end") || "").trim() ||
    String(searchParams.get("endDate") || "").trim() ||
    String(searchParams.get("endYMD") || "").trim();

  const countryCodes = normalizeCountryCodes(searchParams.get("countryCode") || "US,CA");

  const musicGenres = (searchParams.getAll("musicGenres") || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  const sportsGenres = (searchParams.getAll("sportsGenres") || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  if (lat == null || lon == null) return json({ error: "Missing lat/lon" }, 400);

  if (!isYMD(start) || !isYMD(end)) {
    return json({ error: "Missing/invalid start/end (YYYY-MM-DD)" }, 400);
  }

  // sanity: end cannot be before start
  if (end < start) {
    return json({ error: `Invalid range: end (${end}) is before start (${start}).` }, 400);
  }

  // Preserve deterministic “rank”: sports first, then music (matches UI display)
  const selectedByRank = [...sportsGenres, ...musicGenres];

  const debug = {
    selectedByRank,
    perSelectedGenre: {},
    tmPages: [],
    countryCodes,
  };

  // eventId -> { ev, matched:Set<string> }
  const byId = new Map();

  const buckets = selectedByRank.length ? selectedByRank : [""]; // "" means ANY

  for (const g of buckets) {
    const key = g || "ANY";

    const got = await fetchGenreBucket({
      lat,
      lon,
      radiusMiles,
      countryCodes,
      startYMD: start,
      endYMD: end,
      classificationName: g || "",
    });

    debug.perSelectedGenre[key] = got.events.length;
    debug.tmPages.push({ bucket: key, pages: got.debug });

    for (const ev of got.events) {
      const id = String(ev?.id || "").trim();
      if (!id) continue;

      const cur = byId.get(id);
      if (!cur) byId.set(id, { ev, matched: new Set(g ? [g] : []) });
      else if (g) cur.matched.add(g);

      if (byId.size >= HARD_EVENT_CAP * 2) break;
    }

    if (byId.size >= HARD_EVENT_CAP * 2) break;
  }

  const merged = Array.from(byId.values())
    .slice(0, HARD_EVENT_CAP)
    .map(({ ev, matched }) => {
      const mg = Array.from(matched);

      // Pick pillGenre using rank first (sports first then music), fallback to first matched.
      const pill = selectedByRank.find((x) => mg.includes(x)) || mg[0] || "";

      return simplifyEvent(ev, mg, pill);
    });

  merged.sort((a, b) => {
    const ad = a.localDate || "";
    const bd = b.localDate || "";
    if (ad !== bd) return ad.localeCompare(bd);
    const at = a.localTime || "";
    const bt = b.localTime || "";
    return at.localeCompare(bt);
  });

  return json({
    count: merged.length,
    events: merged,
    debug,
  });
}