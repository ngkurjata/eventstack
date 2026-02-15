// FILE: app/api/search/route.js
import { NextResponse } from "next/server";

const TM_EVENTS = "https://app.ticketmaster.com/discovery/v2/events.json";
const TM_ATTRACTIONS = "https://app.ticketmaster.com/discovery/v2/attractions.json";

// Genre buckets (if you still use genres)
const GENRE_EXPANSION = {
  Country: ["country", "contemporary country", "country rock", "americana", "bluegrass"],
  Rock: ["rock", "alternative", "indie", "punk", "grunge", "hard rock"],
  Pop: ["pop", "k-pop", "kpop", "j-pop", "jpop"],
  Rap: ["rap", "hip hop", "hip-hop", "trap"],
  Electronic: ["electronic", "edm", "dance", "house", "techno", "trance", "dubstep"],
  "R&B": ["r&b", "rnb", "rhythm and blues", "neo soul", "neo-soul", "soul"],
  Jazz: ["jazz", "swing", "bebop", "big band"],
  Classical: ["classical", "orchestra", "symphony", "opera", "baroque"],
  Latin: ["latin", "reggaeton", "bachata", "salsa", "cumbia", "mariachi"],
  Metal: ["metal", "metalcore", "death metal", "black metal", "thrash"],
  Reggae: ["reggae", "ska", "dancehall", "dub"],
  Folk: ["folk", "singer-songwriter", "traditional"],
};

/* ==================== Date range helpers ==================== */

function isYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function filterEventsByDateRange(events, startDate, endDate) {
  const s = isYMD(startDate) ? startDate : null;
  const e = isYMD(endDate) ? endDate : null;
  if (!s && !e) return events;

  return (events || []).filter((ev) => {
    const d = ev?.dates?.start?.localDate;
    if (!isYMD(d)) return false;
    if (s && d < s) return false;
    if (e && d > e) return false;
    return true;
  });
}

/* ==================== Attraction resolution ==================== */

function scoreCandidate(query, candName) {
  const q = String(query || "").toLowerCase().trim();
  const n = String(candName || "").toLowerCase().trim();
  if (!q || !n) return 0;

  let score = 0;
  if (n === q) score += 100;
  if (n.includes(q)) score += 40;

  const qWords = new Set(q.split(/\s+/).filter(Boolean));
  const nWords = new Set(n.split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const w of qWords) if (nWords.has(w)) overlap += 1;
  score += overlap * 5;

  return score;
}

async function resolveBestAttraction(apiKey, segmentName, keyword, countryCode = "US,CA") {
  const params = new URLSearchParams();
  params.set("apikey", apiKey);
  params.set("segmentName", segmentName); // "Music" or "Sports"
  params.set("keyword", keyword);
  params.set("size", "20");
  if (countryCode) params.set("countryCode", countryCode);

  const url = `${TM_ATTRACTIONS}?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json();

  const attractions = data?._embedded?.attractions || [];
  const candidates = attractions
    .map((a) => ({
      id: a?.id || null,
      name: a?.name || "",
      score: scoreCandidate(keyword, a?.name),
    }))
    .filter((c) => c.id);

  candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  return candidates[0] || null;
}

async function fetchAttractionNameById(apiKey, attractionId) {
  try {
    const url = `${TM_ATTRACTIONS}/${encodeURIComponent(attractionId)}.json?apikey=${encodeURIComponent(
      apiKey
    )}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const name = String(data?.name || "").trim();
    return name || null;
  } catch {
    return null;
  }
}

/* ==================== Pick parsing ==================== */

function parsePickOrRaw(pick) {
  const raw = String(pick || "").trim();
  if (!raw) return null;

  const parts = raw.split(":");
  const kind = parts[0];

  // team:LEAGUE:ATTRACTIONID:NAME (legacy)
  // team:LEAGUE:NAME (current)
  if (kind === "team") {
    if (parts.length >= 4) {
      return { type: "team", league: parts[1], attractionId: parts[2], name: parts.slice(3).join(":") };
    }
    if (parts.length >= 3) {
      return { type: "team", league: parts[1], attractionId: "", name: parts.slice(2).join(":") };
    }
    return null;
  }

  // artist:ATTRACTIONID
  if (kind === "artist") {
    if (parts.length >= 2) return { type: "artist", attractionId: parts[1], name: "" };
    return null;
  }

  // genre:BUCKET:NAME
  if (kind === "genre") return { type: "genre", bucket: parts[1], name: parts.slice(2).join(":") };

  // fallback: raw keyword
  return { type: "raw", name: raw };
}

