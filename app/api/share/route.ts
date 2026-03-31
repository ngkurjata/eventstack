export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  createSharedTrip,
  getSharedTrip,
  updateSharedTrip,
} from "@/lib/trips/shareStore";
import type { BuildTripPayload, RowEvent } from "@/lib/trips/sharePayload";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status });
}

function isYMD(s: unknown): s is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function coerceRowEvent(raw: unknown): RowEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;

  return {
    date: typeof e.date === "string" ? e.date : null,
    name: typeof e.name === "string" ? e.name : "",
    location: typeof e.location === "string" ? e.location : "",
    genre: typeof e.genre === "string" ? e.genre : null,
    url: typeof e.url === "string" ? e.url : null,
    lat: Number.isFinite(Number(e.lat)) ? Number(e.lat) : null,
    lon: Number.isFinite(Number(e.lon)) ? Number(e.lon) : null,
    localTime: typeof e.localTime === "string" ? e.localTime : null,
  };
}

function sanitizeTrip(raw: unknown): BuildTripPayload {
  const source =
    raw && typeof raw === "object" && "trip" in raw
      ? (raw as { trip?: unknown }).trip
      : raw;

  const trip =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};

  const rawEvents = Array.isArray(trip.events) ? trip.events : [];
  const events = rawEvents
    .map((event) => coerceRowEvent(event))
    .filter((event): event is RowEvent => Boolean(event));

  const anchor = coerceRowEvent(trip.anchor);

  return {
    tripName:
      typeof trip.tripName === "string" ? trip.tripName : undefined,

    cityState:
      typeof trip.cityState === "string" ? trip.cityState : undefined,

    startYMD: isYMD(trip.startYMD) ? trip.startYMD : null,

    endYMD: isYMD(trip.endYMD) ? trip.endYMD : null,

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
  } catch (e: unknown) {
    console.error("api/share GET error:", e);

    return json(
      {
        error: "Failed to load share link.",
        detail: String(
          e instanceof Error ? e.message : e || "Unknown error"
        ),
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
    const saved = await createSharedTrip(trip);

    return json({
      ok: true,
      id: saved.id,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
      version: saved.version,
      trip: saved.trip,
    });
  } catch (e: unknown) {
    console.error("api/share POST error:", e);

    return json(
      {
        error: "Failed to create share link.",
        detail: String(
          e instanceof Error ? e.message : e || "Unknown error"
        ),
      },
      500
    );
  }
}

export async function PUT(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = String(searchParams.get("id") || "").trim();

    if (!id) {
      return json({ error: "Missing share id." }, 400);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "Invalid request body." }, 400);
    }

    const trip = sanitizeTrip(body);
    const saved = await updateSharedTrip(id, trip);

    if (!saved) {
      return json({ error: "Share link not found." }, 404);
    }

    return json({
      ok: true,
      id: saved.id,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
      version: saved.version,
      trip: saved.trip,
    });
  } catch (e: unknown) {
    console.error("api/share PUT error:", e);

    return json(
      {
        error: "Failed to save shared trip.",
        detail: String(
          e instanceof Error ? e.message : e || "Unknown error"
        ),
      },
      500
    );
  }
}