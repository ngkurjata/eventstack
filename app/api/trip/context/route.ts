// FILE: app/api/trip/context/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import TM from "@/lib/tm/client";
import { normalizeTMEvent, type NormEvent } from "@/lib/events/normalize";
import { dedupeEvents } from "@/lib/events/dedupe";
import { anchorWindowYMD, isYMD, ymdToTmRangeInclusive } from "@/lib/time/window";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

type Favorite = {
  id: string; // "F1" / "F2"
  label: string;
  attractionId: string;
  defaultGenre: string;
};

type AnchorInput = {
  localDate: string; // YYYY-MM-DD
  lat: number;
  lon: number;
  city?: string;
};

type Body = {
  // Old callers might send this; keep it, but do NOT require it.
  anchorEventId?: string;

  // Canonical shape (preferred)
  anchor?: {
    localDate?: string;
    lat?: number | null;
    lon?: number | null;
    city?: string;
  } | null;

  // Alternate shapes (for compatibility / convenience)
  anchorLocalDate?: string;
  anchorLat?: number;
  anchorLon?: number;

  localDate?: string;
  lat?: number;
  lon?: number;

  favorites: Favorite[]; // 1..2
  genres?: string[]; // 0..2 (classificationName)
  radiusMiles?: number;
  countryCode?: string; // "US,CA"
};

function toFiniteNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickAnchor(body: Body): AnchorInput | null {
  // 1) nested anchor
  const a = body.anchor || null;
  const aLocalDate = a?.localDate ? String(a.localDate).trim() : "";
  const aLat = toFiniteNumber(a?.lat);
  const aLon = toFiniteNumber(a?.lon);

  if (aLocalDate && isYMD(aLocalDate) && aLat !== null && aLon !== null) {
    return { localDate: aLocalDate, lat: aLat, lon: aLon, city: a?.city };
  }

  // 2) anchorLocalDate/anchorLat/anchorLon
  const bLocalDate = body.anchorLocalDate ? String(body.anchorLocalDate).trim() : "";
  const bLat = toFiniteNumber(body.anchorLat);
  const bLon = toFiniteNumber(body.anchorLon);

  if (bLocalDate && isYMD(bLocalDate) && bLat !== null && bLon !== null) {
    return { localDate: bLocalDate, lat: bLat, lon: bLon };
  }

  // 3) localDate/lat/lon
  const cLocalDate = body.localDate ? String(body.localDate).trim() : "";
  const cLat = toFiniteNumber(body.lat);
  const cLon = toFiniteNumber(body.lon);

  if (cLocalDate && isYMD(cLocalDate) && cLat !== null && cLon !== null) {
    return { localDate: cLocalDate, lat: cLat, lon: cLon };
  }

  return null;
}

/**
 * Filters out TM placeholder / malformed events that cause:
 * - "Untitled event"
 * - "Location TBD"
 * - No venue/city
 */
function isJunkEvent(ne: any): boolean {
  const name = String(ne?.name ?? "").trim();
  const city = String(ne?.city ?? ne?.location?.city ?? "").trim();
  const venue = String(ne?.venueName ?? ne?.venue ?? "").trim();

  if (!name) return true;
  if (name.toLowerCase().includes("untitled")) return true;

  // Location TBD / missing location is almost always garbage for your UX
  if (!city || city.toLowerCase().includes("tbd")) return true;
  if (!venue || venue.toLowerCase().includes("tbd")) return true;

  return false;
}

function isProbablyJunk(ne: any): boolean {
  const name = String(ne?.name ?? "").trim();
  const location = String(ne?.location ?? "").trim();
  const url = String(ne?.url ?? "").trim();

  const nameBad = !name || name.toLowerCase().includes("untitled");
  const locBad =
    !location ||
    location.toLowerCase().includes("location tbd") ||
    location.toLowerCase().includes("tbd");
  const urlBad = !url;

  // Only drop if it is clearly placeholder-ish (avoid nuking legit events)
  return (nameBad && locBad) || (nameBad && locBad && urlBad);
}

function eventQualityScore(ne: any): number {
  const name = String(ne?.name ?? "").trim().toLowerCase();
  const location = String(ne?.location ?? "").trim().toLowerCase();
  const venue = String(ne?.venueName ?? ne?.venue ?? "").trim().toLowerCase();
  const url = String(ne?.url ?? "").trim();

  let score = 0;

  // Make real names win over placeholders
  if (name && !name.includes("untitled")) score += 100;

  // Secondary signals
  if (url) score += 10;
  if (location && !location.includes("tbd")) score += 5;
  if (venue && !venue.includes("tbd")) score += 3;

  return score;
}

function mergeMatched(into: any, from: any) {
  // Keep whichever is already present + union arrays
  const m1 = (into.matched ||= {});
  const m2 = from?.matched || {};

  const mergeArr = (a?: string[], b?: string[]) =>
    Array.from(new Set([...(a || []), ...(b || [])]));

  m1.favorites = mergeArr(m1.favorites, m2.favorites);
  m1.genres = mergeArr(m1.genres, m2.genres);
  m1.defaultGenres = mergeArr(m1.defaultGenres, m2.defaultGenres);

  return into;
}

