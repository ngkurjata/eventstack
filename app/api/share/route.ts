// FILE: app/api/share/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";

const SHARE_DIR = path.join(process.cwd(), ".data", "shares");
const TTL_DAYS = 60;

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

async function ensureDir() {
  await fs.mkdir(SHARE_DIR, { recursive: true });
}

function makeId() {
  // short-ish, URL-safe
  return crypto.randomBytes(6).toString("base64url"); // ~8 chars
}

function isObj(x: any) {
  return x && typeof x === "object" && !Array.isArray(x);
}

export async function POST(req: Request) {
  try {
    await ensureDir();

    const body = await req.json().catch(() => null);
    if (!isObj(body)) return json({ error: "Invalid JSON body" }, 400);

    // You can tighten this contract as needed:
    // expected: { version, createdAt, trip: { events: [...], airportIata?, ... } }
    const id = makeId();
    const payload = {
      id,
      createdAt: new Date().toISOString(),
      version: body.version ?? 1,
      trip: body.trip ?? body, // allow either shape
    };

    const file = path.join(SHARE_DIR, `${id}.json`);
    await fs.writeFile(file, JSON.stringify(payload), "utf8");

    return json({ id });
  } catch (e: any) {
    return json({ error: e?.message || "Share create failed" }, 500);
  }
}

export async function GET(req: Request) {
  try {
    await ensureDir();

    const url = new URL(req.url);
    const id = url.searchParams.get("id") || "";
    if (!id) return json({ error: "Missing id" }, 400);
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) return json({ error: "Bad id" }, 400);

    const file = path.join(SHARE_DIR, `${id}.json`);

    const raw = await fs.readFile(file, "utf8").catch(() => null);
    if (!raw) return json({ error: "Not found" }, 404);

    const parsed = JSON.parse(raw);

    // TTL
    const createdAt = Date.parse(parsed?.createdAt || "");
    if (Number.isFinite(createdAt)) {
      const ageMs = Date.now() - createdAt;
      const maxMs = TTL_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs > maxMs) return json({ error: "Expired" }, 410);
    }

    return json({ payload: parsed });
  } catch (e: any) {
    return json({ error: e?.message || "Share fetch failed" }, 500);
  }
}