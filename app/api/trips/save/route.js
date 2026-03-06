// FILE: app/api/trips/save/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

/* -------------------- Helpers -------------------- */

function json(payload, status = 200) {
  return NextResponse.json(payload, { status });
}

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const HAS_REDIS = !!(UPSTASH_URL && UPSTASH_TOKEN);

async function redisCommand(cmd, args) {
  const res = await fetch(`${UPSTASH_URL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command: cmd, args }),
    cache: "no-store",
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  return j?.result;
}

async function redisSetEx(key, ttlSeconds, value) {
  if (!HAS_REDIS) return false;
  try {
    await redisCommand("SET", [key, value, "EX", String(ttlSeconds)]);
    return true;
  } catch {
    return false;
  }
}

const TRIPDOC_PREFIX = "tripdoc:v1:";
const TRIPDOC_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days (tune later)

// File-backed fallback
const DATA_DIR = path.join(process.cwd(), "data", "trips");
function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}
function tripPath(tripId) {
  return path.join(DATA_DIR, `${tripId}.json`);
}

function isSafeTripId(s) {
  const t = String(s || "").trim();
  return /^[A-Za-z0-9_-]{6,128}$/.test(t);
}

function isYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function genTripId() {
  // URL-safe short id
  return crypto.randomBytes(9).toString("base64url"); // ~12 chars
}

function normalizeSelectedEvent(e) {
  const out = {
    id: String(e?.id || e?.tmEventId || "").trim(),
    source: "ticketmaster",
    tmEventId: String(e?.tmEventId || e?.id || "").trim(),

    name: String(e?.name || "").trim(),
    url: e?.url != null ? String(e.url) : null,

    localDate: e?.localDate != null ? String(e.localDate) : null,
    localTime: e?.localTime != null ? String(e.localTime) : null,

    city: String(e?.city || "").trim(),
    region: String(e?.region || "").trim(),
    country: String(e?.country || "").trim(),

    venueName: String(e?.venueName || "").trim(),

    lat: e?.lat != null ? Number(e.lat) : null,
    lon: e?.lon != null ? Number(e.lon) : null,

    matchedGenres: Array.isArray(e?.matchedGenres) ? e.matchedGenres.map((x) => String(x)) : [],
    pillGenre: e?.pillGenre != null ? String(e.pillGenre) : "",
  };

  if (!out.id || !out.tmEventId || !out.name) return null;

  if (!out.city) out.city = "";
  if (!out.region) out.region = "";
  if (!out.country) out.country = "";
  if (!out.venueName) out.venueName = "";

  return out;
}

/* -------------------- Handler -------------------- */

export async function POST(req) {
  let body = null;

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  // Accept both { trip: {...} } and {...}
  const input =
    body && typeof body === "object" && body.trip && typeof body.trip === "object" ? body.trip : body;

  let tripId = String(input?.tripId || "").trim();
  if (!tripId) tripId = genTripId();
  if (!isSafeTripId(tripId)) {
    return json({ ok: false, error: "Invalid tripId." }, 400);
  }

  const homeBase = String(input?.homeBase || "").trim() || "HomeBase";
  const startDate = String(input?.startDate || "").trim();
  const endDate = String(input?.endDate || "").trim();

  if (!isYMD(startDate) || !isYMD(endDate)) {
    return json({ ok: false, error: "Missing/invalid startDate or endDate (YYYY-MM-DD)." }, 400);
  }

  const rawEvents = Array.isArray(input?.events) ? input.events : [];
  const events = rawEvents.map(normalizeSelectedEvent).filter(Boolean);

  const nowIso = new Date().toISOString();

  const trip = {
    tripId,
    homeBase,
    startDate,
    endDate,
    events,
    updatedAt: nowIso,
    version: 1,
  };

  // Store to Redis (best-effort)
  const rkey = `${TRIPDOC_PREFIX}${tripId}`;
  const tripStr = JSON.stringify(trip);
  const redisOk = await redisSetEx(rkey, TRIPDOC_TTL_SECONDS, tripStr);

  // Store to file (authoritative fallback for local dev)
  ensureDir();

  let fileOk = false;
  let filePath = "";
  try {
    filePath = tripPath(tripId);
    fs.writeFileSync(filePath, tripStr, "utf8");
    fileOk = true;
  } catch (e) {
    if (!redisOk) {
      return json(
        { ok: false, error: "Failed to persist trip.", detail: String(e?.message || e) },
        500
      );
    }
  }

  return json({ ok: true, tripId, stored: { redisOk, fileOk, filePath, cwd: process.cwd() } }, 200);
}