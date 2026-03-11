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
  anchorEventId?: string;

  anchor?: {
    localDate?: string;
    lat?: number | null;
    lon?: number | null;
    city?: string;
  } | null;

  anchorLocalDate?: string;
  anchorLat?: number;
  anchorLon?: number;

  localDate?: string;
  lat?: number;
  lon?: number;

  favorites: Favorite[];
  genres?: string[];
  radiusMiles?: number;
  countryCode?: string;
};

function toFiniteNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeToken(v: string | null | undefined) {
  return String(v || "").trim().toLowerCase();
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const raw = String(value || "").trim();
    const key = raw.toLowerCase();
    if (!raw || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }

  return out;
}

function pickAnchor(body: Body): AnchorInput | null {
  const a = body.anchor || null;
  const aLocalDate = a?.localDate ? String(a.localDate).trim() : "";
  const aLat = toFiniteNumber(a?.lat);
  const aLon = toFiniteNumber(a?.lon);

  if (aLocalDate && isYMD(aLocalDate) && aLat !== null && aLon !== null) {
    return { localDate: aLocalDate, lat: aLat, lon: aLon, city: a?.city };
  }

  const bLocalDate = body.anchorLocalDate ? String(body.anchorLocalDate).trim() : "";
  const bLat = toFiniteNumber(body.anchorLat);
  const bLon = toFiniteNumber(body.anchorLon);

  if (bLocalDate && isYMD(bLocalDate) && bLat !== null && bLon !== null) {
    return { localDate: bLocalDate, lat: bLat, lon: bLon };
  }

  const cLocalDate = body.localDate ? String(body.localDate).trim() : "";
  const cLat = toFiniteNumber(body.lat);
  const cLon = toFiniteNumber(body.lon);

  if (cLocalDate && isYMD(cLocalDate) && cLat !== null && cLon !== null) {
    return { localDate: cLocalDate, lat: cLat, lon: cLon };
  }

  return null;
}

function isJunkEvent(ne: any): boolean {
  const name = String(ne?.name ?? "").trim();
  const city = String(ne?.city ?? ne?.location?.city ?? "").trim();
  const venue = String(ne?.venueName ?? ne?.venue ?? "").trim();

  if (!name) return true;
  if (name.toLowerCase().includes("untitled")) return true;
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

  return (nameBad && locBad) || (nameBad && locBad && urlBad);
}

function eventQualityScore(ne: any): number {
  const name = String(ne?.name ?? "").trim().toLowerCase();
  const location = String(ne?.location ?? "").trim().toLowerCase();
  const venue = String(ne?.venueName ?? ne?.venue ?? "").trim().toLowerCase();
  const url = String(ne?.url ?? "").trim();

  let score = 0;
  if (name && !name.includes("untitled")) score += 100;
  if (url) score += 10;
  if (location && !location.includes("tbd")) score += 5;
  if (venue && !venue.includes("tbd")) score += 3;

  return score;
}

function mergeMatched(into: any, from: any) {
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

function getTMGenreCandidates(tm: any, ne: any): string[] {
  const c0 = tm?.classifications?.[0];
  return uniqueStrings([
    ne?.genre,
    c0?.segment?.name,
    c0?.genre?.name,
    c0?.subGenre?.name,
    c0?.type?.name,
    c0?.subType?.name,
  ]);
}

function getMatchedSelectedGenres(
  tm: any,
  ne: any,
  userGenres: string[]
): string[] {
  const selectedByToken = new Map(userGenres.map((g) => [normalizeToken(g), g]));
  const matches: string[] = [];

  for (const candidate of getTMGenreCandidates(tm, ne)) {
    const token = normalizeToken(candidate);
    const selected = selectedByToken.get(token);
    if (selected) matches.push(selected);
  }

  return uniqueStrings(matches);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const favorites = (body.favorites || []).filter((f) => f?.attractionId);
    if (favorites.length < 1) {
      return json({ error: "favorites required" }, 400);
    }

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

    const userGenres = uniqueStrings(
      (body.genres || []).map((s) => String(s).trim())
    ).slice(0, 4);

    const w = anchorWindowYMD(anchor.localDate, 3);
    const { startDateTime, endDateTime } = ymdToTmRangeInclusive(w.start, w.end);

    const radiusMiles = Math.max(5, Math.min(200, Number(body.radiusMiles ?? 90) || 90));
    const countryCode = String(body.countryCode || "US,CA").trim() || "US,CA";

    const defaultGenres = uniqueStrings(
      favorites.map((f) => f.defaultGenre).filter(Boolean)
    );

    const classificationValues = uniqueStrings([...userGenres, ...defaultGenres]);
    const classificationName = classificationValues.join(",");

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
      if (isJunkEvent(ne)) continue;

      const hasUrl = Boolean(tm?.url);
      const venue0 = tm?._embedded?.venues?.[0];
      const hasVenueCity = Boolean(venue0?.city?.name);
      const hasVenueName = Boolean(venue0?.name);
      if (!hasUrl || !hasVenueCity || !hasVenueName) continue;

      const embeddedAttractions = (tm?._embedded?.attractions || [])
        .map((a: any) => String(a?.id || ""))
        .filter(Boolean);

      const matchedFavIds = favorites
        .filter((fav) => embeddedAttractions.includes(fav.attractionId))
        .map((fav) => fav.id);

      const matchedGenres = getMatchedSelectedGenres(tm, ne, userGenres);

      const matchedDefaultGenres = favorites
        .filter((fav) => matchedFavIds.includes(fav.id))
        .map((fav) => fav.defaultGenre);

      const includeEvent = matchedFavIds.length > 0 || matchedGenres.length > 0;
      if (!includeEvent) continue;

      ne.matched.favorites = uniqueStrings(matchedFavIds);
      ne.matched.genres = uniqueStrings(matchedGenres);
      ne.matched.defaultGenres = uniqueStrings(matchedDefaultGenres);

      normalized.push(ne);
    }

    const deduped = dedupeEvents(normalized);
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

    const events = Array.from(byKey.values()).filter((e) => !isProbablyJunk(e));
    const cleanedEvents = events.filter((e) => !isPlaceholderRow(e));

    const presentFavorites = uniqueStrings(
      cleanedEvents.flatMap((e: any) => e?.matched?.favorites || [])
    );

    const presentGenres = uniqueStrings(
      cleanedEvents.flatMap((e: any) => e?.matched?.genres || [])
    );

    const requiredFavoriteIds = favorites.map((f) => f.id);
    const requirementsMet =
      requiredFavoriteIds.every((id) => presentFavorites.includes(id)) &&
      userGenres.every((g) =>
        presentGenres.some((pg) => normalizeToken(pg) === normalizeToken(g))
      );

    const hasTwoFavs = favorites.length >= 2;
    const crossoverInWindow =
      hasTwoFavs && cleanedEvents.some((e: any) => (e?.matched?.favorites || []).length >= 2);

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
        classificationName: classificationValues,
        radiusMiles,
        countryCode,
      },
      required: {
        favorites: requiredFavoriteIds,
        genres: userGenres,
      },
      present: {
        favorites: presentFavorites,
        genres: presentGenres,
      },
      requirementsMet,
      crossoverInWindow,
      count: cleanedEvents.length,
      events: cleanedEvents,
    });
  } catch (e: any) {
    const msg = String(e?.message || "Failed");

    if (msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate limit")) {
      console.error("api/trip/context rate-limited:", e);
      return json({ error: "Ticketmaster rate limit hit. Wait a bit, then try again." }, 429);
    }

    console.error("api/trip/context error:", e);
    return json({ error: msg }, 500);
  }
}