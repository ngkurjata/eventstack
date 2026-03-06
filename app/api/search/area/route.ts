// FILE: app/api/search/area/route.ts

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

type Body = {
  city: { label: string; lat: number; lon: number } | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  genres: string[]; // 1..4 Ticketmaster classificationName(s)
  radiusMiles?: number;
  countryCode?: string; // "US,CA"
};

function pickPillLabel(e: any, selected: string[]): string | null {
  const sel = (selected || []).map((s) => String(s).trim()).filter(Boolean);
  if (sel.length === 0) return null;

  const eg = Array.isArray(e?.matched?.genres) ? e.matched.genres : [];
  const egl = eg.map((x: any) => String(x).toLowerCase());

  // attribute pill to the first selected genre that is present in the event's classification set
  for (const s of sel) {
    if (egl.includes(s.toLowerCase())) return s;
  }

  // single-select: always show the selected genre (keeps UX consistent even if TM data is sparse)
  if (sel.length === 1) return sel[0];

  return null;
}

function extractClassNames(tm: any): string[] {
  const out: string[] = [];
  const arr = Array.isArray(tm?.classifications) ? tm.classifications : [];
  for (const c of arr) {
    const g = String(c?.genre?.name || "").trim();
    const sg = String(c?.subGenre?.name || "").trim();
    if (g) out.push(g);
    if (sg) out.push(sg);
  }
  // de-dupe (case-insensitive)
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const s of out) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(s);
  }
  return uniq;
}

function matchesSelectedGenre(eventGenres: string[], selected: string[]): boolean {
  const eg = (eventGenres || []).map((x) => String(x).toLowerCase());
  const sel = (selected || []).map((x) => String(x).toLowerCase());
  return sel.some((s) => eg.includes(s));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    // --- validate city ---
    if (
      !body.city ||
      typeof body.city.lat !== "number" ||
      typeof body.city.lon !== "number" ||
      !Number.isFinite(body.city.lat) ||
      !Number.isFinite(body.city.lon)
    ) {
      return json({ error: "City (with valid lat/lon) is required" }, 400);
    }

    // --- validate dates ---
    if (!isYMD(body.startDate) || !isYMD(body.endDate)) {
      return json({ error: "StartDate/EndDate required (YYYY-MM-DD)" }, 400);
    }

    // --- validate genres ---
    const genres = (body.genres || [])
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 4);

    if (genres.length < 1) return json({ error: "Genres must be 1..4" }, 400);

    // --- enforce max 14-day window ---
    const s = new Date(`${body.startDate}T12:00:00`);
    const e = new Date(`${body.endDate}T12:00:00`);
    const diffDays = Math.round((e.getTime() - s.getTime()) / 86400000);

    if (!Number.isFinite(diffDays)) return json({ error: "Invalid date range" }, 400);
    if (diffDays < 0) return json({ error: "EndDate must be >= StartDate" }, 400);
    if (diffDays > 14) return json({ error: "Max window is 14 days" }, 400);

    const { startDateTime, endDateTime } = ymdToTmRangeInclusive(body.startDate, body.endDate);

    const tmEvents = await TM.tmSearchEventsAll({
      latlong: `${body.city.lat},${body.city.lon}`,
      radius: Math.max(10, Math.min(300, Number(body.radiusMiles ?? 90))),
      unit: "miles",
      startDateTime,
      endDateTime,
      countryCode: body.countryCode || "US,CA",
      classificationName: genres.join(","),
      sort: "date,asc",
      size: 200,
    });

    const normalized: NormEvent[] = [];
for (const tm of tmEvents) {
  const ne = normalizeTMEvent(tm);
  if (!ne) continue;

  const clsGenres = extractClassNames(tm);
  ne.matched.genres = clsGenres;

  // Hard filter: must match one of the selected genres (G1/G2/...)
  if (!matchesSelectedGenre(ne.matched.genres, genres)) continue;

  normalized.push(ne);
}

    const events = dedupeEvents(normalized).map((e: any) => ({
  ...e,
  pillLabel: pickPillLabel(e, genres),
}));

// DEBUG (temporary): verify genre/subGenre/pillLabel are present
console.log(
  "area events sample:",
  events.slice(0, 8).map((e: any) => ({
    name: e.name,
    genre: e.genre,
    subGenre: e.subGenre,
    pillLabel: e.pillLabel,
    classificationsPresent: !!e.segment || !!e.genre || !!e.subGenre,
  }))
);

return json({
  mode: "area",
  city: body.city,
  startDate: body.startDate,
  endDate: body.endDate,
  genres,
  count: events.length,
  events,
});
  } catch (e: any) {
    console.error("api/search/area error:", e);
    return json({ error: e?.message || "Failed" }, 500);
  }
}