// FILE: app/api/share/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createSharedTrip, getSharedTrip } from "@/lib/trips/shareStore";
import type { BuildTripPayload } from "@/lib/trips/sharePayload";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

function isYMD(s: any): s is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function sanitizeTrip(raw: any): BuildTripPayload {
  const trip = isObject(raw?.trip) ? raw.trip : raw;

  const events = Array.isArray(trip?.events)
    ? trip.events
        .filter((e: any) => e && typeof e === "object")
        .map((e: any) => ({
          date: typeof e.date === "string" ? e.date : null,
          name: typeof e.name === "string" ? e.name : "",
          location: typeof e.location === "string" ? e.location : "",
          genre: typeof e.genre === "string" ? e.genre : null,
          url: typeof e.url === "string" ? e.url : null,
          lat: Number.isFinite(Number(e.lat)) ? Number(e.lat) : null,
          lon: Number.isFinite(Number(e.lon)) ? Number(e.lon) : null,
          localTime: typeof e.localTime === "string" ? e.localTime : null,
        }))
    : [];

  const anchor =
    trip?.anchor && typeof trip.anchor === "object"
      ? {
          date: typeof trip.anchor.date === "string" ? trip.anchor.date : null,
          name: typeof trip.anchor.name === "string" ? trip.anchor.name : "",
          location: typeof trip.anchor.location === "string" ? trip.anchor.location : "",
          genre: typeof trip.anchor.genre === "string" ? trip.anchor.genre : null,
          url: typeof trip.anchor.url === "string" ? trip.anchor.url : null,
          lat: Number.isFinite(Number(trip.anchor.lat)) ? Number(trip.anchor.lat) : null,
          lon: Number.isFinite(Number(trip.anchor.lon)) ? Number(trip.anchor.lon) : null,
          localTime: typeof trip.anchor.localTime === "string" ? trip.anchor.localTime : null,
        }
      : undefined;

  return {
    rowKey: typeof trip?.rowKey === "string" ? trip.rowKey : undefined,
    tripStyle: typeof trip?.tripStyle === "string" ? trip.tripStyle : undefined,
    destIata: typeof trip?.destIata === "string" ? trip.destIata : undefined,
    cityState: typeof trip?.cityState === "string" ? trip.cityState : undefined,
    startYMD: isYMD(trip?.startYMD) ? trip.startYMD : null,
    endYMD: isYMD(trip?.endYMD) ? trip.endYMD : null,
    radiusMiles: Number.isFinite(Number(trip?.radiusMiles)) ? Number(trip.radiusMiles) : undefined,
    countryCode: typeof trip?.countryCode === "string" ? trip.countryCode : undefined,
    airport: typeof trip?.airport === "string" ? trip.airport : undefined,
    anchor,
    events,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get("id") || "").trim();

    if (!id) {
      return json({ error: "Missing share id." }, 400);
    }

    const doc = await getSharedTrip(id);

    if (!doc?.trip) {
      return json({ error: "Share link not found." }, 404);
    }

    return json({
      ok: true,
      id: doc.id,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      version: doc.version,
      trip: doc.trip,
    });
  } catch (e: any) {
    console.error("api/share GET error:", e);

    return json(
      {
        error: "Failed to load share link.",
        detail: String(e?.message || e || "Unknown error"),
      },
      500
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "Invalid request body." }, 400);
    }

    const trip = sanitizeTrip(body);
    if (!Array.isArray(trip.events) || trip.events.length === 0) {
      return json({ error: "Trip must include at least one event." }, 400);
    }

    const saved = await createSharedTrip(trip);

    return json({
      ok: true,
      id: saved.id,
    });
  } catch (e: any) {
    console.error("api/share POST error:", e);

    return json(
      {
        error: "Failed to create share link.",
        detail: String(e?.message || e || "Unknown error"),
      },
      500
    );
  }
}