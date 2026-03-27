// FILE: lib/trips/shareStore.ts

import crypto from "crypto";
import { Redis } from "@upstash/redis";
import type { BuildTripPayload } from "@/lib/trips/sharePayload";

export type SharedTripDoc = {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  trip: BuildTripPayload;
};

const UPSTASH_URL = String(process.env.UPSTASH_REDIS_REST_URL || "").trim();
const UPSTASH_TOKEN = String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

const redis =
  UPSTASH_URL && UPSTASH_TOKEN
    ? new Redis({
        url: UPSTASH_URL,
        token: UPSTASH_TOKEN,
      })
    : null;

const SHARE_KEY_PREFIX = "share:trip:v1:";
const MIN_TTL_SECONDS = 60 * 60 * 24; // 1 day minimum
const MAX_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year maximum safety cap
const END_DATE_BUFFER_DAYS = 7; // keep link alive a week after trip ends

function shareKey(id: string) {
  return `${SHARE_KEY_PREFIX}${id}`;
}

function makeId() {
  return crypto.randomBytes(5).toString("hex");
}

function sanitizeId(raw: string) {
  return String(raw || "").trim().toLowerCase();
}

function isYMD(s: any): s is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function parseYMDToUtcDate(ymd: string): Date | null {
  if (!isYMD(ymd)) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;

  const dt = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59)
  );

  return Number.isNaN(dt.getTime()) ? null : dt;
}

function computeShareTtlSeconds(trip: BuildTripPayload): number {
  const end = parseYMDToUtcDate(String(trip?.endYMD || ""));
  if (!end) return 60 * 60 * 24 * 30;

  end.setUTCDate(end.getUTCDate() + END_DATE_BUFFER_DAYS);

  const nowMs = Date.now();
  const ttlMs = end.getTime() - nowMs;
  const ttlSeconds = Math.ceil(ttlMs / 1000);

  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, ttlSeconds));
}

async function redisGetDoc(key: string): Promise<SharedTripDoc | null> {
  if (!redis) {
    throw new Error(
      "Redis not configured. Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN."
    );
  }

  const result = await redis.get<SharedTripDoc>(key);

  if (!result || typeof result !== "object") return null;

  const doc = result as Partial<SharedTripDoc>;
  if (!doc.id || !doc.trip) return null;

  return doc as SharedTripDoc;
}

async function redisSetDoc(key: string, ttlSeconds: number, value: SharedTripDoc) {
  if (!redis) {
    throw new Error(
      "Redis not configured. Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN."
    );
  }

  await redis.set(key, value, { ex: ttlSeconds });
}

export async function createSharedTrip(trip: BuildTripPayload) {
  if (!redis) {
    throw new Error("Share storage is not configured.");
  }

  let id: string | null = null;

  for (let tries = 0; tries < 10; tries += 1) {
    const candidate = makeId();
    const existing = await redisGetDoc(shareKey(candidate));
    if (!existing) {
      id = candidate;
      break;
    }
  }

  if (!id) {
    throw new Error("Could not create share id.");
  }

  const now = new Date().toISOString();

  const doc: SharedTripDoc = {
    id,
    createdAt: now,
    updatedAt: now,
    version: 1,
    trip,
  };

  const ttlSeconds = computeShareTtlSeconds(trip);
  await redisSetDoc(shareKey(id), ttlSeconds, doc);

  return doc;
}

export async function getSharedTrip(id: string): Promise<SharedTripDoc | null> {
  if (!redis) {
    throw new Error("Share storage is not configured.");
  }

  const cleanId = sanitizeId(id);
  if (!cleanId) return null;

  return await redisGetDoc(shareKey(cleanId));
}