function isEntityPick(p) {
  return p && (p.type === "team" || p.type === "artist");
}

async function ensureAttractionId(apiKey, pick) {
  if (!pick || !isEntityPick(pick)) return pick;

  if (pick.type === "artist") return pick;

  if (pick.type === "team") {
    if (!pick.attractionId && pick.name) {
      const best = await resolveBestAttraction(apiKey, "Sports", pick.name, "US,CA");
      if (best?.id) pick.attractionId = best.id;
    }
    return pick;
  }

  return pick;
}

/* ==================== Ticketmaster fetch helpers ==================== */

function hasTicketLink(e) {
  const url = String(e?.url || "").trim();
  return Boolean(url);
}

async function fetchEventsByParams(params) {
  const url = `${TM_EVENTS}?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  return data?._embedded?.events || [];
}

/* ==================== Occurrence helpers ==================== */

function eventMatchesGenreBucket(event, bucket) {
  const keywords = GENRE_EXPANSION[bucket];
  if (!keywords) return false;

  const classifications = event.classifications || [];
  return classifications.some((c) => {
    const g = (c.genre?.name || "").toLowerCase();
    const sg = (c.subGenre?.name || "").toLowerCase();
    return keywords.some((k) => g.includes(k) || sg.includes(k));
  });
}

function parseLocalDateToUTC(localDate) {
  if (!localDate) return null;
  const parts = String(localDate).split("-").map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  return new Date(Date.UTC(y, m - 1, d));
}

function diffDaysSigned(aLocalDate, bLocalDate) {
  const a = parseLocalDateToUTC(aLocalDate);
  const b = parseLocalDateToUTC(bLocalDate);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  return Math.round(days);
}

function diffDaysAbs(aLocalDate, bLocalDate) {
  const d = diffDaysSigned(aLocalDate, bLocalDate);
  return d == null ? null : Math.abs(d);
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* ==================== Closest-pair helpers (for 0-occurrence message) ==================== */

function getEventGeo(e) {
  const v = e?._embedded?.venues?.[0] || null;
  const latStr = v?.location?.latitude;
  const lonStr = v?.location?.longitude;
  const lat = latStr != null ? Number(latStr) : null;
  const lon = lonStr != null ? Number(lonStr) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function summarizeEventForClosest(e, fallbackLabel) {
  const v = e?._embedded?.venues?.[0] || null;
  const date = String(e?.dates?.start?.localDate || "").trim() || null;
  const city = String(v?.city?.name || "").trim() || null;

  const region =
    String(v?.state?.stateCode || v?.state?.name || v?.country?.countryCode || "")
      .trim() || null;

  const venue = String(v?.name || "").trim() || null;

  // Prefer the resolved schedule label (p1Label/p2Label) so we show "Edmonton Oilers" even if event.name is verbose.
  const label = String(fallbackLabel || "").trim() || String(e?.__pick?.name || "").trim() || "Event";

  return { label, date, city, region, venue };
}

function findClosestPairWithinDays(eventsA, eventsB, maxDiffDays, labelA, labelB) {
  const A = Array.isArray(eventsA) ? eventsA : [];
  const B = Array.isArray(eventsB) ? eventsB : [];
  if (!A.length || !B.length) return null;

  let best = null;

  for (const ea of A) {
    const da = String(ea?.dates?.start?.localDate || "").trim();
    if (!isYMD(da)) continue;

    const ga = getEventGeo(ea);
    if (!ga) continue;

    for (const eb of B) {
      const db = String(eb?.dates?.start?.localDate || "").trim();
      if (!isYMD(db)) continue;

      const daysApart = diffDaysAbs(da, db);
      if (daysApart == null || daysApart > maxDiffDays) continue;

      const gb = getEventGeo(eb);
      if (!gb) continue;

      const miles = haversineMiles(ga.lat, ga.lon, gb.lat, gb.lon);
      if (!Number.isFinite(miles)) continue;

      // Tie-breakers:
      // 1) smaller miles
      // 2) smaller daysApart
      // 3) earlier earliest date among the pair
      const earliest = da < db ? da : db;

      const candidate = {
        miles,
        daysApart,
        p1: summarizeEventForClosest(ea, labelA),
        p2: summarizeEventForClosest(eb, labelB),
        _earliest: earliest,
      };

      if (!best) {
        best = candidate;
        continue;
      }

      if (candidate.miles < best.miles - 1e-9) {
        best = candidate;
        continue;
      }
      if (Math.abs(candidate.miles - best.miles) <= 1e-9) {
        if (candidate.daysApart < best.daysApart) {
          best = candidate;
          continue;
        }
        if (candidate.daysApart === best.daysApart && candidate._earliest < best._earliest) {
          best = candidate;
          continue;
        }
      }
    }
  }

  if (!best) return null;
  const { _earliest, ...out } = best;
  return out;
}

function uniqueSortedDates(events) {
  const s = new Set();
  for (const e of events) {
    const d = String(e?.dates?.start?.localDate || "").trim();
    if (d) s.add(d);
  }
  return Array.from(s).sort();
}

function getAnchorLatLon(occ) {
  for (const e of occ) {
    const venue = e?._embedded?.venues?.[0];
    const lat = venue?.location?.latitude != null ? Number(venue.location.latitude) : null;
    const lon = venue?.location?.longitude != null ? Number(venue.location.longitude) : null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return null;
}

/* ==================== Normal-mode occurrence builder (P1 != P2) ==================== */

function pickKey(p) {
  if (!p) return "";
  const slot = p.__slot ? `|slot:${String(p.__slot)}` : "";
  if (p.type === "team") return `team:${p.league}:${p.attractionId || p.name || ""}${slot}`;
  if (p.type === "artist") return `artist:${p.attractionId || p.name || ""}${slot}`;
  if (p.type === "genre") return `genre:${p.bucket || ""}:${p.name || ""}${slot}`;
  return `raw:${p.name || ""}${slot}`;
}

function eventMetaForOccurrenceKey(e) {
  const venue = e?._embedded?.venues?.[0] || null;
  const date = e?.dates?.start?.localDate || "";

  const latStr = venue?.location?.latitude;
  const lonStr = venue?.location?.longitude;
  const lat = latStr != null ? Number(latStr) : null;
  const lon = lonStr != null ? Number(lonStr) : null;

  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  return { date, lat: hasCoords ? lat : null, lon: hasCoords ? lon : null };
}

function dedupeKeyForEvent(e) {
  const slot = e?.__pick?.__slot ? String(e.__pick.__slot) : "";

  const id = e?.id ? String(e.id).trim() : "";
  if (id) return slot ? `id:${id}|slot:${slot}` : `id:${id}`;

  const name = String(e?.name || "").trim().toLowerCase();
  const localDate = String(e?.dates?.start?.localDate || "").trim();
  const localTime = String(e?.dates?.start?.localTime || "").trim();

  const venue = e?._embedded?.venues?.[0];
  const venueId = String(venue?.id || "").trim();
  const venueName = String(venue?.name || "").trim().toLowerCase();
  const city = String(venue?.city?.name || "").trim().toLowerCase();

  const place = venueId ? `vid:${venueId}` : `v:${venueName}|c:${city}`;
  const base = `cmp:${name}|${localDate}|${localTime}|${place}`;
  return slot ? `${base}|slot:${slot}` : base;
}

function occurrenceEarliestDate(events) {
  const dates = uniqueSortedDates(events);
  return dates[0] || "9999-12-31";
}

function occurrencePickCoverageCount(events) {
  const picksSet = new Set();
  for (const e of events) picksSet.add(pickKey(e.__pick));
  return picksSet.size;
}

function occurrenceDistinctDateCount(events) {
  return uniqueSortedDates(events).length;
}

function occurrenceSpanDays(events) {
  const dates = uniqueSortedDates(events);
  if (dates.length === 0) return 0;
  const d = diffDaysAbs(dates[0], dates[dates.length - 1]);
  return Number.isFinite(d) ? d : 0;
}

function buildOccurrencesByRadiusAndDays(allEvents, maxMiles, effectiveDays) {
  const metas = allEvents
    .map((e) => {
      const meta = eventMetaForOccurrenceKey(e);
      const key = dedupeKeyForEvent(e);
      return { e, key, meta };
    })
    .filter((x) => x.key);

  const safeSpanDays = Number.isFinite(effectiveDays) ? Math.max(1, Math.floor(effectiveDays)) : 1;
  const maxDiffDays = Math.max(0, safeSpanDays - 1);

  const occurrencesMap = new Map();

  for (let i = 0; i < metas.length; i++) {
    const a = metas[i];
    if (!a.key) continue;

    // Require "a" to have coords + date, otherwise it can't seed a cluster.
    if (!a.meta.date || a.meta.lat == null || a.meta.lon == null) continue;

    const occEvents = new Map();
    occEvents.set(a.key, a.e);

    for (let j = 0; j < metas.length; j++) {
      if (i === j) continue;
      const b = metas[j];
      if (!b.key) continue;

      if (!b.meta.date || b.meta.lat == null || b.meta.lon == null) continue;

      const dSigned = diffDaysSigned(a.meta.date, b.meta.date);
      if (dSigned == null || dSigned < 0 || dSigned > maxDiffDays) continue;

      const miles = haversineMiles(a.meta.lat, a.meta.lon, b.meta.lat, b.meta.lon);
      if (miles <= maxMiles) occEvents.set(b.key, b.e);
    }

    const picksSet = new Set();
    for (const ev of occEvents.values()) picksSet.add(pickKey(ev.__pick));
    if (picksSet.size < 2) continue; // overlaps only

    const occList = Array.from(occEvents.values());

    const distinctDates = occurrenceDistinctDateCount(occList);
    if (distinctDates > safeSpanDays) continue;

    const hardSpan = occurrenceSpanDays(occList);
    if (hardSpan > maxDiffDays) continue;

    const sortedIds = Array.from(occEvents.keys()).sort();
    const occKey = sortedIds.join("|");
    if (!occurrencesMap.has(occKey)) occurrencesMap.set(occKey, occList);
  }

  const occurrences = Array.from(occurrencesMap.values());

  occurrences.sort((A, B) => {
    const aCoverage = occurrencePickCoverageCount(A);
    const bCoverage = occurrencePickCoverageCount(B);
    if (aCoverage !== bCoverage) return bCoverage - aCoverage;
    if (A.length !== B.length) return B.length - A.length;
    const aDate = occurrenceEarliestDate(A);
    const bDate = occurrenceEarliestDate(B);
    return aDate.localeCompare(bDate);
  });

  return occurrences;
}

/* ==================== Single-mode occurrence builder (unchanged) ==================== */

function locationKeyForEvent(e) {
  const v = e?._embedded?.venues?.[0] || null;
  const venueId = String(v?.id || "").trim();
  if (venueId) return `vid:${venueId}`;

  const venueName = String(v?.name || "").trim().toLowerCase();
  const city = String(v?.city?.name || "").trim().toLowerCase();
  const region =
    String(v?.state?.stateCode || v?.state?.name || v?.country?.countryCode || "")
      .trim()
      .toLowerCase();

  const base = [city, region, venueName].filter(Boolean).join("|");
  return base ? `loc:${base}` : "loc:unknown";
}

function sortKeyForEvent(e) {
  const d = String(e?.dates?.start?.localDate || "").trim(); // YYYY-MM-DD
  const t = String(e?.dates?.start?.localTime || "").trim(); // HH:MM:SS (optional)
  return `${d}T${t || "00:00:00"}`;
}

function buildOccurrencesSingleByLocationRuns(events) {
  const list = (events || [])
    .filter((e) => isYMD(e?.dates?.start?.localDate))
    .slice()
    .sort((a, b) => sortKeyForEvent(a).localeCompare(sortKeyForEvent(b)));

  const occs = [];
  let cur = [];
  let curKey = null;

  for (const e of list) {
    const k = locationKeyForEvent(e);
    if (!cur.length) {
      cur = [e];
      curKey = k;
      continue;
    }
    if (k === curKey) {
      cur.push(e);
    } else {
      occs.push(cur);
      cur = [e];
      curKey = k;
    }
  }

  if (cur.length) occs.push(cur);
  return occs;
}

/* ==================== Labels for fallback schedules ==================== */

function pickLabelFromPick(pick) {
  if (!pick) return "Pick";
  if (pick.type === "team") return pick.name || "Team";
  if (pick.type === "genre") return pick.bucket || pick.name || "Genre";
  if (pick.type === "raw") return pick.name || "Pick";
  // artist: pick.name may be empty (artist:id); resolve later from events if possible
  return pick.name || "Artist";
}

function labelFromScheduleEvents(pick, events) {
  const base = pickLabelFromPick(pick);
  if (pick?.type !== "artist") return base;

  // If artist name is empty, try to infer from the first event's attractions list
  if (base && base !== "Artist") return base;

  for (const ev of events || []) {
    const atts = ev?._embedded?.attractions;
    if (!Array.isArray(atts)) continue;
    const hit = atts.find((a) => String(a?.id || "") === String(pick?.attractionId || ""));
    if (hit?.name) {
      const nm = String(hit.name).trim();
      if (nm) return nm;
    }
  }
  return base;
}

/* ==================== Debug helper ==================== */

function envKeyDebug(key) {
  const s = String(key || "");
  const len = s.length;
  const head = len >= 2 ? s.slice(0, 2) : "";
  const tail = len >= 2 ? s.slice(-2) : "";
  return { present: Boolean(key), length: len, head, tail };
}

/* ==================== Main handler ==================== */

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const debugMode = searchParams.get("debug") === "1";

    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const apiKey = process.env.TICKETMASTER_API_KEY;
    const keyDbg = envKeyDebug(apiKey);
    console.log("ENV TICKETMASTER_API_KEY:", keyDbg);

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Missing API key",
          debug: debugMode ? { env: { TICKETMASTER_API_KEY: keyDbg } } : undefined,
        },
        { status: 500 }
      );
    }

    const userDays = Number(searchParams.get("days") || 3);
    const effectiveDays = Math.max(1, Math.floor(userDays) - 1);

    const radiusMiles = Number(searchParams.get("radiusMiles") || 100);
    const origin = (searchParams.get("origin") || "").trim();
    const countryCode = "US,CA";

    // Original raw picks (for single-mode detection)
    const rawP1Orig = (searchParams.get("p1") || "").trim();
    const rawP2Orig = (searchParams.get("p2") || "").trim();
    const rawP3 = (searchParams.get("p3") || "").trim();

    // Allow single-pick searches by mirroring the non-empty one
    const effectiveRawP1 = rawP1Orig || rawP2Orig;
    const effectiveRawP2 = rawP2Orig || rawP1Orig;

    const p1 = parsePickOrRaw(effectiveRawP1);
    const p2 = parsePickOrRaw(effectiveRawP2);
    const p3 = rawP3 ? parsePickOrRaw(rawP3) : null;

    if (!p1 || !p2) {
      return NextResponse.json({
        count: 0,
        occurrences: [],
        debug: { note: "Need at least 1 pick (p1 or p2)" },
      });
    }

    await ensureAttractionId(apiKey, p1);
    await ensureAttractionId(apiKey, p2);
    if (p3) await ensureAttractionId(apiKey, p3);

    // Detect single-favorite mode
    let singleMode =
      (!rawP1Orig && !!rawP2Orig) ||
      (!!rawP1Orig && !rawP2Orig) ||
      (!!rawP1Orig && !!rawP2Orig && rawP1Orig === rawP2Orig);

    if (isEntityPick(p1) && isEntityPick(p2)) {
      const id1 = String(p1.attractionId || "").trim();
      const id2 = String(p2.attractionId || "").trim();
      if (id1 && id2 && id1 === id2) singleMode = true;
    }

    // Choose the anchor pick for single mode (prefer the one user filled)
    const anchorPick = rawP1Orig ? p1 : rawP2Orig ? p2 : p1;

    const debugResolutions = [];
    const allEvents = [];

    if (singleMode) {
      // =========================
      // SINGLE MODE:
      // - KEEP date range filters
      // - IGNORE days/radius
      // - Occurrences = consecutive runs of same location
      // =========================

      const params = new URLSearchParams();
      params.set("apikey", apiKey);
      params.set("size", "200");
      params.set("countryCode", countryCode);
      params.set("sort", "date,asc");

      if (anchorPick.type === "team") {
        if (!anchorPick.attractionId && anchorPick.name) {
          const best = await resolveBestAttraction(apiKey, "Sports", anchorPick.name, countryCode);
          if (best?.id) anchorPick.attractionId = best.id;
          debugResolutions.push({ pick: anchorPick, resolved: best || null });
        }
        if (anchorPick.attractionId) params.set("attractionId", anchorPick.attractionId);
        else params.set("keyword", anchorPick.name || "");
      } else if (anchorPick.type === "artist") {
        if (anchorPick.attractionId) params.set("attractionId", anchorPick.attractionId);
        else params.set("keyword", anchorPick.name || "");
      } else if (anchorPick.type === "genre") {
        params.set("segmentName", "Music");
      } else {
        params.set("keyword", anchorPick.name || "");
      }

      let events = await fetchEventsByParams(params);
      events = filterEventsByDateRange(events, startDate, endDate);

      const filtered =
        anchorPick.type === "genre"
          ? events.filter((e) => eventMatchesGenreBucket(e, anchorPick.bucket))
          : events;

      allEvents.push(
        ...filtered
          .filter(hasTicketLink)
          .map((e) => ({
            ...e,
            __pick: anchorPick,
          }))
      );

      const occurrences = buildOccurrencesSingleByLocationRuns(allEvents);

      const occurrencesForUi = occurrences.map((occ) => {
        const dates = uniqueSortedDates(occ);
        const startYMD = dates[0] || null;
        const endYMD = dates[dates.length - 1] || null;
        const anchor = getAnchorLatLon(occ);
        const locKey = locationKeyForEvent(occ?.[0]);
        return {
          events: occ,
          popular: [],
          meta: { anchor, startYMD, endYMD, mode: "SINGLE_PICK_LOCATION_RUNS", locKey },
        };
      });

      return NextResponse.json({
        count: occurrencesForUi.length,
        occurrences: occurrencesForUi,
        debug: debugMode
          ? {
              note:
                "SINGLE MODE: occurrences are consecutive runs of same location. days/radius are ignored; date range is applied.",
              singleMode,
              startDate,
              endDate,
              ignored: { userDays, effectiveDays, radiusMiles },
              origin,
              anchorPick,
              resolutions: debugResolutions,
              counts: { fetchedEvents: allEvents.length, occurrences: occurrencesForUi.length },
              env: { TICKETMASTER_API_KEY: keyDbg },
            }
          : undefined,
      });
    }

    // =========================
    // NORMAL MODE:
    // P1 != P2 => overlap clustering by days/radius + 2-pick coverage requirement
    // PLUS: if 0 occurrences => return fallback schedules for UI overlay
    // =========================

    p1.__slot = "p1";
    p2.__slot = "p2";
    if (p3) p3.__slot = "p3";

    const picks = [p1, p2, ...(p3 ? [p3] : [])];

    // ✅ collect schedules for p1/p2 so the UI can show "no overlap" overlay
    const scheduleBySlot = { p1: [], p2: [] };

    for (const pick of picks) {
      const params = new URLSearchParams();
      params.set("apikey", apiKey);
      params.set("size", "200");
      params.set("countryCode", countryCode);
      params.set("sort", "date,asc"); // ✅ keep chronological

      if (pick.type === "team") {
        if (!pick.attractionId && pick.name) {
          const best = await resolveBestAttraction(apiKey, "Sports", pick.name, countryCode);
          if (best?.id) pick.attractionId = best.id;
          debugResolutions.push({ pick, resolved: best || null });
        }
        if (pick.attractionId) params.set("attractionId", pick.attractionId);
        else params.set("keyword", pick.name || "");
      } else if (pick.type === "artist") {
        if (pick.attractionId) params.set("attractionId", pick.attractionId);
        else params.set("keyword", pick.name || "");
      } else if (pick.type === "genre") {
        params.set("segmentName", "Music");
      } else {
        params.set("keyword", pick.name || "");
      }

      let events = await fetchEventsByParams(params);
      events = filterEventsByDateRange(events, startDate, endDate);

      const filtered =
        pick.type === "genre"
          ? events.filter((e) => eventMatchesGenreBucket(e, pick.bucket))
          : events;

      const mapped = filtered
        .filter(hasTicketLink)
        .map((e) => ({
          ...e,
          __pick: pick,
        }));

      allEvents.push(...mapped);

      if (pick.__slot === "p1") scheduleBySlot.p1.push(...mapped);
      if (pick.__slot === "p2") scheduleBySlot.p2.push(...mapped);
    }

    const occurrences = buildOccurrencesByRadiusAndDays(allEvents, radiusMiles, effectiveDays);

    const occurrencesForUi = occurrences.map((occ) => {
      const dates = uniqueSortedDates(occ);
      const startYMD = dates[0] || null;
      const endYMD = dates[dates.length - 1] || null;
      const anchor = getAnchorLatLon(occ);
      return {
        events: occ,
        popular: [],
        meta: { anchor, startYMD, endYMD },
      };
    });

    // ✅ fallback schedules for "0 overlap" UI overlay (P1 != P2)
    let fallback = undefined;
    let closest = undefined;
    if (occurrencesForUi.length === 0) {
      const s1 = (scheduleBySlot.p1 || []).slice().sort((a, b) => sortKeyForEvent(a).localeCompare(sortKeyForEvent(b)));
      const s2 = (scheduleBySlot.p2 || []).slice().sort((a, b) => sortKeyForEvent(a).localeCompare(sortKeyForEvent(b)));

      const p1Label = labelFromScheduleEvents(p1, s1);
      const p2Label = labelFromScheduleEvents(p2, s2);

      fallback = {
        mode: "NO_OVERLAP_SCHEDULES",
        schedules: [
          { label: p1Label, events: s1 },
          { label: p2Label, events: s2 },
        ],
      };

      // ✅ Also compute the "closest pair" within the user's day constraint,
      // so the UI can say: "...closest they get within X days is Y miles (with details)."
      // If the user chooses "5 days", that means date difference <= 4 days.
      const windowDaysForClosest = Number.isFinite(userDays) ? Math.max(1, Math.floor(userDays)) : 1;
      const maxDiffDaysForClosest = Math.max(0, windowDaysForClosest - 1);

      const best = findClosestPairWithinDays(s1, s2, maxDiffDaysForClosest, p1Label, p2Label);
      if (best) {
        closest = {
          ...best,
          // Helpful for copy on the results page:
          withinDays: windowDaysForClosest,
        };
      }
    }

    const spanDays = Number.isFinite(effectiveDays) ? Math.max(1, Math.floor(effectiveDays)) : 1;
    const maxDiffDays = Math.max(0, spanDays - 1);

    const debugOccurrenceDates = (occurrences || []).slice(0, 50).map((occ) => {
      const dates = uniqueSortedDates(occ);
      return {
        dates,
        distinct: dates.length,
        span: dates.length ? diffDaysAbs(dates[0], dates[dates.length - 1]) : 0,
      };
    });

    const payload = {
      count: occurrencesForUi.length,
      occurrences: occurrencesForUi,
      fallback, // ✅ added
      closest,  // ✅ added (when no occurrences)
      debug: {
        userDays,
        effectiveDays,
        days: spanDays,
        maxDiffDays,
        radiusMiles,
        origin,
        startDate,
        endDate,
        picks,
        resolutions: debugResolutions,
        note:
          "Popular nearby events are no longer fetched during /api/search. UI should call /api/nearby only when the user clicks the toggle button.",
        occurrenceDatesSample: debugOccurrenceDates,
      },
    };

    if (debugMode) payload.debug.env = { TICKETMASTER_API_KEY: keyDbg };

    return NextResponse.json(payload);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
