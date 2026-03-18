// FILE: app/api/build-trip/route.js

import { NextResponse } from "next/server";
import { normalizeTMEvent } from "@/lib/events/normalize";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_KEY = process.env.TICKETMASTER_API_KEY;

// TM event details endpoint: /events/{id}.json
function tmEventUrl(id) {
  return `${TM_BASE}/events/${encodeURIComponent(id)}.json`;
}

/* -------------------- helpers -------------------- */

function json(res, status = 200) {
  return NextResponse.json(res, { status });
}

function isYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function clampInt(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  const iv = Math.trunc(v);
  if (iv < lo) return lo;
  if (iv > hi) return hi;
  return iv;
}

function norm(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeByIdPreserveOrder(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    const s = String(id || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function canonicalGenresFromNormalized(normEv) {
  const arr = Array.isArray(normEv?.canonicalGenres)
    ? normEv.canonicalGenres
    : normEv?.canonicalGenre
      ? [normEv.canonicalGenre]
      : [];

  const seen = new Set();
  const out = [];

  for (const g of arr) {
    const v = String(g || "").trim();
    if (!v) continue;

    const key = v.toLowerCase();
    if (key === "other") continue;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);

    if (out.length >= 2) break;
  }

  return out;
}

function toRowEvent(ev) {
  const n = normalizeTMEvent(ev);
  const genres = canonicalGenresFromNormalized(n);

  return {
    date: n?.localDate || null,
    name: String(n?.name || "").trim() || "Event",
    location: [n?.city, n?.region].filter(Boolean).join(", "),
    genre: genres[0] || null,
    genres,
    url: n?.url || null,
    lat: Number.isFinite(n?.lat) ? n.lat : null,
    lon: Number.isFinite(n?.lon) ? n.lon : null,
    localTime: n?.localTime || null,
  };
}

function sortRowEvents(list) {
  return [...(list || [])].sort((a, b) => {
    const ad = a?.date || "9999-12-31";
    const bd = b?.date || "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;

    const at = a?.localTime || "";
    const bt = b?.localTime || "";
    if (at !== bt) return at < bt ? -1 : 1;

    return norm(a?.name).localeCompare(norm(b?.name));
  });
}

async function fetchTMEventById(id) {
  const u = new URL(tmEventUrl(id));
  u.searchParams.set("apikey", TM_KEY);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch(u.toString(), {
      signal: controller.signal,
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        id,
        error: body || `TM event fetch failed (${res.status})`,
        ev: null,
      };
    }

    const ev = await res.json().catch(() => null);
    if (!ev || typeof ev !== "object") {
      return { ok: false, status: 500, id, error: "TM returned invalid JSON", ev: null };
    }

    return { ok: true, status: 200, id, error: null, ev };
  } catch (e) {
    const msg =
      String(e?.name || "") === "AbortError"
        ? "TM request timed out"
        : String(e?.message || e);
    return { ok: false, status: 500, id, error: msg, ev: null };
  } finally {
    clearTimeout(t);
  }
}

/* -------------------- handler -------------------- */

export async function POST(req) {
  if (!TM_KEY) return json({ error: "Missing TICKETMASTER_API_KEY" }, 500);

  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const tripStyle = String(body?.tripStyle || "A").trim().toUpperCase();
  if (tripStyle !== "A" && tripStyle !== "B") {
    return json(
      { error: "This /api/build-trip route supports tripStyle=A or tripStyle=B." },
      400
    );
  }

  const destIata = String(body?.destIata || "").trim().toUpperCase();

  const cityLabel = String(body?.cityLabel || "").trim();
  const lat = Number(body?.lat);
  const lon = Number(body?.lon);

  const start = String(body?.start || "").trim();
  const end = String(body?.end || "").trim();

  const radiusMiles = clampInt(body?.radiusMiles, 10, 300, 120);
  const countryCode = String(body?.countryCode || "US,CA").trim() || "US,CA";

  const rawIds = Array.isArray(body?.eventIds) ? body.eventIds : [];
  const eventIds = dedupeByIdPreserveOrder(rawIds);

  const hasDestIata = destIata.length === 3;
  const hasCityAnchor = !!cityLabel || (Number.isFinite(lat) && Number.isFinite(lon));

  if (!hasDestIata && !hasCityAnchor) {
    return json(
      { error: "Missing destination context. Provide destIata or cityLabel/lat/lon." },
      400
    );
  }

  if (!isYMD(start) || !isYMD(end)) {
    return json({ error: "Missing/invalid start/end (YYYY-MM-DD)." }, 400);
  }

  if (eventIds.length < 1) {
    return json({ error: "No eventIds provided." }, 400);
  }

  const MAX_EVENTS = 40;
  const idsCapped = eventIds.slice(0, MAX_EVENTS);

  const results = await Promise.all(idsCapped.map((id) => fetchTMEventById(id)));

  const okEvents = results.filter((r) => r.ok && r.ev).map((r) => r.ev);
  const failures = results
    .filter((r) => !r.ok)
    .map((r) => ({ id: r.id, status: r.status, error: r.error }));

  if (okEvents.length === 0) {
    return json(
      {
        error: "Could not fetch any selected events from Ticketmaster.",
        debug: { failures, requested: idsCapped.length },
      },
      502
    );
  }

  const rowEvents = okEvents.map(toRowEvent);
  const sorted = sortRowEvents(rowEvents);

  const anchor = sorted[0] || rowEvents[0];
  const derivedCityState = String(anchor?.location || "").trim() || "Your trip";
  const finalCityState = cityLabel || derivedCityState;

  const rowKey = [
    tripStyle,
    hasDestIata ? destIata : "NOIATA",
    start,
    end,
    radiusMiles,
    norm(countryCode),
    norm(finalCityState),
  ].join("_");

  const payload = {
    rowKey,
    tripStyle,

    destIata: hasDestIata ? destIata : "",
    cityState: finalCityState,

    startYMD: start,
    endYMD: end,

    radiusMiles,
    countryCode,

    destination: {
      cityLabel: cityLabel || "",
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
    },

    anchor,
    events: sorted,
  };

  return json({
    ok: true,
    payload,
    debug: {
      requested: idsCapped.length,
      returned: okEvents.length,
      failures,
    },
  });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);

  const tripStyle = String(searchParams.get("tripStyle") || "A")
    .trim()
    .toUpperCase();

  const destIata = String(searchParams.get("destIata") || "")
    .trim()
    .toUpperCase();

  const cityLabel = String(searchParams.get("cityLabel") || "").trim();
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  const start = String(searchParams.get("start") || "").trim();
  const end = String(searchParams.get("end") || "").trim();

  const radiusMiles = clampInt(searchParams.get("radiusMiles"), 10, 300, 120);
  const countryCode = String(searchParams.get("countryCode") || "US,CA").trim() || "US,CA";

  const ids = String(searchParams.get("eventIds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return POST(
    new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripStyle,
        destIata,
        cityLabel,
        lat,
        lon,
        start,
        end,
        radiusMiles,
        countryCode,
        eventIds: ids,
      }),
    })
  );
}