// FILE: app/api/events/area/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import TM from "@/lib/tm/client";
import { normalizeTMEvent, type NormEvent } from "@/lib/events/normalize";
import { ymdToTmRangeInclusive, isYMD } from "@/lib/time/window";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

type Body = {
  city: {
    label: string;
    lat: number;
    lon: number;
  } | null;
  startDate: string | null;
  endDate: string | null;
  radiusMiles?: number;
  countryCode?: string; // ex: "US,CA"
};

type ApiResp = {
  mode: "area";
  city: { label: string; lat: number; lon: number };
  startDate: string;
  endDate: string;
  count: number;
  events: NormEvent[];
  error?: string;
};

function dedupeEvents(events: NormEvent[]) {
  const seen = new Set<string>();
  const out: NormEvent[] = [];

  for (const ev of events) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    out.push(ev);
  }

  out.sort((a, b) => {
    const da = `${a.localDate} ${a.localTime || "99:99:99"}`;
    const db = `${b.localDate} ${b.localTime || "99:99:99"}`;
    return da.localeCompare(db);
  });

  return out;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const city = body?.city || null;
    const startDate = String(body?.startDate || "");
    const endDate = String(body?.endDate || "");
    const radiusMiles = Number(body?.radiusMiles || 100);
    const countryCode = String(body?.countryCode || "US,CA");

    if (!city || typeof city.lat !== "number" || typeof city.lon !== "number") {
      return json(
        {
          ok: false,
          error: "Missing or invalid city. Expected { label, lat, lon }.",
        },
        400
      );
    }

    if (!isYMD(startDate) || !isYMD(endDate)) {
      return json(
        {
          ok: false,
          error: "Invalid startDate or endDate. Expected YYYY-MM-DD.",
        },
        400
      );
    }

    const { startDateTime, endDateTime } = ymdToTmRangeInclusive(startDate, endDate);
    const latlong = `${city.lat},${city.lon}`;

    const tm = await TM.searchEvents({
      latlong,
      radius: radiusMiles,
      unit: "miles",
      startDateTime,
      endDateTime,
      countryCode,
      sort: "date,asc",
      size: 200,
      page: 0,
    });

    const rawEvents = Array.isArray(tm?._embedded?.events) ? tm._embedded.events : [];
    const events = dedupeEvents(
      rawEvents
        .map((raw) => normalizeTMEvent(raw))
        .filter((ev): ev is NormEvent => Boolean(ev))
    );

    const resp: ApiResp = {
      mode: "area",
      city,
      startDate,
      endDate,
      count: events.length,
      events,
    };

    return json(resp);
  } catch (err: any) {
    return json(
      {
        ok: false,
        error: err?.message || "Unknown server error.",
      },
      500
    );
  }
}