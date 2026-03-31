export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { SeriesKey } from "@/lib/favorites/types";
import TM from "@/lib/tm/client";
import { normalizeTMEvent, type NormEvent } from "@/lib/events/normalize";
import { dedupeEvents } from "@/lib/events/dedupe";
import { isYMD, ymdToTmRangeInclusive } from "@/lib/time/window";
import { uniqueStrings } from "@/lib/events/match";
import { allVisibleGenreLabels, findGenreKeyByLabel } from "@/lib/events/genres";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

type FavoriteKind = "team" | "artist" | "series";

type FavoriteInput = {
  id?: string;
  label?: string;
  kind?: FavoriteKind;
  attractionId?: string;
  seriesKey?: SeriesKey;
  defaultGenre?: string;
};

type Body = {
  city: { label: string; lat: number; lon: number } | null;
  startDate: string | null;
  endDate: string | null;
  radiusMiles?: number;
  countryCode?: string;
  favorites?: FavoriteInput[];
  genres?: string[];
};

function safeStr(x: any): string | null {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  return s ? s : null;
}

function normalizeToken(x: any): string {
  return String(x || "").trim().toLowerCase();
}

function uniqCaseInsensitive(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const val = safeStr(raw);
    if (!val) continue;

    const key = val.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(val);
  }

  return out;
}

function collectResponseGenres(events: NormEvent[]): string[] {
  return uniqueStrings(events.flatMap((e) => e.canonicalGenres || [])).sort((a, b) =>
    a.localeCompare(b)
  );
}

function sanitizeFavorites(input: any): FavoriteInput[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((f) => ({
      id: safeStr(f?.id) || undefined,
      label: safeStr(f?.label) || undefined,
      kind: (safeStr(f?.kind)?.toLowerCase() as FavoriteKind | null) || undefined,
      attractionId: safeStr(f?.attractionId) || undefined,
      seriesKey: (safeStr(f?.seriesKey) as SeriesKey | null) || undefined,
      defaultGenre: safeStr(f?.defaultGenre) || undefined,
    }))
    .filter((f) => f.label || f.attractionId || f.seriesKey);
}

function sanitizeGenres(input: any): string[] {
  if (!Array.isArray(input)) return [];

  const allowed = new Set(allVisibleGenreLabels().map((g) => g.toLowerCase()));

  return uniqCaseInsensitive(input.map((g) => safeStr(g))).filter((g) =>
    allowed.has(g.toLowerCase())
  );
}

