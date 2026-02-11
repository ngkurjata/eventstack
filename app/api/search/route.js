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
  if (kind === "genre") {
    return { type: "genre", bucket: parts[1], name: parts.slice(2).join(":") };
  }

  // fallback: raw keyword
  return { type: "raw", name: raw };
}

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

function hasTicketLink(e) {
  const url = String(e?.url || "").trim();
  return Boolean(url);
}

function pickKey(p) {
  if (!p) return "";
  if (p.type === "team") return `team:${p.league}:${p.attractionId || p.name || ""}`;
  if (p.type === "artist") return `artist:${p.attractionId || p.name || ""}`;
  if (p.type === "genre") return `genre:${p.bucket || ""}:${p.name || ""}`;
  return `raw:${p.name || ""}`;
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

// Robust de-dupe key: prefer Ticketmaster id; otherwise fall back to a composite signature
function dedupeKeyForEvent(e) {
  const id = e?.id ? String(e.id).trim() : "";
  if (id) return `id:${id}`;

  const name = String(e?.name || "").trim().toLowerCase();
  const localDate = String(e?.dates?.start?.localDate || "").trim();
  const localTime = String(e?.dates?.start?.localTime || "").trim();

  const venue = e?._embedded?.venues?.[0];
  const venueId = String(venue?.id || "").trim();
  const venueName = String(venue?.name || "").trim().toLowerCase();
  const city = String(venue?.city?.name || "").trim().toLowerCase();

  const place = venueId ? `vid:${venueId}` : `v:${venueName}|c:${city}`;

  return `cmp:${name}|${localDate}|${localTime}|${place}`;
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

async function fetchEventsByParams(params) {
  const url = `${TM_EVENTS}?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  return data?._embedded?.events || [];
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

    // Start occurrence with anchor event
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

    // Require at least 2 distinct picks in the occurrence
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

  // ✅ sort: prioritize occurrences that satisfy MORE of the user's picks.
  occurrences.sort((A, B) => {
    const aCoverage = occurrencePickCoverageCount(A);
    const bCoverage = occurrencePickCoverageCount(B);
    if (aCoverage !== bCoverage) return bCoverage - aCoverage;

    // Secondary: bigger occurrences first
    if (A.length !== B.length) return B.length - A.length;

    // Tertiary: earlier occurrences first
    const aDate = occurrenceEarliestDate(A);
    const bDate = occurrenceEarliestDate(B);
    return aDate.localeCompare(bDate);
  });

  return occurrences;
}

function getAnchorLatLon(occ) {
  // Pick first event with coords as anchor
  for (const e of occ) {
    const venue = e?._embedded?.venues?.[0];
    const lat = venue?.location?.latitude != null ? Number(venue.location.latitude) : null;
    const lon = venue?.location?.longitude != null ? Number(venue.location.longitude) : null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return null;
}

export async function GET(req) {
  try {
    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 500 });

    const { searchParams } = new URL(req.url);

    const userDays = Number(searchParams.get("days") || 3);
    const effectiveDays = Math.max(1, Math.floor(userDays) - 1);

    const radiusMiles = Number(searchParams.get("radiusMiles") || 100);
    const origin = (searchParams.get("origin") || "").trim();

    // Dropdown 4 removed: only read p1/p2/p3
    const rawPickStrings = ["p1", "p2", "p3"].map((k) => searchParams.get(k)).filter(Boolean);
    const picks = rawPickStrings.map(parsePickOrRaw).filter(Boolean);

    if (picks.length < 2) {
      return NextResponse.json({
        count: 0,
        occurrences: [],
        debug: { note: "Need at least 2 picks" },
      });
    }

    // Resolve and fetch per pick
    const debugResolutions = [];
    const allEvents = [];

    for (const pick of picks) {
      const params = new URLSearchParams();
      params.set("apikey", apiKey);
      params.set("size", "200");
      params.set("countryCode", "US,CA");

      if (pick.type === "team") {
        if (!pick.attractionId && pick.name) {
          const best = await resolveBestAttraction(apiKey, "Sports", pick.name, "US,CA");
          if (best?.id) pick.attractionId = best.id;
          debugResolutions.push({ pick, resolved: best || null });
        }
        if (pick.attractionId) params.set("attractionId", pick.attractionId);
        else params.set("keyword", pick.name || "");
      } else if (pick.type === "artist") {
        if (pick.attractionId) params.set("attractionId", pick.attractionId);
      } else if (pick.type === "genre") {
        // keep broad; filter after fetch
        params.set("segmentName", "Music");
      } else {
        params.set("keyword", pick.name || "");
      }

      const events = await fetchEventsByParams(params);

      const filtered =
        pick.type === "genre" ? events.filter((e) => eventMatchesGenreBucket(e, pick.bucket)) : events;

      allEvents.push(
        ...filtered
          .filter(hasTicketLink)
          .map((e) => ({
            ...e,
            __pick: pick,
          }))
      );
    }

    const occurrences = buildOccurrencesByRadiusAndDays(allEvents, radiusMiles, effectiveDays);

    // ✅ IMPORTANT CHANGE:
    // NO popular-nearby fetching here anymore.
    // We only compute minimal meta so the UI can call /api/nearby ON DEMAND.
    const occurrencesForUi = occurrences.map((occ) => {
      const dates = uniqueSortedDates(occ);
      const startYMD = dates[0] || null;
      const endYMD = dates[dates.length - 1] || null;
      const anchor = getAnchorLatLon(occ);
      return {
        events: occ,
        popular: [], // <-- UI will fill this when the button is clicked
        meta: {
          anchor, // {lat, lon} or null
          startYMD,
          endYMD,
        },
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

    return NextResponse.json({
      count: occurrences.length,
      occurrences: occurrencesForUi,
      debug: {
        userDays,
        effectiveDays,
        days: spanDays,
        maxDiffDays,
        radiusMiles,
        origin,
        picks,
        resolutions: debugResolutions,
        note:
          "Popular nearby events are no longer fetched during /api/search. UI should call /api/nearby only when the user clicks the toggle button.",
        occurrenceDatesSample: debugOccurrenceDates,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
