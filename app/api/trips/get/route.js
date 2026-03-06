// FILE: app/api/trips/get/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

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

async function redisGet(key) {
  if (!HAS_REDIS) return null;
  try {
    return await redisCommand("GET", [key]);
  } catch {
    return null;
  }
}

const TRIPDOC_PREFIX = "tripdoc:v1:";

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
  // allow URL-safe ids
  return /^[A-Za-z0-9_-]{6,128}$/.test(t);
}

/* -------------------- Handler -------------------- */

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const tripId = String(searchParams.get("tripId") || "").trim();

  if (!isSafeTripId(tripId)) {
    return json({ ok: false, error: "Missing/invalid tripId." }, 400);
  }

  // 1) Redis
  const rkey = `${TRIPDOC_PREFIX}${tripId}`;
  const cached = await redisGet(rkey);
  if (cached) {
    try {
      const trip = JSON.parse(String(cached));
      return json({ ok: true, trip }, 200);
    } catch {
      // fall through to file
    }
  }

  // 2) File
  ensureDir();
  const fp = tripPath(tripId);
  if (!fs.existsSync(fp)) {
    return json(
  { ok: false, error: "Trip not found.", debug: { lookedFor: fp, cwd: process.cwd(), redis: HAS_REDIS } },
  404
);
  }

  try {
    const raw = fs.readFileSync(fp, "utf8");
    const trip = JSON.parse(raw);
    return json({ ok: true, trip }, 200);
  } catch (e) {
    return json({ ok: false, error: "Failed to read trip.", detail: String(e?.message || e) }, 500);
  }
}