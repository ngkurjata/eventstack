// app/api/search/route.js
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

/* ==================== Date range helpers (NEW) ==================== */

function isYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function filterEventsByDateRange(events, startDate, endDate) {
  const s = isYMD(startDate) ? startDate : null;
  const e = isYMD(endDate) ? endDate : null;
  if (!s && !e) return events;

  return (events || []).filter((ev) => {
    const d = ev?.dates?.start?.localDate;
    if (!isYMD(d)) return false; // if no date, exclude from filtered searches
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

// Optional: lookup name by attractionId (improves labels for artists)
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
      return {
        type: "team",
        league: parts[1],
        attractionId: parts[2],
        name: parts.slice(3).join(":"),
      };
    }
    if (parts.length >= 3) {
      return {
        type: "team",
        league: parts[1],
        attractionId: "",
        name: parts.slice(2).join(":"),
      };
    }
    return null;
  }

  // artist:ATTRACTIONID
  if (kind === "artist") {
    if (parts.length >= 2) return { type: "artist", attractionId: parts[1], name: "" };
    return null;
  }

  // genre:BUCKET:NAME
  if (kind === "genre") {
    return { type: "genre", bucket: parts[1], name: parts.slice(2).join(":") };
  }

  // fallback: raw keyword
  return { type: "raw", name: raw };
}

function isEntityPick(p) {
  return p && (p.type === "team" || p.type === "artist");
}

