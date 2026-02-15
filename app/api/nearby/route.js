// app/api/nearby/route.js
import { NextResponse } from "next/server";

const TM_EVENTS = "https://app.ticketmaster.com/discovery/v2/events.json";

// Public (no-email) mode presets. Keep backend enforcement in sync with UI + /api/search.
const PUBLIC_MODE = true;
const PUBLIC_PRESET = {
  maxRadiusMiles: 50,
};

// Target leagues (normalized)
const DEFAULT_SPORTS_LEAGUES = ["MLB", "NHL", "NBA", "MLS", "NFL", "CFL"];

function toISOStartOfDayZ(yyyyMMdd) {
  return yyyyMMdd ? `${yyyyMMdd}T00:00:00Z` : null;
}

function toISOEndOfDayZ(yyyyMMdd) {
  return yyyyMMdd ? `${yyyyMMdd}T23:59:59Z` : null;
}

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(x)));
}

function clampRadiusMiles(raw) {
  if (PUBLIC_MODE) {
    return clampInt(
      raw ?? PUBLIC_PRESET.maxRadiusMiles,
      1,
      PUBLIC_PRESET.maxRadiusMiles,
      PUBLIC_PRESET.maxRadiusMiles
    );
  }
  // non-public mode: allow wider range
  return clampInt(raw ?? 100, 1, 2000, 100);
}

function isYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

/**
 * Tries to infer the pro league tag (NBA/NFL/etc) from Ticketmaster classifications.
 * TM data varies, so we accept matches across segment/type/genre/subGenre/subType names.
 */
function getLeagueTagFromEvent(ev) {
  const classes = Array.isArray(ev?.classifications) ? ev.classifications : [];
  for (const c of classes) {
    const candidates = [
      c?.segment?.name,
      c?.type?.name,
      c?.subType?.name,
      c?.genre?.name,
      c?.subGenre?.name,
    ]
      .map((v) => String(v || "").trim())
      .filter(Boolean);

    for (const name of candidates) {
      const up = name.toUpperCase();

      // direct abbreviations
      if (DEFAULT_SPORTS_LEAGUES.includes(up)) return up;

      // common long names
      if (up.includes("NATIONAL BASKETBALL")) return "NBA";
      if (up.includes("NATIONAL FOOTBALL")) return "NFL";
      if (up.includes("NATIONAL HOCKEY")) return "NHL";
      if (up.includes("MAJOR LEAGUE BASEBALL")) return "MLB";
      if (up.includes("MAJOR LEAGUE SOCCER")) return "MLS";
      if (up.includes("CANADIAN FOOTBALL")) return "CFL";
    }
  }
  return null;
}

function eventId(ev) {
  const id = String(ev?.id || "").trim();
  return id || null;
}

/**
 * Pulls a larger pool from TM for the radius/time window, then post-filters:
 * - include ALL matching sports-league events
 * - plus top N "other" events by relevance order as returned by TM
 */
