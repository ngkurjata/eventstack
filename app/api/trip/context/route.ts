export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import TM from "@/lib/tm/client";
import { normalizeTMEvent, type NormEvent } from "@/lib/events/normalize";
import { dedupeEvents } from "@/lib/events/dedupe";
import {
  applyMatchesToEvent,
  mergeMatched,
  uniqueStrings,
} from "@/lib/events/match";
import { resolveGenreKey } from "@/lib/events/genres";
import {
  anchorWindowYMD,
  isYMD,
  ymdToTmRangeInclusive,
} from "@/lib/time/window";

/* =========================
   🔥 CACHE (NEW)
========================= */
const CONTEXT_CACHE = new Map<string, { ts: number; value: any }>();
const CONTEXT_TTL = 1000 * 60 * 5; // 5 minutes

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

type RequestFavorite = {
  id: string;
  label: string;
  attractionId: string;
  defaultGenre: string;
};

type AnchorInput = {
  localDate: string;
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

  favorites: Array<{
    id: string;
    label: string;
    attractionId: string;
    defaultGenre?: string | null;
  }>;
  genres?: string[];
  radiusMiles?: number;
  countryCode?: string;
};

function toFiniteNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickAnchor(body: Body): AnchorInput | null {
  const a = body.anchor || null;
  const aLocalDate = a?.localDate ? String(a.localDate).trim() : "";
  const aLat = toFiniteNumber(a?.lat);
  const aLon = toFiniteNumber(a?.lon);

  if (aLocalDate && isYMD(aLocalDate) && aLat !== null && aLon !== null) {
    return { localDate: aLocalDate, lat: aLat, lon: aLon, city: a?.city };
  }

  const bLocalDate = body.anchorLocalDate
    ? String(body.anchorLocalDate).trim()
    : "";
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

function isIncompleteEvent(e: NormEvent): boolean {
  if (!e.name?.trim()) return true;
  if (!e.url?.trim()) return true;
  if (!e.city?.trim()) return true;
  if (!e.venueName?.trim()) return true;
  if (!Array.isArray(e.canonicalGenres) || e.canonicalGenres.length === 0)
    return true;

  const name = e.name.toLowerCase();
  const city = e.city.toLowerCase();
  const venue = e.venueName.toLowerCase();

  if (name.includes("untitled")) return true;
  if (city.includes("tbd")) return true;
  if (venue.includes("tbd")) return true;

  return false;
}

function sanitizeUserGenres(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of input) {
    const key = resolveGenreKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= 4) break;
  }

  return out;
}

function normalizeCanonicalGenres(input: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of Array.isArray(input) ? input : []) {
    const key = resolveGenreKey(String(raw || "").trim());
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    /* =========================
       🔥 CACHE KEY (NEW)
    ========================= */
    const cacheKey = JSON.stringify({
      anchorDate: body.anchorLocalDate || body.localDate,
      lat: body.anchorLat || body.lat,
      lon: body.anchorLon || body.lon,
      genres: body.genres || [],
      favorites: body.favorites || [],
    });

    const cached = CONTEXT_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < CONTEXT_TTL) {
      return json(cached.value);
    }

    const favorites: RequestFavorite[] = (body.favorites || [])
      .filter(
        (f): f is Body["favorites"][number] =>
          Boolean(f?.id && f?.label && f?.attractionId)
      )
      .map((f) => ({
        id: String(f.id).trim(),
        label: String(f.label).trim(),
        attractionId: String(f.attractionId).trim(),
        defaultGenre: String(f.defaultGenre || "").trim(),
      }));

    if (favorites.length < 1 && (body.genres || []).length < 1) {
      return json({ error: "favorites or genres required" }, 400);
    }

    const anchor = pickAnchor(body);
    if (!anchor) {
      return json({ error: "anchor required" }, 400);
    }

    const userGenres = sanitizeUserGenres(
      (body.genres || []).map((s) => String(s).trim())
    );

    const w = anchorWindowYMD(anchor.localDate, 2);
    const { startDateTime, endDateTime } = ymdToTmRangeInclusive(
      w.start,
      w.end
    );

    const radiusMiles = Math.max(5, Math.min(200, Number(body.radiusMiles ?? 90)));

    const tmEvents = await TM.tmSearchEventsAll(
      {
        latlong: `${anchor.lat},${anchor.lon}`,
        radius: radiusMiles,
        unit: "miles",
        startDateTime,
        endDateTime,
        sort: "date,asc",
        size: 200,
      },
      150
    );

    const normalized: NormEvent[] = [];

    for (const tm of tmEvents) {
      const ne = normalizeTMEvent(tm);
      if (!ne) continue;

      ne.canonicalGenres = normalizeCanonicalGenres(ne.canonicalGenres);
      ne.pillLabel = ne.canonicalGenres[0] || ne.pillLabel || null;

      if (isIncompleteEvent(ne)) continue;

      const embeddedAttractions = (tm?._embedded?.attractions || [])
        .map((a: any) => String(a?.id || ""))
        .filter(Boolean);

      applyMatchesToEvent(ne, {
        favorites: favorites as any,
        selectedGenres: userGenres,
        attractionIdsOnEvent: embeddedAttractions,
      });

      normalized.push(ne);
    }

    const cleanedEvents = dedupeEvents(normalized);

    const responsePayload = {
      mode: "context",
      anchor,
      count: cleanedEvents.length,
      favorites: uniqueStrings(
        cleanedEvents.flatMap((e) => e.matched?.favorites || [])
      ),
      genres: uniqueStrings(
        cleanedEvents.flatMap((e) => e.canonicalGenres || [])
      ),
      events: cleanedEvents,
    };

    /* =========================
       🔥 SAVE CACHE (NEW)
    ========================= */
    CONTEXT_CACHE.set(cacheKey, {
      ts: Date.now(),
      value: responsePayload,
    });

    return json(responsePayload);
  } catch (err) {
    const message =
  err instanceof Error
    ? err.message
    : typeof err === "string"
    ? err
    : "Failed";

return json({ error: message }, 500);
  }
}