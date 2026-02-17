// app/api/search/route.js
import { NextResponse } from "next/server";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_EVENTS = `${TM_BASE}/events.json`;

const TM_KEY = process.env.TICKETMASTER_API_KEY;

// Safety caps (serverless/runtime protection)
const HARD_ANCHOR_EVENT_CAP = 250;
const HARD_NEARBY_EVENT_CAP = 600;
const DEFAULT_RADIUS_MILES = 180;
const DEFAULT_TRIP_DAYS = 7;

/* -------------------- Allowed genre lists (sanitization) -------------------- */

const MUSIC_ALLOWED = [
  "Alternative",
  "Blues",
  "Children’s Music",
  "Classical",
  "Comedy",
  "Country",
  "Dance / Electronic",
  "Folk",
  "Hip-Hop / Rap",
  "Holiday",
  "Jazz",
  "Latin",
  "Metal",
  "New Age",
  "Other",
  "Pop",
  "R&B",
  "Reggae",
  "Religious",
  "Rock",
  "World",
];

const SPORTS_ALLOWED = [
  "Baseball",
  "Basketball",
  "Boxing",
  "Cricket",
  "Equestrian",
  "Football",
  "Golf",
  "Hockey",
  "Lacrosse",
  "Martial Arts",
  "Miscellaneous",
  "Motorsports",
  "Rodeo",
  "Soccer",
  "Tennis",
  "Volleyball",
  "Wrestling",
  "Other",
];

// -------------------- utils --------------------

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function isYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function ymdToUTCDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function addDaysYMD(ymd, delta) {
  const dt = ymdToUTCDate(ymd);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + delta);
  const y = String(dt.getUTCFullYear());
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayUTCYMD() {
  const dt = new Date();
  const y = String(dt.getUTCFullYear());
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeCountryCodes(raw) {
  const s = String(raw || "").trim();
  if (!s) return ["US", "CA"];
  const parts = s
    .split(",")
    .map((x) => String(x || "").trim().toUpperCase())
    .filter(Boolean);
  return parts.length ? parts : ["US", "CA"];
}

function sanitizePickList(rawList, allowed) {
  const allowedSet = new Set(allowed.map((x) => String(x)));
  const list = Array.isArray(rawList) ? rawList : [];
  return Array.from(
    new Set(
      list
        .map((s) => String(s || "").trim())
        .map((s) => {
          if (allowedSet.has(s)) return s;
          const hit = allowed.find((a) =>
            s.toLowerCase().includes(String(a).toLowerCase())
          );
          return hit || "";
        })
        .filter(Boolean)
    )
  );
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9 ]+/g, "");
}

function eventName(e) {
  return e?.name ?? "";
}
function eventUrl(e) {
  return e?.url ?? null;
}
function eventLocalDate(e) {
  return e?.dates?.start?.localDate ?? null;
}
function eventCity(e) {
  return e?._embedded?.venues?.[0]?.city?.name ?? null;
}
function eventRegion(e) {
  return (
    e?._embedded?.venues?.[0]?.state?.stateCode ??
    e?._embedded?.venues?.[0]?.country?.countryCode ??
    null
  );
}
function eventLatLon(e) {
  const v = e?._embedded?.venues?.[0];
  const lat = v?.location?.latitude;
  const lon = v?.location?.longitude;
  const la = lat != null ? Number(lat) : NaN;
  const lo = lon != null ? Number(lon) : NaN;
  if (Number.isFinite(la) && Number.isFinite(lo)) return { lat: la, lon: lo };
  return null;
}
function eventVenueId(e) {
  return e?._embedded?.venues?.[0]?.id ?? null;
}

function eventVenueName(e) {
  return e?._embedded?.venues?.[0]?.name ?? null;
}

function eventSegment(e) {
  const seg = String(e?.classifications?.[0]?.segment?.name || "").toLowerCase();
  if (seg.includes("music")) return "music";
  if (seg.includes("sports")) return "sports";
  return "other";
}