function extractTmAttractionLite(tm: any): Array<{ id: string; name: string }> {
  const raw = Array.isArray(tm?._embedded?.attractions) ? tm._embedded.attractions : [];
  const out: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();

  for (const a of raw) {
    const id = safeStr(a?.id);
    const name = safeStr(a?.name);
    if (!id && !name) continue;

    const dedupeKey = `${normalizeToken(id)}__${normalizeToken(name)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      id: id || "",
      name: name || "",
    });
  }

  return out;
}

function seriesKeywords(seriesKey: SeriesKey): string[] {
  switch (seriesKey) {
    case "f1":
      return ["Formula 1", "F1", "Grand Prix"];
    case "nascar":
      return ["NASCAR"];
    case "indy":
      return ["IndyCar", "Indycar", "NTT IndyCar Series"];
    case "pga":
      return ["PGA Tour", "PGA"];
    case "lpga":
      return ["LPGA"];
    case "liv":
      return ["LIV Golf", "LIV"];
    case "tgl":
      return ["TGL"];
    case "ufc":
      return ["UFC"];
    case "atp":
      return ["ATP Tour", "ATP"];
    case "wta":
      return ["WTA Tour", "WTA"];
    default:
      return [];
  }
}

function eventMatchesSeriesKeyword(
  tm: any,
  seriesKey: SeriesKey | undefined
): boolean {
  if (!seriesKey) return false;

  const haystack = [
    safeStr(tm?.name),
    safeStr(tm?.info),
    safeStr(tm?.pleaseNote),
    ...(Array.isArray(tm?._embedded?.attractions)
      ? tm._embedded.attractions.flatMap((a: any) => [safeStr(a?.name)])
      : []),
    ...(Array.isArray(tm?.classifications)
      ? tm.classifications.flatMap((c: any) => [
          safeStr(c?.segment?.name),
          safeStr(c?.genre?.name),
          safeStr(c?.subGenre?.name),
          safeStr(c?.type?.name),
          safeStr(c?.subType?.name),
        ])
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return seriesKeywords(seriesKey).some((kw) =>
    haystack.includes(String(kw).trim().toLowerCase())
  );
}

function matchFavoritesForEvent(
  tm: any,
  attractions: Array<{ id: string; name: string }>,
  favorites: FavoriteInput[]
) {
  const matchedFavorites: string[] = [];
  const matchedAttractionIds: string[] = [];
  const matchedDefaultGenres: string[] = [];

  const eventAttractionIdKeys = new Set(
    attractions.map((a) => normalizeToken(a.id)).filter(Boolean)
  );
  const eventAttractionNameKeys = new Set(
    attractions.map((a) => normalizeToken(a.name)).filter(Boolean)
  );

  for (const fav of favorites) {
    const favLabelKey = normalizeToken(fav.label);
    const favAttractionIdKey = normalizeToken(fav.attractionId);

    const byAttractionId =
      !!favAttractionIdKey && eventAttractionIdKeys.has(favAttractionIdKey);
    const byLabel = !!favLabelKey && eventAttractionNameKeys.has(favLabelKey);
    const bySeries =
      fav.kind === "series" &&
      !!fav.seriesKey &&
      eventMatchesSeriesKeyword(tm, fav.seriesKey);

    if (!byAttractionId && !byLabel && !bySeries) continue;

    if (fav.label) matchedFavorites.push(fav.label);
    if (fav.attractionId) matchedAttractionIds.push(fav.attractionId);

    const defaultGenre = safeStr(fav.defaultGenre);
    if (defaultGenre && findGenreKeyByLabel(defaultGenre)) {
      matchedDefaultGenres.push(defaultGenre);
    }
  }

  return {
    favorites: uniqCaseInsensitive(matchedFavorites),
    attractionIds: uniqCaseInsensitive(matchedAttractionIds),
    defaultGenres: uniqCaseInsensitive(matchedDefaultGenres),
  };
}

function clampRadiusMiles(value: number | undefined) {
  return Math.max(10, Math.min(300, Number(value ?? 90)));
}

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizePlaceToken(s: string | null | undefined) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function placesMatch(
  searchedCity: { label: string; lat: number; lon: number },
  event: NormEvent
) {
  const searchedLabel = normalizePlaceToken(searchedCity.label);
  const eventCity = normalizePlaceToken(event.city);
  const eventRegion = normalizePlaceToken(event.region);

  if (!searchedLabel || !eventCity) return false;

  // exact city match
  if (searchedLabel === eventCity) return true;

  // handle "Calgary, AB"
  if (searchedLabel.includes(",")) {
    const [cityPart, regionPart] = searchedLabel.split(",").map((x) => x.trim());

    if (cityPart === eventCity) {
      if (!regionPart) return true;
      return regionPart === eventRegion;
    }
  }

  return false;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    if (
      !body.city ||
      typeof body.city.lat !== "number" ||
      typeof body.city.lon !== "number" ||
      !Number.isFinite(body.city.lat) ||
      !Number.isFinite(body.city.lon)
    ) {
      return json({ error: "City (with valid lat/lon) is required" }, 400);
    }

    if (!isYMD(body.startDate) || !isYMD(body.endDate)) {
      return json({ error: "StartDate/EndDate required (YYYY-MM-DD)" }, 400);
    }

    const s = new Date(`${body.startDate}T12:00:00`);
    const e = new Date(`${body.endDate}T12:00:00`);
    const diffDays = Math.round((e.getTime() - s.getTime()) / 86400000);

    if (!Number.isFinite(diffDays)) return json({ error: "Invalid date range" }, 400);
    if (diffDays < 0) return json({ error: "EndDate must be >= StartDate" }, 400);
    if (diffDays > 14) return json({ error: "Max window is 14 days" }, 400);

    const favorites = sanitizeFavorites(body.favorites);
    const requestedGenres = sanitizeGenres(body.genres);
    const radiusMiles = clampRadiusMiles(body.radiusMiles);

    const { startDateTime, endDateTime } = ymdToTmRangeInclusive(
      body.startDate,
      body.endDate
    );

    const tmEvents = await TM.tmSearchEventsAll({
      latlong: `${body.city.lat},${body.city.lon}`,
      radius: radiusMiles,
      unit: "miles",
      startDateTime,
      endDateTime,
      countryCode: body.countryCode || "US,CA",
      sort: "date,asc",
      size: 200,
    });

    const normalized: NormEvent[] = [];

    for (const tm of tmEvents) {
      const ne = normalizeTMEvent(tm);
      if (!ne) continue;
      if (!ne.url) continue;
      if (!Array.isArray(ne.canonicalGenres) || ne.canonicalGenres.length === 0) continue;

      const attractions = extractTmAttractionLite(tm);
      const favoriteMatches = matchFavoritesForEvent(tm, attractions, favorites);

      ne.matched = {
        favorites: favoriteMatches.favorites,
        attractionIds: favoriteMatches.attractionIds,
        defaultGenres: favoriteMatches.defaultGenres,
        genres: ne.canonicalGenres,
      };

      ne.pillLabel = ne.canonicalGenres[0] || null;

      normalized.push(ne);
    }

    const deduped = dedupeEvents(normalized);

    const genreFiltered: NormEvent[] =
      requestedGenres.length > 0
        ? deduped.filter((e) =>
            requestedGenres.some((g) =>
              (e.canonicalGenres || []).some((cg) => cg.toLowerCase() === g.toLowerCase())
            )
          )
        : deduped;

    const events: NormEvent[] = genreFiltered.filter((e) => {
  const lat = typeof e.lat === "number" ? e.lat : null;
  const lon = typeof e.lon === "number" ? e.lon : null;

  if (lat === null || lon === null) return false;

  const d = distanceMiles(body.city!.lat, body.city!.lon, lat, lon);
if (d > radiusMiles) return false;

return placesMatch(body.city!, e);

});

    const genres = collectResponseGenres(events);

    return json({
      mode: "area",
      city: body.city,
      startDate: body.startDate,
      endDate: body.endDate,
      genres,
      requestedGenres,
      requestedFavorites: favorites.map((f) => ({
        label: f.label || null,
        kind: f.kind || null,
        attractionId: f.attractionId || null,
        seriesKey: f.seriesKey || null,
        defaultGenre: f.defaultGenre || null,
      })),
      count: events.length,
      events,
    });
  } catch (e: any) {
    console.error("api/search/area error:", e);
    return json({ error: e?.message || "Failed" }, 500);
  }
}