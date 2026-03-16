export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import TM from "@/lib/tm/client";
import { normalizeTMEvent, type NormEvent } from "@/lib/events/normalize";
import { dedupeEvents } from "@/lib/events/dedupe";
import { isYMD, ymdToTmRangeInclusive } from "@/lib/time/window";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

type FavoriteInput = {
  id?: string;
  label: string;
  kind?: "team" | "artist";
  attractionId: string;
  defaultGenre?: string;
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
  defaultGenres: string[];
  genres: string[];
};

type AttractionCacheEntry = {
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
  kind?: "team" | "artist";
  attractionId: string;
  defaultGenre: string;
};

const ATTRACTION_TTL_MS = 10 * 60_000;
const SEARCH_TTL_MS = 5 * 60_000;
const DEFAULT_COUNTRY_CODE = "US,CA";
const DEFAULT_RADIUS_MILES = 90;
const DEFAULT_DAYS_EACH_SIDE = 3;
const MAX_GENRES = 4;

const attractionCache = new Map<string, AttractionCacheEntry>();
const inflightAttractionFetches = new Map<string, Promise<NormEvent[]>>();

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

function normalizeToken(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
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

function resolveFavorite(input: FavoriteInput | null | undefined, fallbackId: string): ResolvedFavorite | null {
  if (!input) return null;

  const label = String(input.label || "").trim();
  const attractionId = String(input.attractionId || "").trim();
  const defaultGenre = String(input.defaultGenre || "").trim();
  const id = String(input.id || fallbackId).trim() || fallbackId;

  if (!label || !attractionId) return null;

  return {
    id,
    label,
    kind: input.kind,
    attractionId,
    defaultGenre,
  };
}

function makeAttractionKey(args: {
  attractionId: string;
  countryCode: string;
  startDateTime?: string;
  endDateTime?: string;
}) {
  return [
    args.attractionId,
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
      kind: args.favorite1.kind || "",
      attractionId: args.favorite1.attractionId,
      defaultGenre: args.favorite1.defaultGenre,
    },
    f2: args.favorite2
      ? {
          id: args.favorite2.id,
          label: args.favorite2.label,
          kind: args.favorite2.kind || "",
          attractionId: args.favorite2.attractionId,
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
    defaultGenres: Array.isArray(matched.defaultGenres) ? matched.defaultGenres : [],
    genres: Array.isArray((matched as any).genres) ? (matched as any).genres : [],
  };
  (ne as any).matched = normalized;
  return normalized;
}

async function tmSearchByAttractionUncached(args: {
  attractionId: string;
  countryCode: string;
  startDateTime?: string;
  endDateTime?: string;
}) {
  await sleep(250);

  const tmEvents = await withRateLimitRetry(() =>
    TM.tmSearchEventsAll(
      {
        attractionId: args.attractionId,
        countryCode: args.countryCode,
        ...(args.startDateTime && args.endDateTime
          ? { startDateTime: args.startDateTime, endDateTime: args.endDateTime }
          : {}),
        sort: "date,asc",
        size: 200,
      },
      300
    )
  );

  const normalized: NormEvent[] = [];

  for (const tm of tmEvents) {
    if (isJunkTM(tm)) continue;

    const ne = normalizeTMEvent(tm);
    if (!ne) continue;
    if (isJunkNorm(ne)) continue;

    normalized.push(ne);
  }

  return dedupeEvents(normalized).filter((e) => !isJunkNorm(e));
}

async function tmSearchByAttraction(args: {
  attractionId: string;
  countryCode: string;
  startDateTime?: string;
  endDateTime?: string;
}) {
  const key = makeAttractionKey(args);
  const now = Date.now();

  const cached = attractionCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const inflight = inflightAttractionFetches.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = tmSearchByAttractionUncached(args)
    .then((data) => {
      attractionCache.set(key, {
        expiresAt: Date.now() + ATTRACTION_TTL_MS,
        data,
      });
      return data;
    })
    .finally(() => {
      inflightAttractionFetches.delete(key);
    });

  inflightAttractionFetches.set(key, promise);
  return promise;
}

async function runSearch(body: Body) {
  const favorite1 = resolveFavorite(body.favorite1, "F1");
  const favorite2 = resolveFavorite(body.favorite2 || null, "F2");

  if (!favorite1?.attractionId) {
    return { error: "Favorite 1 is required", status: 400 };
  }

  const genres = normalizeGenresInput(body.genres);
  const countryCode = String(body.countryCode || DEFAULT_COUNTRY_CODE).trim() || DEFAULT_COUNTRY_CODE;
  const radiusMiles = DEFAULT_RADIUS_MILES;
  const daysEachSide = DEFAULT_DAYS_EACH_SIDE;

  let startDateTime: string | undefined;
  let endDateTime: string | undefined;

  if (body.startDate || body.endDate) {
    if (!isYMD(body.startDate) || !isYMD(body.endDate)) {
      return {
        error: "If provided, startDate and endDate must be YYYY-MM-DD",
        status: 400,
      };
    }

    const r = ymdToTmRangeInclusive(body.startDate, body.endDate);
    startDateTime = r.startDateTime;
    endDateTime = r.endDateTime;
  }

  const [f1Anchors, f2Events] = await Promise.all([
    tmSearchByAttraction({
      attractionId: favorite1.attractionId,
      countryCode,
      startDateTime,
      endDateTime,
    }),
    favorite2?.attractionId
      ? tmSearchByAttraction({
          attractionId: favorite2.attractionId,
          countryCode,
          startDateTime,
          endDateTime,
        })
      : Promise.resolve([] as NormEvent[]),
  ]);

  for (const anchor of f1Anchors) {
    const matched = ensureMatched(anchor);
    matched.favorites = uniqueStrings([favorite1.id, favorite1.label, favorite1.attractionId]);
    matched.defaultGenres = uniqueStrings([favorite1.defaultGenre]);
    matched.genres = [];
  }

  for (const event of f2Events) {
    const matched = ensureMatched(event);
    matched.favorites = uniqueStrings([
      favorite2?.id || "F2",
      favorite2?.label || "",
      favorite2?.attractionId || "",
    ]);
    matched.defaultGenres = uniqueStrings([favorite2?.defaultGenre || ""]);
    matched.genres = [];
  }

  const candidateAnchors = f1Anchors.filter((anchor) => {
    return (
      Boolean(anchor.localDate) &&
      isYMD(String(anchor.localDate)) &&
      typeof anchor.lat === "number" &&
      typeof anchor.lon === "number"
    );
  });

  const candidateMeta = candidateAnchors.map((anchor) => {
    const nearbyF2Events = favorite2?.attractionId
      ? f2Events.filter((f2e) => isNearbyAnchorMatch(anchor, f2e, radiusMiles, daysEachSide))
      : [];

    return {
      anchor,
      nearbyF2Events,
    };
  });

  const filteredMeta = favorite2?.attractionId
    ? candidateMeta.filter((item) => item.nearbyF2Events.length > 0)
    : candidateMeta;

  const anchorCards = filteredMeta.map(({ anchor, nearbyF2Events }) => {
    const presentFavorites = uniqueStrings([
      favorite1.id,
      favorite1.label,
      favorite1.attractionId,
      ...(nearbyF2Events.length > 0 && favorite2
        ? [favorite2.id, favorite2.label, favorite2.attractionId]
        : []),
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
        defaultGenres: presentDefaultGenres,
        genres: [],
      } as any,
      isCrossover: nearbyF2Events.length > 0,
    };
  });

  return {
    mode: "favorites",
    favorites: [favorite1, ...(favorite2?.attractionId ? [favorite2] : [])].map((fav) => ({
      id: fav.id,
      label: fav.label,
      defaultGenre: fav.defaultGenre,
    })),
    genres,
    requiredInputs: {
      favorites: [favorite1, ...(favorite2?.attractionId ? [favorite2] : [])].map((fav) => fav.id),
      genres,
    },
    startDate: body.startDate || null,
    endDate: body.endDate || null,
    count: anchorCards.length,
    anchorCards,
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const favorite1 = resolveFavorite(body.favorite1, "F1");
    const favorite2 = resolveFavorite(body.favorite2 || null, "F2");

    if (!favorite1?.attractionId) {
      return json({ error: "Favorite 1 is required" }, 400);
    }

    const genres = normalizeGenresInput(body.genres);
    const countryCode = String(body.countryCode || DEFAULT_COUNTRY_CODE).trim() || DEFAULT_COUNTRY_CODE;

    const searchKey = makeSearchKey({
      favorite1,
      favorite2,
      startDate: body.startDate || null,
      endDate: body.endDate || null,
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