function gameKey(e) {
  const d = eventLocalDate(e) || "";

  const city = eventCity(e) || "";
  const region = eventRegion(e) || "";
  const venueId = eventVenueId(e) || "";
  const venueName = eventVenueName(e) || "";

  const seg = eventSegment(e);

  let v;
  if (seg === "music") {
    const ll = eventLatLon(e);
    const latR = ll ? Math.round(ll.lat * 1000) / 1000 : null; // ~0.001 deg
    const lonR = ll ? Math.round(ll.lon * 1000) / 1000 : null;
    v = ll ? `${latR}|${lonR}` : `${norm(city)}|${norm(region)}|${norm(venueName)}`;
  } else {
    // For sports/other, keep your current behavior (venueId is useful for stadium precision)
    v = venueId ? venueId : `${norm(city)}|${norm(region)}`;
  }

  const t = normalizeBaseTitle(eventName(e));
  return `${d}|${v}|${t}`;
}

function eventGenre(e) {
  const cls = Array.isArray(e?.classifications) ? e.classifications : [];
  const c0 = cls[0] || null;

  const sub = String(c0?.subGenre?.name || "").trim();
  const gen = String(c0?.genre?.name || "").trim();
  const seg = String(c0?.segment?.name || "").trim();

  const pick = sub || gen || seg;
  if (!pick) return null;

  const pl = pick.toLowerCase();
  if (pl === "other" || pl === "miscellaneous") return null;

  return pick;
}

function eventGenreBlob(e) {
  const cls = Array.isArray(e?.classifications) ? e.classifications : [];
  const c0 = cls[0] || null;

  const parts = [c0?.segment?.name, c0?.genre?.name, c0?.subGenre?.name]
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  return norm(parts.join(" "));
}

function isExcludedFromMatching(e) {
  const cls = Array.isArray(e?.classifications) ? e.classifications : [];
  const c0 = cls[0] || null;

  const fields = [
    c0?.segment?.name,
    c0?.type?.name,
    c0?.subType?.name,
    c0?.genre?.name,
    c0?.subGenre?.name,
  ]
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);

  if (fields.includes("other") || fields.includes("miscellaneous")) return true;

  const g = eventGenre(e);
  if (!g) return true;

  return false;
}

// Only use this to filter TEAM schedules (MLB/NHL/etc), not general genre candidates.
function looksLikeTeamGameEvent(e) {
  const name = String(eventName(e) || "").toLowerCase();

  if (
    /(parking|park pass|suite|suites|executive suite|vip|package|hospitality|membership|deposit|season ticket|season tickets|flex pack|ticket plan|plans|voucher|promo|gift card)/i.test(
      name
    )
  ) {
    return false;
  }

  const hasMatchupMarker = /(\bvs\.?\b|\bv\.?\b|@|\bat\b)/i.test(name);

  const atts = e?._embedded?.attractions;
  const hasTwoAttractions = Array.isArray(atts) && atts.length >= 2;

  return hasMatchupMarker || hasTwoAttractions;
}