function isPlaceholderRow(ne: any): boolean {
  const name = String(ne?.name ?? "").trim().toLowerCase();
  const location = String(ne?.location ?? "").trim().toLowerCase();

  if (name === "untitled event") return true;
  if (name.startsWith("untitled")) return true;

  if (location === "location tbd") return true;
  if (location.includes("location tbd")) return true;

  return false;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const favorites = (body.favorites || []).filter((f) => f?.attractionId);
    if (favorites.length < 1) return json({ error: "favorites required" }, 400);

    const anchor = pickAnchor(body);
    if (!anchor) {
      return json(
        {
          error:
            "anchor required (provide anchor.localDate/lat/lon OR anchorLocalDate/anchorLat/anchorLon OR localDate/lat/lon)",
        },
        400
      );
    }

    const userGenres = (body.genres || [])
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 2);

    // fixed ±3 days
    const w = anchorWindowYMD(anchor.localDate, 3);
    const { startDateTime, endDateTime } = ymdToTmRangeInclusive(w.start, w.end);

    const radiusMiles = Math.max(5, Math.min(200, Number(body.radiusMiles ?? 90) || 90));
    const countryCode = String(body.countryCode || "US,CA").trim() || "US,CA";

    const defaultGenres = favorites.map((f) => f.defaultGenre).filter(Boolean);
    const clsSet = new Set<string>([...userGenres, ...defaultGenres]);
    const classificationName = Array.from(clsSet).join(",");

    const tmEvents = await TM.tmSearchEventsAll({
      latlong: `${anchor.lat},${anchor.lon}`,
      radius: radiusMiles,
      unit: "miles",
      startDateTime,
      endDateTime,
      countryCode,
      classificationName: classificationName || undefined,
      sort: "date,asc",
      size: 200,
    });

    const normalized: NormEvent[] = [];

    for (const tm of tmEvents) {
      const ne = normalizeTMEvent(tm);
      if (!ne) continue;

      // STEP 1: normalized-level junk filter
      if (isJunkEvent(ne)) continue;

      // STEP 2: TM-level sanity checks (prevents "No link" zombies)
      const hasUrl = Boolean(tm?.url);
      const venue0 = tm?._embedded?.venues?.[0];
      const hasVenueCity = Boolean(venue0?.city?.name);
      const hasVenueName = Boolean(venue0?.name);
      if (!hasUrl || !hasVenueCity || !hasVenueName) continue;

      // keep your existing tags
      ne.matched.genres = userGenres;
      ne.matched.defaultGenres = defaultGenres;

      // best-effort favorite match tagging (TM embedding inconsistent)
      const embeddedAttractions = (tm?._embedded?.attractions || [])
        .map((a: any) => String(a?.id || ""))
        .filter(Boolean);

      const matchedFavIds: string[] = [];
      for (const fav of favorites) {
        if (embeddedAttractions.includes(fav.attractionId)) matchedFavIds.push(fav.id);
      }
      ne.matched.favorites = matchedFavIds;

      normalized.push(ne);
    }

    // First perform your existing canonical dedupe
const deduped = dedupeEvents(normalized);

// Then choose the best representation per canonicalKey
const byKey = new Map<string, NormEvent>();

for (const e of deduped) {
const key =
  e.canonicalKey ||
  `${(e as any).ts || ""}|${e.name || ""}|${(e as any).location || ""}`;
  const prev = byKey.get(key);

  if (!prev) {
    byKey.set(key, e);
    continue;
  }

  const prevScore = eventQualityScore(prev);
  const eScore = eventQualityScore(e);

  if (eScore > prevScore) {
    mergeMatched(e as any, prev as any);
    byKey.set(key, e);
  } else {
    mergeMatched(prev as any, e as any);
  }
}

// Remove obvious placeholders
const events = Array.from(byKey.values()).filter((e) => !isProbablyJunk(e));

    const hasTwoFavs = favorites.length >= 2;
    const crossoverInWindow = hasTwoFavs && events.some((e) => (e.matched.favorites || []).length >= 2);

    const cleanedEvents = events.filter((e) => !isPlaceholderRow(e));

return json({
  anchor: {
    localDate: anchor.localDate,
    lat: anchor.lat,
    lon: anchor.lon,
    city: anchor.city || "",
  },
  anchorWindow: { start: w.start, end: w.end, daysEachSide: 3 },
  filters: {
    userGenres,
    defaultGenres,
    classificationName: Array.from(clsSet),
    radiusMiles,
    countryCode,
  },
  crossoverInWindow,
  count: cleanedEvents.length,
  events: cleanedEvents,
});

  } catch (e: any) {
    console.error("api/trip/context error:", e);
    return json({ error: e?.message || "Failed" }, 500);
  }
}