async function runNearbyLookup({
  apiKey,
  lat,
  lng,
  radiusMiles,
  startDate,
  endDate,
  otherLimit,
  excludeIds,
  sportsLeagues,
}) {
  const params = new URLSearchParams();
  params.set("apikey", apiKey);
  params.set("latlong", `${lat},${lng}`);
  params.set("radius", String(radiusMiles));
  params.set("unit", "miles");

  // Pull enough to capture all sports + enough "other" events.
  // TM max size can vary; 200 is typically safe. If TM returns less, we still work.
  params.set("size", "200");

  // “Popularity-ish” ranking from TM for the pool (helps the "top 5 other" selection)
  params.set("sort", "relevance,desc");

  const s = toISOStartOfDayZ(startDate);
  const e = toISOEndOfDayZ(endDate);
  if (s) params.set("startDateTime", s);
  if (e) params.set("endDateTime", e);

  const url = `${TM_EVENTS}?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();

  const rawEvents = Array.isArray(data?._embedded?.events) ? data._embedded.events : [];

  const leaguesSet = new Set(
    (Array.isArray(sportsLeagues) && sportsLeagues.length ? sportsLeagues : DEFAULT_SPORTS_LEAGUES)
      .map((x) => String(x).toUpperCase().trim())
      .filter(Boolean)
  );

  // 1) filter invalid + excludes
  const base = rawEvents.filter((ev) => {
    const id = eventId(ev);
    if (!id) return false;
    if (excludeIds.has(id)) return false;
    return true;
  });

  // 2) partition into sports target leagues vs "other"
  const sports = [];
  const other = [];

  for (const ev of base) {
    const tag = getLeagueTagFromEvent(ev);
    if (tag && leaguesSet.has(tag)) sports.push(ev);
    else other.push(ev);
  }

  // 3) Take top N other (already relevance-sorted by TM)
  const otherTop = other.slice(0, otherLimit);

  // 4) Merge (sports all + otherTop), preserve TM order within each bucket
  const merged = [...sports, ...otherTop];

  return {
    events: merged,
    debug: {
      url,
      lat,
      lng,
      radiusMiles,
      startDate,
      endDate,
      otherLimit,
      sportsLeagues: Array.from(leaguesSet),
      returnedRaw: rawEvents.length,
      returnedAfterExcludes: base.length,
      sportsReturned: sports.length,
      otherCandidates: other.length,
      otherReturned: otherTop.length,
      excludedCount: excludeIds.size,
    },
  };
}

// GET (existing behavior)
export async function GET(req) {
  try {
    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 500 });

    const { searchParams } = new URL(req.url);

    const lat = safeNum(searchParams.get("lat"), null);
    const lng = safeNum(searchParams.get("lng"), null);

    const radiusMiles = clampRadiusMiles(searchParams.get("radiusMiles"));

    const startDate = (searchParams.get("startDate") || "").trim(); // YYYY-MM-DD
    const endDate = (searchParams.get("endDate") || "").trim(); // YYYY-MM-DD

    // ✅ New: "otherLimit" (top N non-league events). default 5, clamp 0..25
    const otherLimitRaw = safeNum(searchParams.get("otherLimit"), 5);
    const otherLimit = Math.min(Math.max(otherLimitRaw ?? 5, 0), 25);

    // ✅ Optional override: sportsLeagues=MLB,NHL,...
    const sportsLeaguesRaw = (searchParams.get("sportsLeagues") || "").trim();
    const sportsLeagues = sportsLeaguesRaw
      ? sportsLeaguesRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_SPORTS_LEAGUES;

    const excludeIdsRaw = (searchParams.get("excludeIds") || "").trim();
    const excludeIds = new Set(
      excludeIdsRaw ? excludeIdsRaw.split(",").map((s) => s.trim()).filter(Boolean) : []
    );

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ events: [], error: "Missing or invalid lat/lng." }, { status: 400 });
    }
    if (!startDate || !endDate || !isYMD(startDate) || !isYMD(endDate)) {
      return NextResponse.json(
        { events: [], error: "Missing startDate or endDate (YYYY-MM-DD)." },
        { status: 400 }
      );
    }

    const out = await runNearbyLookup({
      apiKey,
      lat,
      lng,
      radiusMiles,
      startDate,
      endDate,
      otherLimit,
      excludeIds,
      sportsLeagues,
    });

    return NextResponse.json(out);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ events: [], error: "Nearby lookup failed" }, { status: 500 });
  }
}

// POST (recommended to avoid huge excludeIds querystrings)
export async function POST(req) {
  try {
    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 500 });

    const body = (await req.json().catch(() => null)) || {};

    const lat = safeNum(body.lat, null);
    const lng = safeNum(body.lng, null);

    const radiusMiles = clampRadiusMiles(body.radiusMiles);

    const startDate = String(body.startDate || "").trim();
    const endDate = String(body.endDate || "").trim();

    // ✅ New: "otherLimit" (top N non-league events). default 5, clamp 0..25
    const otherLimitRaw = safeNum(body.otherLimit, 5);
    const otherLimit = Math.min(Math.max(otherLimitRaw ?? 5, 0), 25);

    // ✅ Optional override: sportsLeagues: ["MLB","NHL",...]
    const sportsLeagues =
      Array.isArray(body.sportsLeagues) && body.sportsLeagues.length
        ? body.sportsLeagues
        : DEFAULT_SPORTS_LEAGUES;

    const excludeIdsArr = Array.isArray(body.excludeIds) ? body.excludeIds : [];
    const excludeIds = new Set(excludeIdsArr.map((x) => String(x).trim()).filter(Boolean));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ events: [], error: "Missing or invalid lat/lng." }, { status: 400 });
    }
    if (!startDate || !endDate || !isYMD(startDate) || !isYMD(endDate)) {
      return NextResponse.json(
        { events: [], error: "Missing startDate or endDate (YYYY-MM-DD)." },
        { status: 400 }
      );
    }

    const out = await runNearbyLookup({
      apiKey,
      lat,
      lng,
      radiusMiles,
      startDate,
      endDate,
      otherLimit,
      excludeIds,
      sportsLeagues,
    });

    return NextResponse.json(out);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ events: [], error: "Nearby lookup failed" }, { status: 500 });
  }
}
