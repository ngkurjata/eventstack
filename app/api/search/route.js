// FILE: app/api/search/route.js
import { NextResponse } from "next/server";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_EVENTS = `${TM_BASE}/events.json`;

const TM_KEY = process.env.TICKETMASTER_API_KEY;

// Safety caps (serverless/runtime protection)
const HARD_ANCHOR_EVENT_CAP = 600; // bump so P1 schedule is reliably complete
const HARD_NEARBY_EVENT_CAP = 600;
const DEFAULT_RADIUS_MILES = 180;
const DEFAULT_TRIP_DAYS = 7;

// Paging controls (TM max size ~200)
const PAGE_SIZE = 200;
const MAX_PAGES = 8; // 8 * 200 = 1600 raw; we stop early if caps hit

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
          const hit = allowed.find((a) => s.toLowerCase().includes(String(a).toLowerCase()));
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

/**
 * Fallback when coordinates are missing:
 * 1) Same venueId => accept
 * 2) Same city/region => accept
 */
function sameVenueOrCityRegion(anchorEvent, candidateEvent) {
  const av = eventVenueId(anchorEvent);
  const bv = eventVenueId(candidateEvent);
  if (av && bv && String(av) === String(bv)) return true;

  const ac = norm(eventCity(anchorEvent));
  const ar = norm(eventRegion(anchorEvent));
  const bc = norm(eventCity(candidateEvent));
  const br = norm(eventRegion(candidateEvent));

  if (!ac || !bc) return false;
  if (ac !== bc) return false;
  if (ar && br) return ar === br;
  return true;
}

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
    const latR = ll ? Math.round(ll.lat * 1000) / 1000 : null;
    const lonR = ll ? Math.round(ll.lon * 1000) / 1000 : null;
    v = ll ? `${latR}|${lonR}` : `${norm(city)}|${norm(region)}|${norm(venueName)}`;
  } else {
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

  if (seg === "music") {
    const gk = gameKey(e);
    if (gk) return `gk:${gk}`;

    const tmId = eventTMId(e);
    return tmId ? `tm:${tmId}` : null;
  }

  const tmId = eventTMId(e);
  if (tmId) return `tm:${tmId}`;

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

// -------------------- Ticketmaster fetch (paged) --------------------

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

async function fetchAllPagesForCountries(baseParams, countryCodes, hardCap) {
  const codes = Array.isArray(countryCodes) && countryCodes.length ? countryCodes : ["US", "CA"];

  const merged = [];
  const debug = [];

  for (const cc of codes) {
    let page = 0;
    let done = false;
    let fetchedForCountry = 0;

    while (!done && page < MAX_PAGES && merged.length < hardCap) {
      const p = new URLSearchParams(baseParams.toString());
      p.set("countryCode", cc);
      p.set("size", String(PAGE_SIZE));
      p.set("page", String(page));

      const r = await fetchTMEvents(p);
      const rawEvents = Array.isArray(r.events) ? r.events : [];

      fetchedForCountry += rawEvents.length;
      if (rawEvents.length) merged.push(...rawEvents);

      // Stop conditions
      if (!r.ok) {
        debug.push({ country: cc, ok: false, page, count: rawEvents.length });
        break;
      }

      const pageInfo = r.raw?.page || null;
      const totalPages = Number(pageInfo?.totalPages);
      const number = Number(pageInfo?.number);

      debug.push({ country: cc, ok: true, page, count: rawEvents.length });

      if (Number.isFinite(totalPages) && Number.isFinite(number) && number >= totalPages - 1) done = true;
      if (rawEvents.length < PAGE_SIZE) done = true;

      page += 1;
    }

    // small guard: if TM returns nothing immediately, no need to keep paging
    if (fetchedForCountry === 0) {
      // continue to next country
    }
  }

  const sorted = sortEvents(merged);
  return { events: dedupeEvents(sorted), perCountry: debug };
}

// -------------------- core logic --------------------

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function eventMatchesSecondary(e, secondaryAttractionId) {
  if (!secondaryAttractionId) return true;
  const atts = e?._embedded?.attractions;
  if (!Array.isArray(atts)) return false;
  return atts.some((a) => String(a?.id || "") === String(secondaryAttractionId));
}

function buildPrimaryRows({ anchors, candidates, radiusMiles, tripDays, secondaryAttractionId }) {
  const halfWindowDays = Math.floor(tripDays / 2);

  // index candidates by date for fast window lookup
  const byDate = new Map();
  for (const e of candidates || []) {
    const d = eventLocalDate(e);
    if (!d) continue;
    const arr = byDate.get(d) || [];
    arr.push(e);
    byDate.set(d, arr);
  }

  const rows = [];
  const seenAnchorKey = new Set();

  for (const anchorEvent of anchors || []) {
    const anchorDate = eventLocalDate(anchorEvent);
    if (!anchorDate) continue;

    const anchorLL = eventLatLon(anchorEvent);

    const aKey =
      dedupeKey(anchorEvent) ||
      gameKey(anchorEvent) ||
      `${anchorDate}|${eventName(anchorEvent) || ""}`;

    if (seenAnchorKey.has(aKey)) continue;
    seenAnchorKey.add(aKey);

    const windowStart = addDaysYMD(anchorDate, -halfWindowDays);
    const windowEnd = addDaysYMD(anchorDate, +halfWindowDays);
    if (!windowStart || !windowEnd) continue;

    // gather window events (by date)
    const windowEvents = [];
    for (let d = windowStart; d <= windowEnd; ) {
      const list = byDate.get(d) || [];
      windowEvents.push(...list);
      const next = addDaysYMD(d, 1);
      if (!next) break;
      d = next;
    }

    // distance filters (for P2 overlap)
    const near = [];
    for (const e of windowEvents) {
      if (!eventUrl(e)) continue;

      const ll = eventLatLon(e);
      if (anchorLL && ll) {
        if (haversineMiles(anchorLL, ll) <= radiusMiles) near.push(e);
        continue;
      }

      if (sameVenueOrCityRegion(anchorEvent, e)) near.push(e);
    }

    // SAFETY: never let the anchor itself appear in secondary pool
    const anchorDedupe = dedupeKey(anchorEvent) || null;

    const secondaryRaw = secondaryAttractionId
      ? near.filter((e) => {
          if (anchorDedupe) {
            const k = dedupeKey(e);
            if (k && k === anchorDedupe) return false;
          }
          return eventMatchesSecondary(e, secondaryAttractionId);
        })
      : [];

    const secondaryEvents = sortEvents(dedupeEvents(secondaryRaw)).map((e) => {
      const baseName = sanitizeDisplayName(eventName(e));
      const promo = extractPromoLabel(e);
      const ll = eventLatLon(e);
      return {
        date: eventLocalDate(e),
        name: promo ? `${baseName} — ${promo}` : baseName,
        location: [eventCity(e), eventRegion(e)].filter(Boolean).join(", "),
        genre: eventGenre(e),
        url: eventUrl(e),
        ...(ll ? { lat: ll.lat, lon: ll.lon } : {}),
      };
    });

    const anchorBaseName = sanitizeDisplayName(eventName(anchorEvent));
    const anchorPromo = extractPromoLabel(anchorEvent);

    const anchor = (() => {
      const ll = eventLatLon(anchorEvent);
      return {
        date: anchorDate,
        name: anchorPromo ? `${anchorBaseName} — ${anchorPromo}` : anchorBaseName,
        location: [eventCity(anchorEvent), eventRegion(anchorEvent)].filter(Boolean).join(", "),
        genre: eventGenre(anchorEvent),
        url: eventUrl(anchorEvent),
        ...(ll ? { lat: ll.lat, lon: ll.lon } : {}),
      };
    })();

    const hasCrossover = (secondaryEvents?.length || 0) > 0;

    rows.push({
      rowKey: `${gameKey(anchorEvent)}|${radiusMiles}|${tripDays}|${hashStr(aKey)}`,
      windowStart,
      windowEnd,
      anchor,
      hasCrossover,
      secondaryEvents,
    });

    if (rows.length >= 600) break;
  }

  rows.sort((a, b) => {
    const ad = a.anchor?.date || "9999-12-31";
    const bd = b.anchor?.date || "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    const ac = a.hasCrossover ? 1 : 0;
    const bc = b.hasCrossover ? 1 : 0;
    return bc - ac;
  });

  return rows;
}

// -------------------- handler --------------------

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const primaryId = searchParams.get("primaryId");
    const secondaryId = searchParams.get("secondaryId");

    // Keep these (even though rows mode doesn't use genres) so your UI can still pass them through
    sanitizePickList(searchParams.getAll("musicGenres"), MUSIC_ALLOWED);
    sanitizePickList(searchParams.getAll("sportsGenres"), SPORTS_ALLOWED);

    const mode = (searchParams.get("mode") || "trips").toLowerCase(); // "rows" | "trips"
    const isRowsMode = mode === "rows";

    const tripDays = clampInt(searchParams.get("tripDays"), 1, 30, DEFAULT_TRIP_DAYS);

    const radiusMilesRaw = searchParams.get("radiusMiles");
    let radiusMiles = clampInt(radiusMilesRaw, 1, 2000, DEFAULT_RADIUS_MILES);

    if (!radiusMilesRaw) {
      if (tripDays <= 3) radiusMiles = 60;
      else if (tripDays <= 5) radiusMiles = 120;
      else radiusMiles = 180;
    }

    const startYMD = isYMD(searchParams.get("start"))
      ? searchParams.get("start")
      : isYMD(searchParams.get("startYMD"))
      ? searchParams.get("startYMD")
      : null;

    const endYMD = isYMD(searchParams.get("end"))
      ? searchParams.get("end")
      : isYMD(searchParams.get("endYMD"))
      ? searchParams.get("endYMD")
      : null;

    const defaultStart = startYMD || todayUTCYMD();
    // make default window large so "entire schedule" doesn't cut off early
    const defaultEnd = endYMD || addDaysYMD(defaultStart, 420);

    const countryCodeRaw = searchParams.get("countryCode") || "US,CA";
    const countryCodes = normalizeCountryCodes(countryCodeRaw);

    const primary = parsePickId(primaryId);
    const secondary = parsePickId(secondaryId);

    const primaryAttractionId =
      primary?.kind === "team"
        ? primary?.attractionId
        : primary?.kind === "artist"
        ? primary?.attractionId
        : null;

    const secondaryAttractionId =
      secondary?.kind === "team"
        ? secondary?.attractionId
        : secondary?.kind === "artist"
        ? secondary?.attractionId
        : null;

    const halfWindowDays = Math.floor(tripDays / 2);

    const debug = {
      inputs: {
        primaryId: primaryId || null,
        secondaryId: secondaryId || null,
        tripDays,
        halfWindowDays,
        radiusMiles,
        startYMD,
        endYMD,
        countryCode: countryCodes.join(","),
        mode,
      },
      counts: {
        anchorsFetched: 0,
        anchorOccurrences: 0,
        anchorsUsed: 0,
        rows: 0,
      },
      notes: [
        "Rows mode: always returns the full P1 schedule (paged), and highlights P1 rows that have any P2 events within radius+window.",
        "Genre matching is NOT computed here (client fetches it lazily via /api/trip-matches only when genres are selected).",
        "Anchors are deduped to occurrences to prevent premium seating duplicates from producing multiple rows.",
      ],
      tm: {},
    };

    if (!TM_KEY) {
      return NextResponse.json({ count: 0, rows: [], error: "Missing TICKETMASTER_API_KEY", debug }, { status: 500 });
    }

    if (!primaryAttractionId) {
      return NextResponse.json(
        { count: 0, rows: [], debug, error: "primaryId missing attractionId (expects team/artist IDs with attractionId)." },
        { status: 400 }
      );
    }

    if (!isRowsMode) {
      return NextResponse.json(
        { error: "This /api/search build is optimized for mode=rows.", debug },
        { status: 400 }
      );
    }

    // -------------------- Fetch anchor events (primary) (PAGED) --------------------
    const anchorParams = new URLSearchParams();
    anchorParams.set("sort", "date,asc");
    anchorParams.set("attractionId", String(primaryAttractionId));
    anchorParams.set("startDateTime", `${defaultStart}T00:00:00Z`);
    anchorParams.set("endDateTime", `${defaultEnd}T23:59:59Z`);

    const anchorFetch = await fetchAllPagesForCountries(anchorParams, countryCodes, HARD_ANCHOR_EVENT_CAP);
    debug.tm.anchorPerCountry = anchorFetch.perCountry;

    let anchorsAll = sortEvents(anchorFetch.events);

    if (primary?.kind === "team") {
      anchorsAll = anchorsAll.filter(looksLikeTeamGameEvent);
    }

    anchorsAll = anchorsAll.slice(0, HARD_ANCHOR_EVENT_CAP);
    debug.counts.anchorsFetched = anchorsAll.length;

    const anchorOccSeen = new Set();
    const anchors = [];
    for (const e of anchorsAll) {
      const sig = dedupeKey(e) || gameKey(e);
      if (!sig) continue;
      if (anchorOccSeen.has(sig)) continue;
      anchorOccSeen.add(sig);
      anchors.push(e);
    }
    debug.counts.anchorOccurrences = anchors.length;

    if (anchors.length === 0) {
      return NextResponse.json({ count: 0, rows: [], debug });
    }

    // -------------------- Fetch P2 schedule for overlap shading (PAGED) --------------------
    let candidatesAll = [];

    if (!secondaryAttractionId) {
      debug.tm.candidatePerCountry = [];
      debug.notes.push("Rows mode: no secondary selected, skipping candidate fetch.");
    } else {
      const candidateParams = new URLSearchParams();
      candidateParams.set("sort", "date,asc");

      const firstAnchor = eventLocalDate(anchors[0]);
      const lastAnchor = eventLocalDate(anchors[anchors.length - 1]);

      const bandStart = firstAnchor ? addDaysYMD(firstAnchor, -halfWindowDays) : defaultStart;
      const bandEnd = lastAnchor ? addDaysYMD(lastAnchor, +halfWindowDays) : defaultEnd;

      if (bandStart) candidateParams.set("startDateTime", `${bandStart}T00:00:00Z`);
      if (bandEnd) candidateParams.set("endDateTime", `${bandEnd}T23:59:59Z`);
      candidateParams.set("attractionId", String(secondaryAttractionId));

      debug.tm.candidateBand = { bandStart, bandEnd, attractionId: secondaryAttractionId };

      const p2Fetch = await fetchAllPagesForCountries(candidateParams, countryCodes, HARD_NEARBY_EVENT_CAP);
      debug.tm.candidatePerCountry = p2Fetch.perCountry;

      let p2Events = p2Fetch.events || [];
      if (secondary?.kind === "team") {
        p2Events = p2Events.filter(looksLikeTeamGameEvent);
      }

      // NOTE: we do NOT apply isExcludedFromMatching here aggressively, because some sports variants
      // can have funky classification fields; overlap shading should be tolerant.
      candidatesAll = dedupeEvents(p2Events);

      if (candidatesAll.length > HARD_NEARBY_EVENT_CAP) {
        candidatesAll = sortEvents(candidatesAll).slice(0, HARD_NEARBY_EVENT_CAP);
      }
    }

    const rows = buildPrimaryRows({
      anchors,
      candidates: candidatesAll,
      radiusMiles,
      tripDays,
      secondaryAttractionId: secondaryAttractionId || null,
    });

    debug.counts.anchorsUsed = anchors.length;
    debug.counts.rows = rows.length;

    return NextResponse.json({ count: rows.length, rows, debug });
  } catch (e) {
    return NextResponse.json({ count: 0, rows: [], error: String(e?.message || e) }, { status: 500 });
  }
}
