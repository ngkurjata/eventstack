// app/api/nearby/route.js
import { NextResponse } from "next/server";

const TM_EVENTS = "https://app.ticketmaster.com/discovery/v2/events.json";

// Public (no-email) mode presets. Keep backend enforcement in sync with UI + /api/search.
const PUBLIC_MODE = true;
const PUBLIC_PRESET = {
  maxRadiusMiles: 300,
};

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
    return clampInt(raw ?? PUBLIC_PRESET.maxRadiusMiles, 1, PUBLIC_PRESET.maxRadiusMiles, PUBLIC_PRESET.maxRadiusMiles);
  }
  // non-public mode: allow wider range
  return clampInt(raw ?? 100, 1, 2000, 100);
}

async function runNearbyLookup({
  apiKey,
  lat,
  lng,
  radiusMiles,
  startDate,
  endDate,
  limit,
  excludeIds,
}) {
  const params = new URLSearchParams();
  params.set("apikey", apiKey);
  params.set("latlong", `${lat},${lng}`);
  params.set("radius", String(radiusMiles));
  params.set("unit", "miles");

  // pull extra so we can filter excludes then take top N
  params.set("size", "50");

  // “Popularity-ish” ranking from TM
  params.set("sort", "relevance,desc");

  const s = toISOStartOfDayZ(startDate);
  const e = toISOEndOfDayZ(endDate);
  if (s) params.set("startDateTime", s);
  if (e) params.set("endDateTime", e);

  const url = `${TM_EVENTS}?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();

  const rawEvents = data?._embedded?.events || [];
  const filtered = rawEvents.filter((ev) => {
    const id = String(ev?.id || "");
    if (!id) return false;
    if (excludeIds.has(id)) return false;
    return true;
  });

  return {
    events: filtered.slice(0, limit),
    debug: {
      url,
      lat,
      lng,
      radiusMiles,
      startDate,
      endDate,
      limit,
      returnedRaw: rawEvents.length,
      returnedFiltered: Math.min(filtered.length, limit),
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

    // default to 5, clamp 1..10
    const limitRaw = safeNum(searchParams.get("limit"), 5);
    const limit = Math.min(Math.max(limitRaw || 5, 1), 10);

    const excludeIdsRaw = (searchParams.get("excludeIds") || "").trim();
    const excludeIds = new Set(
      excludeIdsRaw ? excludeIdsRaw.split(",").map((s) => s.trim()).filter(Boolean) : []
    );

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ events: [], error: "Missing or invalid lat/lng." }, { status: 400 });
    }
    if (!startDate || !endDate) {
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
      limit,
      excludeIds,
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

    const limitRaw = safeNum(body.limit, 5);
    const limit = Math.min(Math.max(limitRaw || 5, 1), 10);

    const excludeIdsArr = Array.isArray(body.excludeIds) ? body.excludeIds : [];
    const excludeIds = new Set(excludeIdsArr.map((x) => String(x).trim()).filter(Boolean));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ events: [], error: "Missing or invalid lat/lng." }, { status: 400 });
    }
    if (!startDate || !endDate) {
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
      limit,
      excludeIds,
    });

    return NextResponse.json(out);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ events: [], error: "Nearby lookup failed" }, { status: 500 });
  }
}
