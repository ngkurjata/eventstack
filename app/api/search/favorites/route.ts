export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { FavoriteKind, SeriesKey } from "@/lib/favorites/types";
import { makeFavorite } from "@/lib/favorites/factory";
import TM from "@/lib/tm/client";
import { normalizeTMEvent, type NormEvent } from "@/lib/events/normalize";
import { dedupeEvents } from "@/lib/events/dedupe";
import { fetchSeriesTMEvents } from "@/lib/favorites/fetchSeriesEvents";
import { isYMD, ymdToTmRangeInclusive } from "@/lib/time/window";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

type FavoriteInput = {
  id?: string;
  label: string;
  kind?: FavoriteKind;
  attractionId?: string;
  seriesKey?: SeriesKey;
  defaultGenre?: string | null;
};

type Body = {
  favorite1: FavoriteInput | null;
  favorite2?: FavoriteInput | null;
  startDate?: string | null;
  endDate?: string | null;
  countryCode?: string;
  genres?: string[];
};

type MatchBag = {
  favorites: string[];
  attractionIds: string[];
  defaultGenres: string[];
  genres: string[];
};

type FavoriteEventCacheEntry = {
  expiresAt: number;
  data: NormEvent[];
};

type SearchCacheEntry = {
  expiresAt: number;
  payload: any;
};

type ResolvedFavorite = {
  id: string;
  label: string;
  kind: FavoriteKind;
  attractionId?: string;
  seriesKey?: SeriesKey;
  defaultGenre: string;
};

const FAVORITE_EVENT_TTL_MS = 10 * 60_000;
const SEARCH_TTL_MS = 5 * 60_000;
const DEFAULT_COUNTRY_CODE = "US,CA";
const DEFAULT_RADIUS_MILES = 90;
const DEFAULT_DAYS_EACH_SIDE = 3;
const MAX_GENRES = 4;

const TM_PAGE_SIZE = 200;
const TM_MAX_PAGES = 8;
const TM_STALL_PAGES = 2;

const favoriteEventCache = new Map<string, FavoriteEventCacheEntry>();
const inflightFavoriteFetches = new Map<string, Promise<NormEvent[]>>();

const searchCache = new Map<string, SearchCacheEntry>();
const inflightSearches = new Map<string, Promise<any>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("rate limit") || msg.includes("quota") || msg.includes("429");
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRateLimitError(err)) throw err;
    await sleep(800);
    return await fn();
  }
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

function normalizeGenresInput(values: string[] | null | undefined) {
  return uniqueStrings((values || []).map((g) => String(g || "").trim())).slice(0, MAX_GENRES);
}

function normalizeFavoriteKind(value: unknown): FavoriteKind {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "artist" || raw === "series") return raw;
  return "team";
}

function resolveFavorite(
  input: FavoriteInput | null | undefined,
  fallbackId: string
): ResolvedFavorite | null {
  if (!input) return null;

  const kind = normalizeFavoriteKind(input.kind);
  const label = String(input.label || "").trim();
  const attractionId = String(input.attractionId || "").trim();
  const defaultGenre = String(input.defaultGenre || "").trim();
  const id = String(input.id || fallbackId).trim() || fallbackId;
  const seriesKey = input.seriesKey;

  if (!label) return null;

  const favorite = makeFavorite({
    id,
    label,
    kind,
    defaultGenre,
    attractionId: kind === "series" ? undefined : attractionId || undefined,
    seriesKey: kind === "series" ? seriesKey : undefined,
  });

  if (favorite.kind === "series") {
    if (!favorite.seriesKey) return null;
    return {
      id: favorite.id,
      label: favorite.label,
      kind: favorite.kind,
      seriesKey: favorite.seriesKey,
      defaultGenre: favorite.defaultGenre || "",
    };
  }

  if (!favorite.attractionId) return null;

  return {
    id: favorite.id,
    label: favorite.label,
    kind: favorite.kind,
    attractionId: favorite.attractionId,
    defaultGenre: favorite.defaultGenre || "",
  };
}

function makeFavoriteEventKey(args: {
  favorite: ResolvedFavorite;
  countryCode: string;
  startDateTime?: string;
  endDateTime?: string;
}) {
  return [
    args.favorite.kind,
    args.favorite.attractionId || "",
    args.favorite.seriesKey || "",
    args.countryCode,
    args.startDateTime || "",
    args.endDateTime || "",
  ].join("|");
}