/**
 * Normalize game-level title so we can collapse TM product variants.
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

function sanitizeDisplayName(name) {
  const raw = String(name || "Event");
  return raw
    .replace(/\*[^*]*\*/g, " ")
    .replace(/[*•|]+/g, " ")
    .replace(/\(([^)]*)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPromoLabel(e) {
  const promos = Array.isArray(e?.promotions) ? e.promotions : [];
  for (const p of promos) {
    const text = String(p?.name || p?.description || "").trim();
    if (!text) continue;
    if (/bobblehead|giveaway|jersey|t-shirt|hat|replica|fireworks/i.test(text)) {
      return text;
    }
  }
  return null;
}

function haversineMiles(a, b) {
  const R = 3958.7613;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLon / 2) ** 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function eventTMId(e) {
  const id = String(e?.id || "").trim();
  return id ? id : null;
}

/**
 * Prefer the "cleanest" TM event variant for a given dedupe key.
 * (Same idea as trip-matches.)
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

function dedupeKey(e) {
  const seg = eventSegment(e);

  // MUSIC: TM can produce multiple event IDs for the same show (genre/classification wrappers).
  // Prefer our occurrence key to collapse them.
  if (seg === "music") {
    const gk = gameKey(e);
    if (gk) return `gk:${gk}`;

    // fallback only if gameKey can't be built
    const tmId = eventTMId(e);
    return tmId ? `tm:${tmId}` : null;
  }

  // SPORTS/OTHER: prefer TM event id if present (usually stable and avoids weird wrapper dupes)
  const tmId = eventTMId(e);
  if (tmId) return `tm:${tmId}`;

  // fallback
  const gk = gameKey(e);
  return gk ? `gk:${gk}` : null;
}



function dedupeEvents(events) {
  const byKey = new Map();

  for (const e of events || []) {
    const key = dedupeKey(e);
    if (!key) continue;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, e);
      continue;
    }

    byKey.set(key, chooseBetterTMVariant(existing, e));
  }

  return Array.from(byKey.values());
}


function sortEvents(events) {
  return [...(events || [])].sort((a, b) => {
    const ad = eventLocalDate(a) || "9999-12-31";
    const bd = eventLocalDate(b) || "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return normalizeBaseTitle(eventName(a)).localeCompare(normalizeBaseTitle(eventName(b)));
  });
}

// -------------------- Option A ID parsing --------------------
// team:<LEAGUE>:<ATTRACTION_ID>:<NAME>
// artist:<ATTRACTION_ID>:<NAME>

function parsePickId(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  const parts = s.split(":").map((x) => String(x || "").trim());
  const kind = (parts[0] || "").toLowerCase();

  if (kind === "team") {
    const league = parts[1] || "";
    const attractionId = parts[2] || "";
    const name = parts.slice(3).join(":") || parts[3] || "";
    return { kind: "team", league, attractionId, name };
  }

  if (kind === "artist") {
    const attractionId = parts[1] || "";
    const name = parts.slice(2).join(":") || parts[2] || "";
    return { kind: "artist", attractionId, name };
  }

  return { kind, raw: s };
}

// -------------------- Ticketmaster fetch --------------------

async function fetchTMEvents(params) {
  if (!TM_KEY) return { ok: false, events: [], error: "Missing TICKETMASTER_API_KEY" };

  params.set("apikey", TM_KEY);
  const url = `${TM_EVENTS}?${params.toString()}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    const events =
      (Array.isArray(json?._embedded?.events) && json._embedded.events) ||
      (Array.isArray(json?.events) && json.events) ||
      [];
    return { ok: res.ok, events, raw: json };
  } catch (e) {
    return { ok: false, events: [], error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function fetchEventsForCountries(baseParams, countryCodes) {
  const merged = [];
  const debug = [];

  for (const cc of countryCodes) {
    const p = new URLSearchParams(baseParams.toString());
    p.set("countryCode", cc);

    const r = await fetchTMEvents(p);
    debug.push({ country: cc, ok: !!r.ok, count: Array.isArray(r.events) ? r.events.length : 0 });

    if (Array.isArray(r.events) && r.events.length) merged.push(...r.events);
  }

  const sorted = sortEvents(merged);
  return { events: dedupeEvents(sorted), perCountry: debug };
}

async function fetchCandidatesByClassificationNames(baseParams, countryCodes, classNames) {
  const merged = [];
  const debug = [];

  for (const name of classNames || []) {
    const p = new URLSearchParams(baseParams.toString());
    p.set("classificationName", String(name));

    const r = await fetchEventsForCountries(p, countryCodes);

    debug.push({
      classificationName: name,
      perCountry: r.perCountry,
      count: Array.isArray(r.events) ? r.events.length : 0,
    });

    if (Array.isArray(r.events) && r.events.length) merged.push(...r.events);
  }

  const sorted = sortEvents(merged);
  return { events: dedupeEvents(sorted), perGenre: debug };
}

// -------------------- core logic --------------------

function computeTripHeader(events) {
  const dates = [...new Set((events || []).map(eventLocalDate).filter(Boolean))].sort();
  const startYMD = dates[0] || null;
  const endYMD = dates.length ? dates[dates.length - 1] : startYMD;

  const locSet = new Set();
  for (const e of events || []) {
    const cs = [eventCity(e), eventRegion(e)].filter(Boolean).join(", ");
    if (cs) locSet.add(cs);
  }

  return { startYMD, endYMD, locations: Array.from(locSet) };
}

function hashStr(s) {
  // djb2-ish, stable and fast
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  // force unsigned + shorten
  return (h >>> 0).toString(36);
}

function scoreEvent(e, { anchor, secondaryAttractionId, musicGenres, sportsGenres, radiusMiles }) {
  let score = 0;

  const ll = eventLatLon(e);
  if (anchor && ll) {
    const d = haversineMiles(anchor, ll);
    const closeness = Math.max(0, 1 - d / Math.max(1, radiusMiles));
    score += closeness * 50;
  } else {
    score += 10;
  }

  const blob = eventGenreBlob(e);
  const wantsAnyGenre = (musicGenres?.length || 0) + (sportsGenres?.length || 0) > 0;

  let genreHit = false;
  if (wantsAnyGenre) {
    for (const mg of musicGenres || []) if (blob.includes(norm(mg))) genreHit = true;
    for (const sg of sportsGenres || []) if (blob.includes(norm(sg))) genreHit = true;
    if (genreHit) score += 35;
  } else {
    score += 5;
  }

  if (secondaryAttractionId) {
    const atts = e?._embedded?.attractions;
    const hasSecondary = Array.isArray(atts)
      ? atts.some((a) => String(a?.id || "") === String(secondaryAttractionId))
      : false;
    if (hasSecondary) score += 50;
  }

  return Math.round(score);
}

function eventMatchesSecondary(e, secondaryAttractionId) {
  if (!secondaryAttractionId) return true;
  const atts = e?._embedded?.attractions;
  if (!Array.isArray(atts)) return false;
  return atts.some((a) => String(a?.id || "") === String(secondaryAttractionId));
}

function eventMatchesAnyGenre(e, musicGenres, sportsGenres) {
  const wantsAnyGenre = (musicGenres?.length || 0) + (sportsGenres?.length || 0) > 0;
  if (!wantsAnyGenre) return true;

  const blob = eventGenreBlob(e);
  for (const mg of musicGenres || []) if (blob.includes(norm(mg))) return true;
  for (const sg of sportsGenres || []) if (blob.includes(norm(sg))) return true;
  return false;
}

function pickTripLatLon(anchorEvent, sortedEvents) {
  const a = eventLatLon(anchorEvent);
  if (a) return a;

  for (const e of sortedEvents || []) {
    const ll = eventLatLon(e);
    if (ll) return ll;
  }

  return null;
}

function buildTrips({
  anchors,
  candidates,
  radiusMiles,
  tripDays,
  secondaryAttractionId,
  musicGenres,
  sportsGenres,
}) {
  const halfWindowDays = Math.floor(tripDays / 2);
  const wantsAnyGenre = (musicGenres?.length || 0) + (sportsGenres?.length || 0) > 0;

  // Only show nearby candidates in the main trip table when P2 is set.
  const includeCandidatesInTripEvents = !!secondaryAttractionId;

  // If user selected any genres, require at least one nearby genre hit to return a trip.
  const requireGenreHit = wantsAnyGenre;

  // index candidates by date
  const byDate = new Map();
  for (const e of candidates || []) {
    const d = eventLocalDate(e);
    if (!d) continue;
    const arr = byDate.get(d) || [];
    arr.push(e);
    byDate.set(d, arr);
  }

  const trips = [];
  const seenTripSig = new Set();

  for (const anchorEvent of anchors || []) {
    const anchorDate = eventLocalDate(anchorEvent);
    if (!anchorDate) continue;

    const anchorLL = eventLatLon(anchorEvent);

    const windowStart = addDaysYMD(anchorDate, -halfWindowDays);
    const windowEnd = addDaysYMD(anchorDate, +halfWindowDays);
    if (!windowStart || !windowEnd) continue;

    // gather window events
    const windowEvents = [];
    for (let d = windowStart; d <= windowEnd; ) {
      const list = byDate.get(d) || [];
      windowEvents.push(...list);
      const next = addDaysYMD(d, 1);
      if (!next) break;
      d = next;
    }

    // distance filter
    const near = [];
    for (const e of windowEvents) {
      if (!eventUrl(e)) continue;
      if (isExcludedFromMatching(e)) continue;
      const ll = eventLatLon(e);
      if (anchorLL && ll) {
        if (haversineMiles(anchorLL, ll) <= radiusMiles) near.push(e);
      } else {
        near.push(e);
      }
    }

    // pools
    const eligiblePool = dedupeEvents([anchorEvent, ...near]);
    const eligibleSorted = sortEvents(eligiblePool);

    const displayPool = includeCandidatesInTripEvents ? eligibleSorted : [anchorEvent];
    const displaySorted = sortEvents(dedupeEvents(displayPool));

    // eligibility gating
    const secondaryOk = secondaryAttractionId
      ? eligibleSorted.some((e) => eventMatchesSecondary(e, secondaryAttractionId))
      : true;

    const genreOk = requireGenreHit
      ? near.some((e) => eventMatchesAnyGenre(e, musicGenres, sportsGenres))
      : true;

    if (!secondaryOk) continue;
    if (!genreOk) continue;

    // dedupe trips
const sig = eligibleSorted.map((e) => dedupeKey(e) || gameKey(e) || "").join("~");
    if (seenTripSig.has(sig)) continue;
    seenTripSig.add(sig);
const sigHash = hashStr(sig);
    const tripLL = pickTripLatLon(anchorEvent, eligibleSorted);

    const scoredEvents = displaySorted.map((e) => {
      const score = scoreEvent(e, {
        anchor: anchorLL ? { lat: anchorLL.lat, lon: anchorLL.lon } : null,
        secondaryAttractionId,
        musicGenres,
        sportsGenres,
        radiusMiles,
      });

      const baseName = sanitizeDisplayName(eventName(e));
      const promo = extractPromoLabel(e);

      return {
        date: eventLocalDate(e),
        name: promo ? `${baseName} — ${promo}` : baseName,
        location: [eventCity(e), eventRegion(e)].filter(Boolean).join(", "),
        genre: eventGenre(e),
        score,
        url: eventUrl(e),
        __raw: e,
      };
    });

    const header = includeCandidatesInTripEvents
      ? computeTripHeader(displaySorted)
      : {
          startYMD: windowStart,
          endYMD: windowEnd,
          locations: [
            [eventCity(anchorEvent), eventRegion(anchorEvent)].filter(Boolean).join(", "),
          ].filter(Boolean),
        };

    trips.push({
      startYMD: header.startYMD,
      endYMD: header.endYMD,
      locations: header.locations,
      events: scoredEvents,
      ...(tripLL ? { lat: tripLL.lat, lon: tripLL.lon } : {}),
tripKey: `${gameKey(anchorEvent)}|${radiusMiles}|${tripDays}|${sigHash}`,
    });

    if (trips.length >= 300) break;
  }

  trips.sort((a, b) => {
    const as = a.startYMD || "9999-12-31";
    const bs = b.startYMD || "9999-12-31";
    if (as !== bs) return as < bs ? -1 : 1;

    const aMax = Math.max(...(a.events || []).map((e) => Number(e.score) || 0), 0);
    const bMax = Math.max(...(b.events || []).map((e) => Number(e.score) || 0), 0);
    return bMax - aMax;
  });

  return trips;
}

// -------------------- handler --------------------

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const primaryId = searchParams.get("primaryId");
    const secondaryId = searchParams.get("secondaryId");

    const musicGenres = sanitizePickList(searchParams.getAll("musicGenres"), MUSIC_ALLOWED);
    const sportsGenres = sanitizePickList(searchParams.getAll("sportsGenres"), SPORTS_ALLOWED);

    const tripDays = clampInt(searchParams.get("tripDays"), 1, 30, DEFAULT_TRIP_DAYS);

    const radiusMilesRaw = searchParams.get("radiusMiles");
    let radiusMiles = clampInt(radiusMilesRaw, 1, 2000, DEFAULT_RADIUS_MILES);

    if (!radiusMilesRaw) {
      if (tripDays <= 3) radiusMiles = 60;
      else if (tripDays <= 5) radiusMiles = 120;
      else radiusMiles = 180;
    }

    // support both start/end and startYMD/endYMD just in case
    const startYMD =
      isYMD(searchParams.get("start")) ? searchParams.get("start") :
      isYMD(searchParams.get("startYMD")) ? searchParams.get("startYMD") :
      null;

    const endYMD =
      isYMD(searchParams.get("end")) ? searchParams.get("end") :
      isYMD(searchParams.get("endYMD")) ? searchParams.get("endYMD") :
      null;

    const defaultStart = startYMD || todayUTCYMD();
    const defaultEnd = endYMD || addDaysYMD(defaultStart, 300);

    const countryCodeRaw = searchParams.get("countryCode") || "US,CA";
    const countryCodes = normalizeCountryCodes(countryCodeRaw);

    const primary = parsePickId(primaryId);
    const secondary = parsePickId(secondaryId);

    const primaryAttractionId =
      primary?.kind === "team" ? primary?.attractionId :
      primary?.kind === "artist" ? primary?.attractionId :
      null;

    const secondaryAttractionId =
      secondary?.kind === "team" ? secondary?.attractionId :
      secondary?.kind === "artist" ? secondary?.attractionId :
      null;

    const hasSecondaryInput = !!String(secondaryId || "").trim();
    const wantsAnyGenre = (musicGenres?.length || 0) + (sportsGenres?.length || 0) > 0;

    const singlePrimaryNoInterests = !hasSecondaryInput && !wantsAnyGenre;
    const halfWindowDays = Math.floor(tripDays / 2);

    const debug = {
      inputs: {
        primaryId: primaryId || null,
        secondaryId: secondaryId || null,
        musicGenres,
        sportsGenres,
        tripDays,
        halfWindowDays,
        radiusMiles,
        startYMD,
        endYMD,
        countryCode: countryCodes.join(","),
      },
      counts: {
        anchorsFetched: 0,
        anchorOccurrences: 0,
        anchorsUsed: 0,
        trips: 0,
      },
      notes: [
        "Anchors are deduped to occurrences (prevents premium seating duplicates from producing multiple trips).",
        "Nearby candidates are also deduped to occurrences before filtering/scoring.",
        "Eligibility requires secondary hit if secondaryId provided; requires at least one genre hit if genres selected.",
        "Hard anchor cap applied to protect serverless runtime.",
        "OPTION A enabled: events are fetched per-country (US then CA) and merged.",
        "Trip-level lat/lon is derived from anchor venue coords when available.",
"Deduping prefers Ticketmaster event id; fallback key is localDate + (music: rounded lat/lon, else: venueId or city/region) + normalized base title.",
        "Genre matching uses a blob of segment+genre+subGenre to avoid 'Golf' being missed when it's in a different field.",
      ],
      tm: {},
    };

    if (!TM_KEY) {
      return NextResponse.json(
        { count: 0, potentialTrips: [], error: "Missing TICKETMASTER_API_KEY", debug },
        { status: 500 }
      );
    }

    if (!primaryAttractionId) {
      return NextResponse.json(
        {
          count: 0,
          potentialTrips: [],
          debug,
          error: "primaryId missing attractionId (expects team/artist IDs with attractionId).",
        },
        { status: 400 }
      );
    }

    // -------------------- Fetch anchor events (primary) --------------------
    const anchorParams = new URLSearchParams();
    anchorParams.set("size", "200");
    anchorParams.set("sort", "date,asc");
    anchorParams.set("attractionId", String(primaryAttractionId));
    anchorParams.set("startDateTime", `${defaultStart}T00:00:00Z`);
    anchorParams.set("endDateTime", `${defaultEnd}T23:59:59Z`);

    const anchorFetch = await fetchEventsForCountries(anchorParams, countryCodes);
    debug.tm.anchorPerCountry = anchorFetch.perCountry;

    let anchorsAll = sortEvents(anchorFetch.events);

    // Filter TEAM schedules only
    if (primary?.kind === "team") {
      anchorsAll = anchorsAll.filter(looksLikeTeamGameEvent);
    }

    anchorsAll = anchorsAll.slice(0, HARD_ANCHOR_EVENT_CAP);
    debug.counts.anchorsFetched = anchorsAll.length;

    const anchorOccSeen = new Set();
    const anchors = [];
    for (const e of anchorsAll) {
      const sig = dedupeKey(e) || gameKey(e);
if (anchorOccSeen.has(sig)) continue;
anchorOccSeen.add(sig);
anchors.push(e);

    }
    debug.counts.anchorOccurrences = anchors.length;

    if (anchors.length === 0) {
      return NextResponse.json({ count: 0, potentialTrips: [], debug });
    }

    // -------------------- Fetch candidate events --------------------
    let candidatesAll = [];

    if (singlePrimaryNoInterests) {
      debug.notes.push(
        "Single-primary + no-interest mode: skipping candidate fetch so matching events are empty."
      );
      debug.tm.candidatePerCountry = [];
    } else {
      const candidateParams = new URLSearchParams();
      candidateParams.set("size", "200");
      candidateParams.set("sort", "date,asc");

      const firstAnchor = eventLocalDate(anchors[0]);
      const lastAnchor = eventLocalDate(anchors[anchors.length - 1]);
      const bandStart = firstAnchor ? addDaysYMD(firstAnchor, -halfWindowDays) : defaultStart;
      const bandEnd = lastAnchor ? addDaysYMD(lastAnchor, +halfWindowDays) : defaultEnd;

      if (bandStart) candidateParams.set("startDateTime", `${bandStart}T00:00:00Z`);
      if (bandEnd) candidateParams.set("endDateTime", `${bandEnd}T23:59:59Z`);

      if (secondaryAttractionId) {
        // P2 schedule mode
        candidateParams.set("attractionId", String(secondaryAttractionId));
        debug.tm.candidateBand = { bandStart, bandEnd, attractionId: secondaryAttractionId };

        const candidateFetch = await fetchEventsForCountries(candidateParams, countryCodes);
        debug.tm.candidatePerCountry = candidateFetch.perCountry;

        candidatesAll = candidateFetch.events || [];

        // Filter TEAM schedules only
        if (secondary?.kind === "team") {
          candidatesAll = candidatesAll.filter(looksLikeTeamGameEvent);
        }
      } else {
        // Genre-interest mode
        const classNames = [...(musicGenres || []), ...(sportsGenres || [])];
        debug.tm.candidateBand = { bandStart, bandEnd, attractionId: null, classificationNames: classNames };

        const byGenre = await fetchCandidatesByClassificationNames(candidateParams, countryCodes, classNames);
        debug.tm.candidatePerGenre = byGenre.perGenre;

        candidatesAll = byGenre.events || [];
        // IMPORTANT: do NOT apply looksLikeTeamGameEvent() here, because Golf/Tennis/etc are not "team games".
      }

      // Exclude Other/unclassified, then dedupe, then cap
      candidatesAll = dedupeEvents((candidatesAll || []).filter((e) => !isExcludedFromMatching(e)));

      if (candidatesAll.length > HARD_NEARBY_EVENT_CAP) {
        candidatesAll = sortEvents(candidatesAll).slice(0, HARD_NEARBY_EVENT_CAP);
      }
    }





    // -------------------- Build trips --------------------
    const potentialTrips = buildTrips({
      anchors,
      candidates: candidatesAll,
      radiusMiles,
      tripDays,
      secondaryAttractionId: secondaryAttractionId || null,
      musicGenres,
      sportsGenres,
    });

    debug.counts.anchorsUsed = anchors.length;
    debug.counts.trips = potentialTrips.length;

    return NextResponse.json({
      count: potentialTrips.length,
      potentialTrips,
      debug,
    });
  } catch (e) {
    return NextResponse.json(
      { count: 0, potentialTrips: [], error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