async function ensureAttractionId(apiKey, pick) {
  if (!pick || !isEntityPick(pick)) return pick;

  // Artists already have attractionId in your encoding
  if (pick.type === "artist") return pick;

  // Teams: if attractionId missing, resolve it via attractions search
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

// Keyword fallback for schedules if attractionId returns 0 events
async function fallbackEventsByKeyword(apiKey, pickType, keyword) {
  if (!keyword) return [];
  const params = new URLSearchParams();
  params.set("apikey", apiKey);
  params.set("size", "200");
  params.set("countryCode", "US,CA");
  params.set("sort", "date,asc");
  params.set("keyword", keyword);

  if (pickType === "team") params.set("segmentName", "Sports");
  if (pickType === "artist") params.set("segmentName", "Music");

  const events = await fetchEventsByParams(params);
  return (events || []).filter(hasTicketLink);
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

// IMPORTANT: pickKey needs to distinguish P1 vs P2 when user picks the same thing.
// We add a __slot marker ("p1"/"p2"/"p3") and include it here when present.
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

// IMPORTANT: dedupeKey must ALSO include slot when present,
// otherwise identical events from P1/P2 collapse and you can't form "overlaps" for P1=P2.
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

function uniqueSortedDates(events) {
  const s = new Set();
  for (const e of events) {
    const d = String(e?.dates?.start?.localDate || "").trim();
    if (d) s.add(d);
  }
  return Array.from(s).sort();
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
    if (picksSet.size < 2) continue;

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

function getAnchorLatLon(occ) {
  for (const e of occ) {
    const venue = e?._embedded?.venues?.[0];
    const lat = venue?.location?.latitude != null ? Number(venue.location.latitude) : null;
    const lon = venue?.location?.longitude != null ? Number(venue.location.longitude) : null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return null;
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

    // ✅ NEW: read optional date filters
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

    // ✅ NEW: allow single-pick searches by mirroring the non-empty one
    // - If p1 blank and p2 filled => treat p1=p2
    // - If p2 blank and p1 filled => treat p1=p2
    const rawP1 = (searchParams.get("p1") || "").trim();
    const rawP2 = (searchParams.get("p2") || "").trim();
    const rawP3 = (searchParams.get("p3") || "").trim();

    const effectiveRawP1 = rawP1 || rawP2;
    const effectiveRawP2 = rawP2 || rawP1;

    const p1 = parsePickOrRaw(effectiveRawP1);
    const p2 = parsePickOrRaw(effectiveRawP2);
    const p3 = rawP3 ? parsePickOrRaw(rawP3) : null;

    // Need at least two picks after mirroring
    if (!p1 || !p2) {
      return NextResponse.json({
        count: 0,
        occurrences: [],
        debug: { note: "Need at least 1 pick (p1 or p2)" },
      });
    }

    // Resolve attractionIds if needed
    await ensureAttractionId(apiKey, p1);
    await ensureAttractionId(apiKey, p2);
    if (p3) await ensureAttractionId(apiKey, p3);

    // Mark slots so P1/P2 can be distinguished when same pick
    p1.__slot = "p1";
    p2.__slot = "p2";
    if (p3) p3.__slot = "p3";

    const debugResolutions = [];
    const allEvents = [];

    const picks = [p1, p2, ...(p3 ? [p3] : [])];

    for (const pick of picks) {
      const params = new URLSearchParams();
      params.set("apikey", apiKey);
      params.set("size", "200");
      params.set("countryCode", countryCode);

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
      } else if (pick.type === "genre") {
        params.set("segmentName", "Music");
      } else {
        params.set("keyword", pick.name || "");
      }

      // Fetch Ticketmaster events
      let events = await fetchEventsByParams(params);

      // ✅ NEW: filter by date range BEFORE overlaps/occurrences
      events = filterEventsByDateRange(events, startDate, endDate);

      const filtered =
        pick.type === "genre"
          ? events.filter((e) => eventMatchesGenreBucket(e, pick.bucket))
          : events;

      allEvents.push(
        ...filtered
          .filter(hasTicketLink)
          .map((e) => ({
            ...e,
            __pick: pick,
          }))
      );
    }

    // Compute occurrences (overlaps)
    const occurrences = buildOccurrencesByRadiusAndDays(allEvents, radiusMiles, effectiveDays);

    // Fallback: show schedules when no overlap (still date-filtered)
    if (!occurrences || occurrences.length === 0) {
      // Only do fallback for team/artist pairs
      if (isEntityPick(p1) && isEntityPick(p2)) {
        const id1 = String(p1.attractionId || "").trim();
        const id2 = String(p2.attractionId || "").trim();

        async function getSchedule(pick) {
          // Primary: attractionId schedule via events endpoint paging is not implemented here;
          // so we use keyword fallback for schedule-like output.
          // (Keeps your previous behavior but date-filtered.)
          const kw =
            pick.type === "team"
              ? String(pick.name || "").trim()
              : (String(pick.attractionId || "").trim()
                  ? await fetchAttractionNameById(apiKey, String(pick.attractionId || "").trim())
                  : null) || "";

          let events = await fallbackEventsByKeyword(apiKey, pick.type, kw);

          // ✅ NEW: apply date range filter to schedule results too
          events = filterEventsByDateRange(events, startDate, endDate);

          return (events || [])
            .filter(hasTicketLink)
            .map((e) => ({ ...e, __pick: pick }));
        }

        const s1 = await getSchedule(p1);
        const s2 = await getSchedule(p2);

        const label1 =
          p1.type === "team"
            ? String(p1.name || "").trim() || "Pick 1"
            : (id1 ? (await fetchAttractionNameById(apiKey, id1)) : null) || "Pick 1";

        const label2 =
          p2.type === "team"
            ? String(p2.name || "").trim() || "Pick 2"
            : (id2 ? (await fetchAttractionNameById(apiKey, id2)) : null) || "Pick 2";

        return NextResponse.json({
          count: 0,
          occurrences: [],
          fallback: {
            mode: "NO_OVERLAP_SCHEDULES",
            schedules: [
              { label: label1, events: s1 },
              { label: label2, events: s2 },
            ],
          },
          debug: debugMode
            ? {
                note: "NO_OVERLAP_SCHEDULES fallback returned (merged schedules).",
                startDate,
                endDate,
                p1,
                p2,
                labels: { label1, label2 },
                counts: { s1: s1.length, s2: s2.length },
              }
            : undefined,
        });
      }
    }

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

    const spanDays = Number.isFinite(effectiveDays) ? Math.max(1, Math.floor(effectiveDays)) : 1;
    const maxDiffDays = Math.max(0, spanDays - 1);

    const debugOccurrenceDates = occurrences.slice(0, 50).map((occ) => {
      const dates = uniqueSortedDates(occ);
      return {
        dates,
        distinct: dates.length,
        span: dates.length ? diffDaysAbs(dates[0], dates[dates.length - 1]) : 0,
      };
    });

    const payload = {
      count: occurrences.length,
      occurrences: occurrencesForUi,
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

    if (debugMode) {
      payload.debug.env = { TICKETMASTER_API_KEY: keyDbg };
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
