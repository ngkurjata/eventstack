// FILE: app/api/availability/route.js
import { NextResponse } from "next/server";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_EVENTS = `${TM_BASE}/events.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

/**
 * Simple in-memory cache per serverless instance.
 * (Good enough to prevent repeated checks during the same warm runtime.)
 */
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const g = globalThis;
g.__availabilityCache = g.__availabilityCache || new Map();
const CACHE = g.__availabilityCache;

/**
 * @param {string} id Ticketmaster attractionId
 * @param {string} countryCode e.g. "US,CA"
 */
async function fetchHasUpcomingEvents(id, countryCode = "US,CA") {
  // Ticketmaster can be picky about startDateTime formatting; keep no milliseconds.
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const url = new URL(TM_EVENTS);
  url.searchParams.set("apikey", TM_KEY || "");
  url.searchParams.set("attractionId", String(id));
  url.searchParams.set("size", "1");
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("startDateTime", nowIso);

  // ✅ IMPORTANT: align availability check to your app’s search universe
  // If your app searches only US/CA, availability must do the same.
  if (countryCode) url.searchParams.set("countryCode", countryCode);

  const res = await fetch(url.toString(), { cache: "no-store" });

  let data = null;
  try {
    data = await res.json();
  } catch {
    return {
      hasUpcomingEvents: true, // fail open
      nextEventDate: null,
      warning: "non_json_response",
      debug: {
        attractionIdUsed: String(id),
        httpStatus: res.status,
        attempt: "startDateTime_no_millis",
        countryCodeUsed: countryCode,
      },
    };
  }

  // If Ticketmaster returns an error payload, fail open (do NOT claim “no events”)
  if (!res.ok || data?.errors?.length || data?.fault) {
    return {
      hasUpcomingEvents: true, // fail open
      nextEventDate: null,
      warning: "tm_error_payload",
      debug: {
        attractionIdUsed: String(id),
        httpStatus: res.status,
        hasErrors: !!data?.errors?.length,
        hasFault: !!data?.fault,
        attempt: "startDateTime_no_millis",
        countryCodeUsed: countryCode,
      },
    };
  }

  const total = Number(data?.page?.totalElements ?? 0);
  const hasUpcomingEvents = Number.isFinite(total) ? total > 0 : false;

  let nextEventDate = null;
  const first = data?._embedded?.events?.[0];
  if (first?.dates?.start?.dateTime) nextEventDate = first.dates.start.dateTime;
  else if (first?.dates?.start?.localDate) nextEventDate = first.dates.start.localDate;

  return {
    hasUpcomingEvents,
    nextEventDate,
    debug: {
      attractionIdUsed: String(id),
      httpStatus: res.status,
      totalElements: total,
      attempt: "startDateTime_no_millis",
      countryCodeUsed: countryCode,
    },
  };
}

export async function GET(req) {
  if (!TM_KEY) {
    return NextResponse.json({ error: "Missing TICKETMASTER_API_KEY" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const one = String(searchParams.get("id") || "").trim();
  const many = String(searchParams.get("ids") || "").trim();

  // Optional override, default is US/CA to match your app.
  const cc = String(searchParams.get("countryCode") || "US,CA").trim();

  const ids = (many ? many.split(",") : one ? [one] : [])
    .map((x) => String(x).trim())
    .filter(Boolean);

  if (!ids.length) {
    return NextResponse.json({ error: "Provide id=... or ids=a,b,c" }, { status: 400 });
  }

  const out = {};
  const now = Date.now();

  for (const id of ids) {
    const key = String(id);

    // Cache key should include countryCode so you don’t mix results.
    const cacheKey = `${key}__cc=${cc}`;

    const cached = CACHE.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      out[key] = cached.value;
      continue;
    }

    try {
      const value = await fetchHasUpcomingEvents(key, cc);
      const wrapped = { ...value, checkedAt: new Date().toISOString() };
      CACHE.set(cacheKey, { value: wrapped, expiresAt: now + TTL_MS });
      out[key] = wrapped;
    } catch {
      const wrapped = {
        hasUpcomingEvents: true, // fail open
        nextEventDate: null,
        checkedAt: new Date().toISOString(),
        warning: "availability_check_failed",
      };
      CACHE.set(cacheKey, { value: wrapped, expiresAt: now + 15 * 60 * 1000 }); // short TTL
      out[key] = wrapped;
    }
  }

  return NextResponse.json(out);
}
