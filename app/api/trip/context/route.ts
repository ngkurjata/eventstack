// FILE: app/api/trip/context/route.ts

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
import { allVisibleGenreLabels } from "@/lib/events/genres";
import {
  anchorWindowYMD,
  isYMD,
  ymdToTmRangeInclusive,
} from "@/lib/time/window";

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

function normalizeToken(v: string | null | undefined): string {
  return String(v || "").trim().toLowerCase();
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
  if (!Array.isArray(e.canonicalGenres) || e.canonicalGenres.length === 0) {
    return true;
  }

  const name = e.name.trim().toLowerCase();
  const city = e.city.trim().toLowerCase();
  const venue = e.venueName.trim().toLowerCase();

  if (name.includes("untitled")) return true;
  if (city.includes("tbd")) return true;
  if (venue.includes("tbd")) return true;

  return false;
}

function eventQualityScore(e: NormEvent): number {
  let score = 0;

  if (e.name && !e.name.toLowerCase().includes("untitled")) score += 100;
  if (e.url) score += 10;
  if (e.city && !e.city.toLowerCase().includes("tbd")) score += 5;
  if (e.venueName && !e.venueName.toLowerCase().includes("tbd")) score += 3;
  if (e.localTime) score += 1;
  if (Array.isArray(e.canonicalGenres) && e.canonicalGenres.length > 0) {
    score += 2;
  }

  return score;
}

function isPlaceholderRow(e: NormEvent): boolean {
  const name = String(e.name || "").trim().toLowerCase();
  const city = String(e.city || "").trim().toLowerCase();
  const venue = String(e.venueName || "").trim().toLowerCase();

  if (name === "untitled event") return true;
  if (name.startsWith("untitled")) return true;
  if (city === "location tbd" || city.includes("location tbd")) return true;
  if (venue === "location tbd" || venue.includes("location tbd")) return true;

  return false;
}

function sanitizeUserGenres(input: string[]): string[] {
  const allowed = new Set(allVisibleGenreLabels().map((g) => g.toLowerCase()));

  return uniqueStrings(input)
    .map((s) => String(s).trim())
    .filter((s) => allowed.has(s.toLowerCase()))
    .slice(0, 4);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const favorites: RequestFavorite[] = (body.favorites || [])
      .filter(
        (f): f is Body["favorites"][number] =>
          Boolean(
            f &&
              typeof f.id === "string" &&
              f.id.trim() &&
              typeof f.label === "string" &&
              f.label.trim() &&
              typeof f.attractionId === "string" &&
              f.attractionId.trim()
          )
      )
      .map((f) => ({
        id: String(f.id).trim(),
        label: String(f.label).trim(),
        attractionId: String(f.attractionId).trim(),
        defaultGenre: String(f.defaultGenre || "").trim(),
      }));

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

    const userGenres = sanitizeUserGenres(
      (body.genres || []).map((s) => String(s).trim())
    );

    const w = anchorWindowYMD(anchor.localDate, 2);
    const { startDateTime, endDateTime } = ymdToTmRangeInclusive(
      w.start,
      w.end
    );

    const radiusMiles = Math.max(
      5,
      Math.min(200, Number(body.radiusMiles ?? 90) || 90)
    );
    const countryCode = String(body.countryCode || "US,CA").trim() || "US,CA";

    const tmEvents = await TM.tmSearchEventsAll(
      {
        latlong: `${anchor.lat},${anchor.lon}`,
        radius: radiusMiles,
        unit: "miles",
        startDateTime,
        endDateTime,
        countryCode,
        sort: "date,asc",
        size: 200,
      },
      150
    );

    const normalized: NormEvent[] = [];

    for (const tm of tmEvents) {
      const ne = normalizeTMEvent(tm);
      if (!ne) continue;
      if (isIncompleteEvent(ne)) continue;

      const embeddedAttractions: string[] = (
        (tm?._embedded?.attractions || []) as any[]
      )
        .map((a: any) => String(a?.id || ""))
        .filter((id: string) => Boolean(id));

      applyMatchesToEvent(ne, {
        favorites: favorites as any,
        selectedGenres: userGenres,
        attractionIdsOnEvent: embeddedAttractions,
      });

      ne.pillLabel = ne.canonicalGenres[0] || null;
      normalized.push(ne);
    }

    const deduped = dedupeEvents(normalized);
    const byKey = new Map<string, NormEvent>();

    for (const event of deduped) {
      const key =
        event.canonicalKey ||
        `${event.ts || ""}|${event.name || ""}|${
          event.venueName || event.city || ""
        }`;

      const prev = byKey.get(key);

      if (!prev) {
        byKey.set(key, event);
        continue;
      }

      const prevScore = eventQualityScore(prev);
      const nextScore = eventQualityScore(event);

      if (nextScore > prevScore) {
        mergeMatched(event, prev);
        byKey.set(key, event);
      } else {
        mergeMatched(prev, event);
      }
    }

    const cleanedEvents = Array.from(byKey.values()).filter(
      (e) => !isIncompleteEvent(e) && !isPlaceholderRow(e)
    );

    const presentFavorites = uniqueStrings(
      cleanedEvents.flatMap((e) => e.matched?.favorites || [])
    );

    const presentGenres = uniqueStrings(
      cleanedEvents.flatMap((e) => e.canonicalGenres || [])
    ).sort((a, b) => a.localeCompare(b));

    const requiredFavoriteIds = favorites.map((f) => f.id);

    const favoriteRequirementMet =
      favorites.length === 1
        ? true
        : requiredFavoriteIds.every((id) =>
            presentFavorites.some(
              (pf) => normalizeToken(pf) === normalizeToken(id)
            )
          );

    const genreRequirementMet = userGenres.every((g) =>
      presentGenres.some((pg) =>
        normalizeToken(pg).includes(normalizeToken(g))
      )
    );

    const requirementsMet = favoriteRequirementMet && genreRequirementMet;

    const hasTwoFavs = favorites.length >= 2;
    const crossoverInWindow =
      hasTwoFavs &&
      cleanedEvents.some((e) => {
        const matchedFavorites = uniqueStrings(e.matched?.favorites || []);
        return matchedFavorites.length >= 2;
      });

    return json({
      anchor: {
        localDate: anchor.localDate,
        lat: anchor.lat,
        lon: anchor.lon,
        city: anchor.city || "",
      },
      anchorWindow: {
        start: w.start,
        end: w.end,
        daysEachSide: 2,
      },
      filters: {
        userGenres,
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

    if (
      msg.toLowerCase().includes("quota") ||
      msg.toLowerCase().includes("rate limit")
    ) {
      console.error("api/trip/context rate-limited:", e);
      return json(
        { error: "Ticketmaster rate limit hit. Wait a bit, then try again." },
        429
      );
    }

    console.error("api/trip/context error:", e);
    return json({ error: msg }, 500);
  }
}