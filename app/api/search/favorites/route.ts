// FILE: app/api/search/favorites/route.ts

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
  attractionId: string; // Ticketmaster attraction id
  defaultGenre: string; // e.g. "Hockey"
};

type Body = {
  favorite1: Favorite | null;
  favorite2?: Favorite | null;
  startDate?: string | null; // optional YYYY-MM-DD
  endDate?: string | null; // optional YYYY-MM-DD
  countryCode?: string; // "US,CA"
};

// --- shared junk filters ---

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

  // require a usable link and a real date
  if (!tm?.url) return true;

  const d = String(tm?.dates?.start?.localDate ?? "").trim();
  if (!d || !isYMD(d)) return true;

  return false;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const f1 = body.favorite1;
    const f2 = body.favorite2 || null;

    if (!f1?.attractionId) return json({ error: "Favorite 1 is required" }, 400);

    const favorites = [f1, ...(f2?.attractionId ? [f2] : [])];

    // optional date filter
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

    const allAnchors: NormEvent[] = [];

    for (const fav of favorites) {
      const tmEvents = await TM.tmSearchEventsAll(
        {
          attractionId: fav.attractionId,
          countryCode: body.countryCode || "US,CA",
          ...(startDateTime && endDateTime ? { startDateTime, endDateTime } : {}),
          sort: "date,asc",
          size: 200,
        },
        800
      );

      for (const tm of tmEvents) {
        // 1) strongest filter: raw TM payload
        if (isJunkTM(tm)) continue;

        // 2) normalize
        const ne = normalizeTMEvent(tm);
        if (!ne) continue;

        // 3) backup filter: normalized object
        if (isJunkNorm(ne)) continue;

        ne.matched.favorites = [fav.id];
        ne.matched.defaultGenres = [fav.defaultGenre].filter(Boolean);
        allAnchors.push(ne);
      }
    }

    // Dedupe within each favorite and across favorites
    const anchors = dedupeEvents(allAnchors);

    // 4) guarantee nothing slips through post-dedupe
    const filteredAnchors = anchors.filter((a) => !isJunkNorm(a));

    // Merge any collisions (same canonicalKey) to support "crossover" highlights
    const byKey = new Map<string, NormEvent>();
    for (const a of filteredAnchors) {
      const prev = byKey.get(a.canonicalKey);
      if (!prev) {
        byKey.set(a.canonicalKey, a);
      } else {
        const mergedFav = new Set([...(prev.matched.favorites || []), ...(a.matched.favorites || [])]);
        prev.matched.favorites = Array.from(mergedFav);

        const mergedDef = new Set([...(prev.matched.defaultGenres || []), ...(a.matched.defaultGenres || [])]);
        prev.matched.defaultGenres = Array.from(mergedDef);
      }
    }

    const mergedAnchors = Array.from(byKey.values()).sort(
      (a, b) => (a.ts - b.ts) || a.name.localeCompare(b.name)
    );

    const anchorCards = mergedAnchors.map((a) => {
      const isCrossover = favorites.length >= 2 && (a.matched.favorites?.length || 0) >= 2;
      return { ...a, isCrossover };
    });

    return json({
      mode: "favorites",
      favorites: favorites.map((f) => ({ id: f.id, label: f.label, defaultGenre: f.defaultGenre })),
      startDate: body.startDate || null,
      endDate: body.endDate || null,
      count: anchorCards.length,
      anchorCards,
    });
  } catch (e: any) {
    console.error("api/search/favorites error:", e);
    return json({ error: e?.message || "Failed" }, 500);
  }
}