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
  radiusMiles?: number;
  countryCode?: string; // "US,CA"
};

const BLOCKED_CLASSIFICATIONS = new Set(
  [
    "music",
    "sports",
    "arts & theatre",
    "film",
    "miscellaneous",
    "undefined",
    "mlb",
    "milb",
    "nba",
    "wnba",
    "nfl",
    "cfl",
    "nhl",
    "ahl",
    "echl",
    "mls",
    "nwsl",
    "ufl",
    "pga",
    "lpga",
    "atp",
    "wta",
    "ncaa",
    "ncaa football",
    "ncaa basketball",
  ].map((x) => x.toLowerCase())
);

function safeStr(x: any): string | null {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  return s ? s : null;
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

function extractCanonicalClassNames(tm: any, ne: NormEvent): string[] {
  const raw: Array<string | null> = [
    ne.canonicalGenre,
    safeStr(tm?.classifications?.[0]?.segment?.name),
  ];

  return uniqCaseInsensitive(raw);
}

function filterMeaningfulClassNames(classNames: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of classNames) {
    const val = String(raw || "").trim();
    if (!val) continue;

    const key = val.toLowerCase();
    if (BLOCKED_CLASSIFICATIONS.has(key)) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(val);
  }

  return out;
}

function pickPillLabel(classNames: string[]): string | null {
  if (!Array.isArray(classNames) || classNames.length === 0) return null;
  return classNames[0] || null;
}

function collectResponseGenres(events: NormEvent[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const e of events) {
    const arr = Array.isArray(e?.matched?.genres) ? e.matched.genres : [];
    for (const g of arr) {
      const val = String(g || "").trim();
      if (!val) continue;

      const key = val.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      out.push(val);
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
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

    const { startDateTime, endDateTime } = ymdToTmRangeInclusive(body.startDate, body.endDate);

    const tmEvents = await TM.tmSearchEventsAll({
      latlong: `${body.city.lat},${body.city.lon}`,
      radius: Math.max(10, Math.min(300, Number(body.radiusMiles ?? 90))),
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

      const classNames = filterMeaningfulClassNames(extractCanonicalClassNames(tm, ne));
      if (classNames.length === 0) continue;

      ne.matched = ne.matched || {
        favorites: [],
        genres: [],
        defaultGenres: [],
      };

      ne.matched.genres = classNames;
      normalized.push(ne);
    }

    const events: NormEvent[] = dedupeEvents(normalized).map((e: any) => {
      const classNames = Array.isArray(e?.matched?.genres) ? e.matched.genres : [];

      return {
        ...e,
        pillLabel: pickPillLabel(classNames),
      };
    });

    const genres = collectResponseGenres(events);

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