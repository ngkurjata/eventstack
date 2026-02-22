// FILE: app/api/search/route.js
import { NextResponse } from "next/server";

function json(payload, status = 200) {
  return NextResponse.json(payload, { status });
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

export async function GET(req) {
  const { searchParams } = new URL(req.url);

  // Inputs (routing only; keep permissive)
  const start = String(searchParams.get("start") || "").trim();
  const end = String(searchParams.get("end") || "").trim();

  const tripDays = clampInt(searchParams.get("tripDays"), 2, 14, 4);
  const radiusMiles = clampInt(searchParams.get("radiusMiles"), 1, 500, 120);
  const countryCode = String(searchParams.get("countryCode") || "US,CA").trim() || "US,CA";

  const destCityId = String(searchParams.get("destCityId") || "").trim();
  const destCityLabel = String(searchParams.get("destCityLabel") || "").trim();
  const destIata = String(searchParams.get("destIata") || "").trim().toUpperCase();

  const latRaw = searchParams.get("lat");
  const lonRaw = searchParams.get("lon");
  const lat = latRaw != null && latRaw !== "" ? Number(latRaw) : null;
  const lon = lonRaw != null && lonRaw !== "" ? Number(lonRaw) : null;

  const primaryId = String(searchParams.get("primaryId") || "").trim();
  const secondaryId = String(searchParams.get("secondaryId") || "").trim();

  const genreOrder = String(searchParams.get("genreOrder") || "").trim();
  const musicGenres = searchParams
    .getAll("musicGenres")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  const sportsGenres = searchParams
    .getAll("sportsGenres")
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  // Validate core requirements
  if (!isYMD(start) || !isYMD(end)) {
    return json({ ok: false, error: "Missing/invalid start/end (YYYY-MM-DD)" }, 400);
  }
  if (end < start) {
    return json({ ok: false, error: "End date must be the same as or after the Start date." }, 400);
  }

  // Genre #1 required (your UX rule)
  const ranked = genreOrder
    ? genreOrder.split(",").map((x) => x.trim()).filter(Boolean)
    : [];
  const fallbackGenres = [...sportsGenres, ...musicGenres].filter(Boolean);
  const effectiveGenres = ranked.length ? ranked : fallbackGenres;

  if (!effectiveGenres.length) {
    return json({ ok: false, error: "Pick at least 1 genre." }, 400);
  }

  // Decide whether “where” is present.
  const hasLatLon = Number.isFinite(lat) && Number.isFinite(lon);
  const hasIata = destIata.length === 3;

  // If you have coordinates, that is "where" even if destCityId is missing.
  const hasCity = hasLatLon && Boolean(destCityId || destCityLabel);

  const hasWhere = hasCity || hasIata;

  // Rule: force TripStyle based on where
  const tripStyle = hasWhere ? "A" : "B";

  // Build nextUrl QS
  const qs = new URLSearchParams();
  qs.set("tripStyle", tripStyle);
  qs.set("start", start);
  qs.set("end", end);
  qs.set("tripDays", String(tripDays));
  qs.set("radiusMiles", String(radiusMiles));
  qs.set("countryCode", countryCode);

  if (primaryId) qs.set("primaryId", primaryId);
  if (secondaryId) qs.set("secondaryId", secondaryId);

  // Canonical ranked order
  qs.set("genreOrder", effectiveGenres.join(","));

  // Preserve category params if callers provided them
  for (const g of sportsGenres) qs.append("sportsGenres", g);
  for (const g of musicGenres) qs.append("musicGenres", g);

  // If caller didn’t split categories, mirror ranked -> musicGenres (back-compat)
  if (!sportsGenres.length && !musicGenres.length) {
    for (const g of effectiveGenres) qs.append("musicGenres", g);
  }

  if (tripStyle === "A") {
    if (hasIata) qs.set("destIata", destIata);

    if (hasLatLon) {
      if (destCityId) qs.set("destCityId", destCityId);
      if (destCityLabel) qs.set("destCityLabel", destCityLabel);
      qs.set("lat", String(lat));
      qs.set("lon", String(lon));
    }
  }

  const nextUrl = tripStyle === "A" ? `/events?${qs.toString()}` : `/trips?${qs.toString()}`;

  return json({
    ok: true,
    tripStyle,
    nextUrl,
    debug: {
      hasWhere,
      hasCity,
      hasIata,
      hasLatLon,
      effectiveGenres,
    },
  });
}