function makeSearchKey(args: {
  favorite1: ResolvedFavorite;
  favorite2: ResolvedFavorite | null;
  startDate: string | null;
  endDate: string | null;
  countryCode: string;
  genres: string[];
}) {
  return JSON.stringify({
    f1: {
      id: args.favorite1.id,
      label: args.favorite1.label,
      kind: args.favorite1.kind,
      attractionId: args.favorite1.attractionId || "",
      seriesKey: args.favorite1.seriesKey || "",
      defaultGenre: args.favorite1.defaultGenre,
    },
    f2: args.favorite2
      ? {
          id: args.favorite2.id,
          label: args.favorite2.label,
          kind: args.favorite2.kind,
          attractionId: args.favorite2.attractionId || "",
          seriesKey: args.favorite2.seriesKey || "",
          defaultGenre: args.favorite2.defaultGenre,
        }
      : null,
    startDate: args.startDate,
    endDate: args.endDate,
    countryCode: args.countryCode,
    genres: [...args.genres].sort((a, b) => a.localeCompare(b)),
  });
}

function parseYMDToUTC(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function daysBetweenYMD(a: string, b: string): number {
  const ms = Math.abs(parseYMDToUTC(a) - parseYMDToUTC(b));
  return Math.round(ms / 86400000);
}

function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.7613;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

function isNearbyAnchorMatch(
  anchor: NormEvent,
  candidate: NormEvent,
  radiusMiles: number,
  daysEachSide = DEFAULT_DAYS_EACH_SIDE
) {
  if (
    !anchor.localDate ||
    !candidate.localDate ||
    !isYMD(anchor.localDate) ||
    !isYMD(candidate.localDate) ||
    typeof anchor.lat !== "number" ||
    typeof anchor.lon !== "number" ||
    typeof candidate.lat !== "number" ||
    typeof candidate.lon !== "number"
  ) {
    return false;
  }

  if (daysBetweenYMD(anchor.localDate, candidate.localDate) > daysEachSide) {
    return false;
  }

  return milesBetween(anchor.lat, anchor.lon, candidate.lat, candidate.lon) <= radiusMiles;
}

function ensureMatched(ne: NormEvent): MatchBag {
  const matched = (ne.matched || {}) as Partial<MatchBag>;
  const normalized: MatchBag = {
    favorites: Array.isArray(matched.favorites) ? matched.favorites : [],
    attractionIds: Array.isArray(matched.attractionIds) ? matched.attractionIds : [],
    defaultGenres: Array.isArray(matched.defaultGenres) ? matched.defaultGenres : [],
    genres: Array.isArray(matched.genres) ? matched.genres : [],
  };
  (ne as any).matched = normalized;
  return normalized;
}

function isJunkNorm(ne: any): boolean {
  const name = String(ne?.name ?? "").trim();
  const city = String(ne?.city ?? ne?.location?.city ?? "").trim();
  const venue = String(ne?.venueName ?? ne?.venue ?? "").trim();

  if (!name) return true;
  if (name.toLowerCase().includes("untitled")) return true;
  if (!city || city.toLowerCase().includes("tbd")) return true;
  if (!venue || venue.toLowerCase().includes("tbd")) return true;

  return false;
}

function isJunkTM(tm: any): boolean {
  const name = String(tm?.name ?? "").trim();
  if (!name) return true;
  if (name.toLowerCase().includes("untitled")) return true;

  const v0 = tm?._embedded?.venues?.[0];
  const vCity = String(v0?.city?.name ?? "").trim();
  const vName = String(v0?.name ?? "").trim();

  if (!vCity || vCity.toLowerCase().includes("tbd")) return true;
  if (!vName || vName.toLowerCase().includes("tbd")) return true;
  if (!tm?.url) return true;

  const d = String(tm?.dates?.start?.localDate ?? "").trim();
  if (!d || !isYMD(d)) return true;

  return false;
}

function normalizeAndDedupeTMEvents(rawEvents: any[]): NormEvent[] {
  const normalized: NormEvent[] = [];

  for (const tm of rawEvents) {
    if (isJunkTM(tm)) continue;

    const ne = normalizeTMEvent(tm);
    if (!ne) continue;
    if (isJunkNorm(ne)) continue;

    normalized.push(ne);
  }

  return dedupeEvents(normalized).filter((e) => !isJunkNorm(e));
}

async function tmSearchByAttractionUncached(args: {
  attractionId: string;
  countryCode: string;
  startDateTime?: string;
  endDateTime?: string;
}) {
  await sleep(200);

  let lastUniqueCount = 0;
  let stallPages = 0;

  const tmEvents = await withRateLimitRetry(() =>
    TM.tmSearchEventsAll(
      {
        attractionId: args.attractionId,
        countryCode: args.countryCode,
        ...(args.startDateTime ? { startDateTime: args.startDateTime } : {}),
        ...(args.endDateTime ? { endDateTime: args.endDateTime } : {}),
        sort: "date,asc",
        size: TM_PAGE_SIZE,
      },
      {
        hardCap: TM_PAGE_SIZE * TM_MAX_PAGES,
        maxPages: TM_MAX_PAGES,
        onPage(eventsSoFar) {
          const dedupedSoFar = normalizeAndDedupeTMEvents(eventsSoFar);
          const uniqueCount = dedupedSoFar.length;

          if (uniqueCount <= lastUniqueCount) {
            stallPages += 1;
          } else {
            lastUniqueCount = uniqueCount;
            stallPages = 0;
          }

          return stallPages >= TM_STALL_PAGES;
        },
      }
    )
  );

  return normalizeAndDedupeTMEvents(tmEvents);
}

async function fetchFavoriteEvents(args: {
  favorite: ResolvedFavorite;
  countryCode: string;
  startDateTime?: string;
  endDateTime?: string;
}) {
  const key = makeFavoriteEventKey(args);
  const now = Date.now();

  const cached = favoriteEventCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const inflight = inflightFavoriteFetches.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    if (args.favorite.kind === "series") {
      if (!args.favorite.seriesKey) return [] as NormEvent[];
      return fetchSeriesTMEvents({
        seriesKey: args.favorite.seriesKey,
        countryCode: args.countryCode,
        startDateTime: args.startDateTime,
        endDateTime: args.endDateTime,
      });
    }

    if (!args.favorite.attractionId) return [] as NormEvent[];

    return tmSearchByAttractionUncached({
      attractionId: args.favorite.attractionId,
      countryCode: args.countryCode,
      startDateTime: args.startDateTime,
      endDateTime: args.endDateTime,
    });
  })()
    .then((data) => {
      favoriteEventCache.set(key, {
        expiresAt: Date.now() + FAVORITE_EVENT_TTL_MS,
        data,
      });
      return data;
    })
    .finally(() => {
      inflightFavoriteFetches.delete(key);
    });

  inflightFavoriteFetches.set(key, promise);
  return promise;
}

