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

type Favorite = {
  id: string; // "F1" / "F2"
  label: string;
  attractionId: string;
  defaultGenre: string;
};

type Body = {
  favorite1: Favorite | null;
  favorite2?: Favorite | null;
  startDate?: string | null;
  endDate?: string | null;
  countryCode?: string; // "US,CA"
  genres?: string[]; // G1..G4
};

type MatchBag = {
  favorites: string[];
  defaultGenres: string[];
  genres: string[];
};

type WindowCacheEntry = {
  expiresAt: number;
  data: NormEvent[];
};

type AttractionCacheEntry = {
  expiresAt: number;
  data: NormEvent[];
};

const WINDOW_TTL_MS = 5 * 60_000;
const ATTRACTION_TTL_MS = 10 * 60_000;
const MAX_ANCHORS_TO_EVALUATE = 8;
const WINDOW_FETCH_CONCURRENCY = 2;

const windowCache = new Map<string, WindowCacheEntry>();
const inflightWindowFetches = new Map<string, Promise<NormEvent[]>>();

const attractionCache = new Map<string, AttractionCacheEntry>();
const inflightAttractionFetches = new Map<string, Promise<NormEvent[]>>();

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

function includesNormalized(list: string[] | null | undefined, value: string | null | undefined) {
  const needle = normalizeToken(value);
  if (!needle) return false;
  return (list || []).some((item) => normalizeToken(item) === needle);
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

function getMatchedSelectedGenres(tm: any, ne: any, userGenres: string[]): string[] {
  const selectedByToken = new Map(userGenres.map((g) => [normalizeToken(g), g]));
  const matches: string[] = [];

  for (const candidate of getTMGenreCandidates(tm, ne)) {
    const token = normalizeToken(candidate);
    const selected = selectedByToken.get(token);
    if (selected) matches.push(selected);
  }

  return uniqueStrings(matches);
}

function parseYMDToUTC(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function daysBetweenYMD(a: string, b: string): number {
  const ms = Math.abs(parseYMDToUTC(a) - parseYMDToUTC(b));
  return Math.round(ms / 86400000);
}

function addDaysYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);

  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function maxYMD(a: string, b: string) {
  return a >= b ? a : b;
}

function minYMD(a: string, b: string) {
  return a <= b ? a : b;
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
  daysEachSide = 3
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

function roundCoord(n: number, places = 1) {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function makeWindowKey(args: {
  lat: number;
  lon: number;
  radiusMiles: number;
  startYMD: string;
  endYMD: string;
  countryCode: string;
  genres: string[];
}) {
  return [
    roundCoord(args.lat, 1),
    roundCoord(args.lon, 1),
    args.radiusMiles,
    args.startYMD,
    args.endYMD,
    args.countryCode,
    uniqueStrings(args.genres).map((g) => normalizeToken(g)).sort().join(","),
  ].join("|");
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

function getAnchorWindowYMD(
  anchorYMD: string,
  daysEachSide: number,
  requestedStart?: string | null,
  requestedEnd?: string | null
) {
  let startYMD = addDaysYMD(anchorYMD, -daysEachSide);
  let endYMD = addDaysYMD(anchorYMD, daysEachSide);

  if (requestedStart && isYMD(requestedStart)) startYMD = maxYMD(startYMD, requestedStart);
  if (requestedEnd && isYMD(requestedEnd)) endYMD = minYMD(endYMD, requestedEnd);

  if (startYMD > endYMD) {
    startYMD = anchorYMD;
    endYMD = anchorYMD;
  }

  return { startYMD, endYMD };
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

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

async function tmSearchByAttractionUncached(args: {
  attractionId: string;
  countryCode: string;
  startDateTime?: string;
  endDateTime?: string;
}) {
  const tmEvents = await TM.tmSearchEventsAll(
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

async function tmSearchLocalWindowUncached(args: {
  lat: number;
  lon: number;
  radiusMiles: number;
  startYMD: string;
  endYMD: string;
  countryCode: string;
  selectedGenres: string[];
}) {
  const { startDateTime, endDateTime } = ymdToTmRangeInclusive(args.startYMD, args.endYMD);

  const tmEvents = await TM.tmSearchEventsAll(
    {
      latlong: `${args.lat},${args.lon}`,
      radius: args.radiusMiles,
      unit: "miles",
      countryCode: args.countryCode,
      startDateTime,
      endDateTime,
      sort: "date,asc",
      size: 200,
    },
    150
  );

  const normalized: NormEvent[] = [];

  for (const tm of tmEvents) {
    if (isJunkTM(tm)) continue;

    const ne = normalizeTMEvent(tm);
    if (!ne) continue;
    if (isJunkNorm(ne)) continue;

    const matched = ensureMatched(ne);
    matched.genres = getMatchedSelectedGenres(tm, ne, args.selectedGenres);

    normalized.push(ne);
  }

  return dedupeEvents(normalized).filter((e) => !isJunkNorm(e));
}

async function tmSearchLocalWindowCached(args: {
  lat: number;
  lon: number;
  radiusMiles: number;
  startYMD: string;
  endYMD: string;
  countryCode: string;
  selectedGenres: string[];
}) {
  const key = makeWindowKey({
    lat: args.lat,
    lon: args.lon,
    radiusMiles: args.radiusMiles,
    startYMD: args.startYMD,
    endYMD: args.endYMD,
    countryCode: args.countryCode,
    genres: args.selectedGenres,
  });

  const now = Date.now();
  const cached = windowCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const inflight = inflightWindowFetches.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = tmSearchLocalWindowUncached(args)
    .then((data) => {
      windowCache.set(key, { expiresAt: Date.now() + WINDOW_TTL_MS, data });
      return data;
    })
    .finally(() => {
      inflightWindowFetches.delete(key);
    });

  inflightWindowFetches.set(key, promise);
  return promise;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const f1 = body.favorite1;
    const f2 = body.favorite2 || null;

    if (!f1?.attractionId) {
      return json({ error: "Favorite 1 is required" }, 400);
    }

    const genres = uniqueStrings((body.genres || []).map((g) => String(g).trim())).slice(0, 4);
    const countryCode = String(body.countryCode || "US,CA").trim() || "US,CA";
    const radiusMiles = 90;
    const daysEachSide = 3;

    let startDateTime: string | undefined;
    let endDateTime: string | undefined;

    if (body.startDate || body.endDate) {
      if (!isYMD(body.startDate) || !isYMD(body.endDate)) {
        return json({ error: "If provided, startDate and endDate must be YYYY-MM-DD" }, 400);
      }

      const r = ymdToTmRangeInclusive(body.startDate, body.endDate);
      startDateTime = r.startDateTime;
      endDateTime = r.endDateTime;
    }

    const [f1Anchors, f2Events] = await Promise.all([
      tmSearchByAttraction({
        attractionId: f1.attractionId,
        countryCode,
        startDateTime,
        endDateTime,
      }),
      f2?.attractionId
        ? tmSearchByAttraction({
            attractionId: f2.attractionId,
            countryCode,
            startDateTime,
            endDateTime,
          })
        : Promise.resolve([] as NormEvent[]),
    ]);

    for (const anchor of f1Anchors) {
      const matched = ensureMatched(anchor);
      matched.favorites = [f1.id];
      matched.defaultGenres = [f1.defaultGenre].filter(Boolean);
      matched.genres = [];
    }

    for (const event of f2Events) {
      const matched = ensureMatched(event);
      matched.favorites = [f2?.id || "F2"];
      matched.defaultGenres = [f2?.defaultGenre || ""].filter(Boolean);
      matched.genres = [];
    }

    const candidateAnchors = f1Anchors.filter((anchor) => {
      if (
        !anchor.localDate ||
        !isYMD(anchor.localDate) ||
        typeof anchor.lat !== "number" ||
        typeof anchor.lon !== "number"
      ) {
        return false;
      }

      if (f2?.attractionId) {
        const hasF2Nearby = f2Events.some((f2e) =>
          isNearbyAnchorMatch(anchor, f2e, radiusMiles, daysEachSide)
        );
        if (!hasF2Nearby) return false;
      }

      return true;
    });

    const limitedCandidateAnchors = candidateAnchors.slice(0, MAX_ANCHORS_TO_EVALUATE);

    const candidateMeta = limitedCandidateAnchors.map((anchor) => {
      const nearbyF2Events = f2?.attractionId
        ? f2Events.filter((f2e) => isNearbyAnchorMatch(anchor, f2e, radiusMiles, daysEachSide))
        : [];

      return {
        anchor,
        nearbyF2Events,
      };
    });

    const needLocalWindows = genres.length > 0;

    const windowByAnchorId = new Map<
      string,
      {
        key: string;
        startYMD: string;
        endYMD: string;
      }
    >();

    const uniqueWindowFetches = new Map<string, Promise<NormEvent[]>>();

    if (needLocalWindows) {
      for (const { anchor } of candidateMeta) {
        if (
          !anchor.localDate ||
          !isYMD(anchor.localDate) ||
          typeof anchor.lat !== "number" ||
          typeof anchor.lon !== "number"
        ) {
          continue;
        }

        const { startYMD, endYMD } = getAnchorWindowYMD(
          anchor.localDate,
          daysEachSide,
          body.startDate,
          body.endDate
        );

        const key = makeWindowKey({
          lat: anchor.lat,
          lon: anchor.lon,
          radiusMiles,
          startYMD,
          endYMD,
          countryCode,
          genres,
        });

        windowByAnchorId.set(anchor.id, { key, startYMD, endYMD });

        if (!uniqueWindowFetches.has(key)) {
          uniqueWindowFetches.set(
            key,
            tmSearchLocalWindowCached({
              lat: anchor.lat,
              lon: anchor.lon,
              radiusMiles,
              startYMD,
              endYMD,
              countryCode,
              selectedGenres: genres,
            })
          );
        }
      }
    }

    const resolvedWindows = new Map<string, NormEvent[]>();
    const windowEntries = [...uniqueWindowFetches.entries()];

    await mapWithConcurrency(windowEntries, WINDOW_FETCH_CONCURRENCY, async ([key, promise]) => {
      resolvedWindows.set(key, await promise);
      return null;
    });

    const anchorCards = limitedCandidateAnchors
      .filter((anchor) => {
        if (!needLocalWindows) return true;

        const meta = windowByAnchorId.get(anchor.id);
        if (!meta) return false;

        const pooledEvents = resolvedWindows.get(meta.key) || [];
        const nearbyWindowEvents = pooledEvents.filter((e) =>
          isNearbyAnchorMatch(anchor, e, radiusMiles, daysEachSide)
        );

        const presentGenres = uniqueStrings(
          nearbyWindowEvents.flatMap((e: any) => e?.matched?.genres || [])
        );

        return genres.every((g) => includesNormalized(presentGenres, g));
      })
      .map((anchor) => {
        const meta = windowByAnchorId.get(anchor.id);
        const pooledEvents = meta ? resolvedWindows.get(meta.key) || [] : [];
        const nearbyWindowEvents = pooledEvents.filter((e) =>
          isNearbyAnchorMatch(anchor, e, radiusMiles, daysEachSide)
        );

        const metaItem = candidateMeta.find((m) => m.anchor.id === anchor.id);
        const nearbyF2Events = metaItem?.nearbyF2Events || [];

        const presentGenres = uniqueStrings(
          nearbyWindowEvents.flatMap((e: any) => e?.matched?.genres || [])
        );

        const presentFavorites = uniqueStrings([
          f1.id,
          ...(nearbyF2Events.length > 0 && f2 ? [f2.id] : []),
        ]);

        const presentDefaultGenres = uniqueStrings([
          f1.defaultGenre,
          ...(nearbyF2Events.length > 0 && f2 ? [f2.defaultGenre] : []),
        ]);

        return {
          ...anchor,
          matched: {
            ...(anchor.matched || {}),
            favorites: presentFavorites,
            defaultGenres: presentDefaultGenres,
            genres: presentGenres,
          } as any,
          isCrossover: nearbyF2Events.length > 0,
        };
      });

    return json({
      mode: "favorites",
      favorites: [f1, ...(f2?.attractionId ? [f2] : [])].map((fav) => ({
        id: fav.id,
        label: fav.label,
        defaultGenre: fav.defaultGenre,
      })),
      genres,
      requiredInputs: {
        favorites: [f1, ...(f2?.attractionId ? [f2] : [])].map((fav) => fav.id),
        genres,
      },
      startDate: body.startDate || null,
      endDate: body.endDate || null,
      count: anchorCards.length,
      anchorCards,
    });
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