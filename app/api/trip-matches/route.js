// FILE: app/api/trip-matches/route.js
import { NextResponse } from "next/server";

const TM_EVENTS = "https://app.ticketmaster.com/discovery/v2/events.json";

// Safety caps
const HARD_MATCH_EVENT_CAP = 600; // total raw events we’ll consider across pages
const MAX_PAGES = 5; // 5 * 200 = up to 1000 fetched, but we stop early once we hit caps

function getParamList(sp, key) {
  return (sp.getAll(key) || [])
    .map((x) => String(x).trim())
    .filter(Boolean);
}

function milesToKm(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return 25;
  return n * 1.60934;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9 ]+/g, "");
}

function looksLikeCompetitionDayEvent(e) {
  const name = String(e?.name || "").toLowerCase();

  // Exclude generic / package / inventory products
  if (
    /(weekly|grounds ticket|any one day|any day|clubhouse|hospitality|package|pass|vip|suite|late week|early week|flex|bundle|ticket plan)/i.test(
      name
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Used for dedupe keys only (not display).
 * Strips package noise and normalizes matchup separators.
 */
function normalizeBaseTitle(name) {
  let s = String(name || "");

  s = s.replace(/\*[^*]*\*/g, " ");
  s = s.replace(/[*•|]+/g, " ");
  s = s.replace(/\(([^)]*)\)/g, " ");

  s = s.replace(
    /\b(vip|package|pass|experience|suite|club|premium|hospitality|meet\s*and\s*greet|m&g|pre[\s-]?game|post[\s-]?game|fan\s*experience|special\s*offer|offer|pinstripe|seating)\b/gi,
    " "
  );

  s = s.replace(/@/g, " vs ");
  s = s.replace(/\bvs\.?\b/gi, "vs");
  s = s.replace(/\bv\.?\b/gi, "vs");

  return norm(s);
}

/**
 * Display sanitization: remove package noise for what the user sees.
 */
function sanitizeDisplayName(name) {
  const raw = String(name || "Event");
  return raw
    .replace(/\*[^*]*\*/g, " ")
    .replace(/[*•|]+/g, " ")
    .replace(/\(([^)]*)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function gameKeyFromTMEvent(e) {
  const d = e?.dates?.start?.localDate || "";
  const venueId = e?._embedded?.venues?.[0]?.id || "";
  const city = e?._embedded?.venues?.[0]?.city?.name || "";
  const region =
    e?._embedded?.venues?.[0]?.state?.stateCode ||
    e?._embedded?.venues?.[0]?.country?.countryCode ||
    "";

  const v = venueId ? venueId : `${norm(city)}|${norm(region)}`;
  const t = normalizeBaseTitle(e?.name || "");
  return `${d}|${v}|${t}`;
}

/**
 * Prefer the "cleanest" TM event variant for a given dedupe key.
 * Works on raw TM events (NOT the sanitized candidate object).
 */
function chooseBetterTMVariant(a, b) {
  const an = String(a?.name || "");
  const bn = String(b?.name || "");

  const aStars = /\*/.test(an);
  const bStars = /\*/.test(bn);
  if (aStars !== bStars) return aStars ? b : a;

  const aParen = /\([^)]*\)/.test(an);
  const bParen = /\([^)]*\)/.test(bn);
  if (aParen !== bParen) return aParen ? b : a;

  const aLen = normalizeBaseTitle(an).length;
  const bLen = normalizeBaseTitle(bn).length;
  if (aLen !== bLen) return aLen < bLen ? a : b;

  const aUrl = !!a?.url;
  const bUrl = !!b?.url;
  if (aUrl !== bUrl) return aUrl ? a : b;

  return a;
}

function getSegment(e) {
  const segmentName = e?.classifications?.[0]?.segment?.name || "";
  const seg = String(segmentName).toLowerCase();
  if (seg.includes("music")) return "music";
  if (seg.includes("sports")) return "sports";
  return "other";
}

/**
 * Key fix: use a blob of segment+genre+subGenre (like your /api/search) so:
 * - Sports + Golf matches “golf” even if genre is “Sports”
 */
function classificationBlob(e) {
  const c0 = e?.classifications?.[0] || null;
  const parts = [c0?.segment?.name, c0?.genre?.name, c0?.subGenre?.name]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return norm(parts.join(" "));
}

function localDateTimeForSort(e) {
  return e?.dates?.start?.dateTime || e?.dates?.start?.localDate || "9999-12-31";
}

async function fetchAllPages(urlBase, maxPages) {
  const all = [];
  let page = 0;

  while (page < maxPages && all.length < HARD_MATCH_EVENT_CAP) {
    const url = new URL(urlBase.toString());
    url.searchParams.set("page", String(page));

    const r = await fetch(url.toString(), { cache: "no-store" });
    const json = await r.json().catch(() => ({}));

    if (!r.ok) {
      return { ok: false, error: "Ticketmaster error", status: r.status, detail: json, events: [] };
    }

    const raw = Array.isArray(json?._embedded?.events) ? json._embedded.events : [];
    all.push(...raw);

    const pageInfo = json?.page || null;
    const totalPages = Number(pageInfo?.totalPages);
    const number = Number(pageInfo?.number);

    // Stop if TM says no more pages
    if (Number.isFinite(totalPages) && Number.isFinite(number)) {
      if (number >= totalPages - 1) break;
    }

    // If TM didn’t return page info, stop if we got less than size (likely last page)
    const size = Number(url.searchParams.get("size") || 200);
    if (raw.length < size) break;

    page += 1;
  }

  return { ok: true, events: all };
}

export async function GET(req) {
  try {
    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing TICKETMASTER_API_KEY" }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);

    const start = searchParams.get("start"); // YYYY-MM-DD
    const end = searchParams.get("end"); // YYYY-MM-DD
    const lat = Number(searchParams.get("lat"));
    const lon = Number(searchParams.get("lon"));
    const radiusMiles = Number(searchParams.get("radiusMiles") || 25);

    // IMPORTANT: treat incoming as display strings, then normalize with norm() for matching
    const musicGenresRaw = getParamList(searchParams, "musicGenres");
    const sportsGenresRaw = getParamList(searchParams, "sportsGenres");

    const musicGenres = musicGenresRaw.map((s) => norm(s));
    const sportsGenres = sportsGenresRaw.map((s) => norm(s));

    if (!start || !end || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json(
        { error: "Missing or invalid start/end/lat/lon", debug: { start, end, lat, lon } },
        { status: 400 }
      );
    }

    const startDateTime = `${start}T00:00:00Z`;
    const endDateTime = `${end}T23:59:59Z`;
    const km = Math.max(1, Math.round(milesToKm(radiusMiles)));

    const url = new URL(TM_EVENTS);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("latlong", `${lat},${lon}`);
    url.searchParams.set("radius", String(km));
    url.searchParams.set("unit", "km");
    url.searchParams.set("startDateTime", startDateTime);
    url.searchParams.set("endDateTime", endDateTime);
    url.searchParams.set("size", "200");
    url.searchParams.set("sort", "date,asc");

    // Fetch multiple pages so we don't miss the relevant event
    const fetched = await fetchAllPages(url, MAX_PAGES);
    if (!fetched.ok) {
      return NextResponse.json(
        {
          error: fetched.error || "Ticketmaster error",
          status: fetched.status,
          detail: fetched.detail,
        },
        { status: 502 }
      );
    }

    const rawAll = fetched.events || [];

    // key -> best raw TM event for that key
    const byKeyTM = new Map();

    const wantsAnyFilter = musicGenres.length + sportsGenres.length > 0;

    for (const e of rawAll) {
      // Remove non-competition ticket products
if (!looksLikeCompetitionDayEvent(e)) continue;
    
      const key = gameKeyFromTMEvent(e);
      if (!key) continue;

      const segment = getSegment(e);
      if (wantsAnyFilter && segment === "other") continue;

      // If user selected only music genres, drop sports; if only sports genres, drop music
      if (wantsAnyFilter) {
        if (musicGenres.length === 0 && segment === "music") continue;
        if (sportsGenres.length === 0 && segment === "sports") continue;
      }

      // Apply genre matching using blob
      const blob = classificationBlob(e);

      if (segment === "music" && musicGenres.length > 0) {
        if (!musicGenres.some((g) => blob.includes(g))) continue;
      }

      if (segment === "sports" && sportsGenres.length > 0) {
        if (!sportsGenres.some((g) => blob.includes(g))) continue;
      }

      const existing = byKeyTM.get(key);
      if (!existing) byKeyTM.set(key, e);
      else byKeyTM.set(key, chooseBetterTMVariant(existing, e));
    }

    // Convert to your API shape
    const events = Array.from(byKeyTM.values())
      .sort((a, b) => {
        const ad = localDateTimeForSort(a);
        const bd = localDateTimeForSort(b);
        return ad < bd ? -1 : ad > bd ? 1 : 0;
      })
      .map((e) => {
        const c0 = e?.classifications?.[0] || null;
        const genreName = c0?.subGenre?.name || c0?.genre?.name || null;

        return {
          id: gameKeyFromTMEvent(e),
          tmID: e?.id || null,
          name: sanitizeDisplayName(e?.name || "Event"),
          url: e?.url || null,
          dateLocal: e?.dates?.start?.dateTime || null,
          venue: e?._embedded?.venues?.[0]?.name || null,
          city: e?._embedded?.venues?.[0]?.city?.name || null,
          region:
            e?._embedded?.venues?.[0]?.state?.stateCode ||
            e?._embedded?.venues?.[0]?.country?.countryCode ||
            null,
          segment: getSegment(e),
          genre: genreName,
        };
      });

    return NextResponse.json({
      events,
      debug: {
        counts: { fetched: rawAll.length, deduped: events.length },
        filters: {
          musicGenres: musicGenresRaw,
          sportsGenres: sportsGenresRaw,
          radiusMiles,
          radiusKm: km,
          start,
          end,
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Unhandled error in /api/trip-matches", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