function cleanNullableYMD(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  return raw ? raw : null;
}

function todayUtcYMD() {
  return new Date().toISOString().slice(0, 10);
}

async function runSearch(body: Body) {
  const favorite1 = resolveFavorite(body.favorite1, "F1");
  const favorite2 = resolveFavorite(body.favorite2 || null, "F2");

  if (!favorite1) {
    return { error: "Favorite 1 is required", status: 400 };
  }

  const genres = normalizeGenresInput(body.genres);
  const countryCode = String(body.countryCode || DEFAULT_COUNTRY_CODE).trim() || DEFAULT_COUNTRY_CODE;
  const radiusMiles = DEFAULT_RADIUS_MILES;
  const daysEachSide = DEFAULT_DAYS_EACH_SIDE;

  const startDate = cleanNullableYMD(body.startDate);
  const endDate = cleanNullableYMD(body.endDate);

  let startDateTime: string | undefined;
  let endDateTime: string | undefined;

  if (startDate && !isYMD(startDate)) {
    return {
      error: "startDate must be blank or YYYY-MM-DD",
      status: 400,
    };
  }

  if (endDate && !isYMD(endDate)) {
    return {
      error: "endDate must be blank or YYYY-MM-DD",
      status: 400,
    };
  }

  if (startDate && startDate < todayUtcYMD()) {
    return {
      error: "startDate cannot be earlier than today",
      status: 400,
    };
  }

  if (startDate && endDate && endDate < startDate) {
    return {
      error: "endDate cannot be earlier than startDate when both are provided",
      status: 400,
    };
  }

  if (startDate && endDate) {
    const r = ymdToTmRangeInclusive(startDate, endDate);
    startDateTime = r.startDateTime;
    endDateTime = r.endDateTime;
  } else if (startDate) {
    startDateTime = `${startDate}T00:00:00Z`;
  } else if (endDate) {
    endDateTime = `${endDate}T23:59:59Z`;
  }

  const [f1Anchors, f2Events] = await Promise.all([
    fetchFavoriteEvents({
      favorite: favorite1,
      countryCode,
      startDateTime,
      endDateTime,
    }),
    favorite2
      ? fetchFavoriteEvents({
          favorite: favorite2,
          countryCode,
          startDateTime,
          endDateTime,
        })
      : Promise.resolve([] as NormEvent[]),
  ]);

  for (const anchor of f1Anchors) {
    const matched = ensureMatched(anchor);
    matched.favorites = uniqueStrings([favorite1.id, favorite1.label]);
    matched.attractionIds = uniqueStrings([favorite1.attractionId || ""]);
    matched.defaultGenres = uniqueStrings([favorite1.defaultGenre]);
    matched.genres = [];
  }

  for (const event of f2Events) {
    const matched = ensureMatched(event);
    matched.favorites = uniqueStrings([favorite2?.id || "F2", favorite2?.label || ""]);
    matched.attractionIds = uniqueStrings([favorite2?.attractionId || ""]);
    matched.defaultGenres = uniqueStrings([favorite2?.defaultGenre || ""]);
    matched.genres = [];
  }

  const candidateAnchors = f1Anchors.filter((anchor) => {
    if (!anchor.localDate || !isYMD(String(anchor.localDate))) {
      return false;
    }

    if (!favorite2) {
      return true;
    }

    return typeof anchor.lat === "number" && typeof anchor.lon === "number";
  });

  const candidateMeta = candidateAnchors.map((anchor) => {
    const nearbyF2Events = favorite2
      ? f2Events.filter((f2e) => isNearbyAnchorMatch(anchor, f2e, radiusMiles, daysEachSide))
      : [];

    return {
      anchor,
      nearbyF2Events,
    };
  });

  const filteredMeta = favorite2
    ? candidateMeta.filter((item) => item.nearbyF2Events.length > 0)
    : candidateMeta;

  const anchorCards = filteredMeta.map(({ anchor, nearbyF2Events }) => {
    const presentFavorites = uniqueStrings([
      favorite1.id,
      favorite1.label,
      ...(nearbyF2Events.length > 0 && favorite2 ? [favorite2.id, favorite2.label] : []),
    ]);

    const presentAttractionIds = uniqueStrings([
      favorite1.attractionId || "",
      ...(nearbyF2Events.length > 0 && favorite2 ? [favorite2.attractionId || ""] : []),
    ]);

    const presentDefaultGenres = uniqueStrings([
      favorite1.defaultGenre,
      ...(nearbyF2Events.length > 0 && favorite2 ? [favorite2.defaultGenre] : []),
    ]);

    return {
      ...anchor,
      matched: {
        ...(anchor.matched || {}),
        favorites: presentFavorites,
        attractionIds: presentAttractionIds,
        defaultGenres: presentDefaultGenres,
        genres: [],
      } as any,
      isCrossover: nearbyF2Events.length > 0,
    };
  });

  return {
    mode: "favorites",
    favorites: [favorite1, ...(favorite2 ? [favorite2] : [])].map((fav) =>
      makeFavorite({
        id: fav.id,
        label: fav.label,
        kind: fav.kind,
        defaultGenre: fav.defaultGenre,
        attractionId: fav.attractionId,
        seriesKey: fav.seriesKey,
      })
    ),
    genres,
    requiredInputs: {
      favorites: [favorite1, ...(favorite2 ? [favorite2] : [])].map((fav) => fav.id),
      genres,
    },
    startDate,
    endDate,
    count: anchorCards.length,
    anchorCards,
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const favorite1 = resolveFavorite(body.favorite1, "F1");
    const favorite2 = resolveFavorite(body.favorite2 || null, "F2");

    if (!favorite1) {
      return json({ error: "Favorite 1 is required" }, 400);
    }

    const genres = normalizeGenresInput(body.genres);
    const countryCode = String(body.countryCode || DEFAULT_COUNTRY_CODE).trim() || DEFAULT_COUNTRY_CODE;

    const startDate = cleanNullableYMD(body.startDate);
    const endDate = cleanNullableYMD(body.endDate);

    const searchKey = makeSearchKey({
      favorite1,
      favorite2,
      startDate,
      endDate,
      countryCode,
      genres,
    });

    const now = Date.now();
    const cached = searchCache.get(searchKey);
    if (cached && cached.expiresAt > now) {
      return json(cached.payload);
    }

    const inflight = inflightSearches.get(searchKey);
    if (inflight) {
      const payload = await inflight;
      if (payload?.error && payload?.status) {
        return json({ error: payload.error }, payload.status);
      }
      return json(payload);
    }

    const promise = runSearch(body)
      .then((payload) => {
        if (!payload?.error) {
          searchCache.set(searchKey, {
            expiresAt: Date.now() + SEARCH_TTL_MS,
            payload,
          });
        }
        return payload;
      })
      .finally(() => {
        inflightSearches.delete(searchKey);
      });

    inflightSearches.set(searchKey, promise);

    const payload = await promise;

    if (payload?.error && payload?.status) {
      return json({ error: payload.error }, payload.status);
    }

    return json(payload);
  } catch (e: any) {
    const msg = String(e?.message || "Failed");

    if (msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate limit")) {
      console.error("api/search/favorites rate-limited:", e);
      return json({ error: "Ticketmaster rate limit hit. Wait a bit, then try again." }, 429);
    }

    console.error("api/search/favorites error:", e);
    return json({ error: msg }, 500);
  }
}