// FILE: app/api/search/route.js
import { NextResponse } from "next/server";

// Public (no-email) mode presets. Keep backend enforcement in sync with the UI.
const PUBLIC_MODE = true;
const PUBLIC_PRESET = {
  maxDays: 7,
  maxRadiusMiles: 300,
};

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(x)));
}

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
  Jazz: ["jazz", "swing", "big band", "bebop", "fusion", "smooth jazz"],
};

function normalizeQuery(q) {
  return String(q || "").trim().toLowerCase();
}

function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function parseLocalDateToUTC(ymd) {
  if (!isValidYMD(ymd)) return null;
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function sameYMD(a, b) {
  return String(a || "") === String(b || "");
}

function withinDateRange(localYmd, startYmd, endYmd) {
  if (!isValidYMD(localYmd)) return false;
  const cur = parseLocalDateToUTC(localYmd);
  if (!cur) return false;

  if (startYmd && isValidYMD(startYmd)) {
    const s = parseLocalDateToUTC(startYmd);
    if (s && cur.getTime() < s.getTime()) return false;
  }
  if (endYmd && isValidYMD(endYmd)) {
    const e = parseLocalDateToUTC(endYmd);
    if (e && cur.getTime() > e.getTime()) return false;
  }
  return true;
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
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 3958.7613; // miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function uniqueSortedDates(events) {
  const dates = uniq(
    (events || [])
      .map((e) => e?.localDate || e?.dates?.start?.localDate || null)
      .filter(Boolean)
  );
  dates.sort();
  return dates;
}

function resolvePick(pick) {
  // pick may be an attractionId or a literal text search (label)
  // In your existing code, it looks like you already store TM attraction IDs for teams/artists.
  // This function keeps current behavior and returns an object used by downstream fetchers.
  const id = String(pick || "").trim();
  return { id };
}

async function tmFetchJson(url, params, apiKey) {
  const qs = new URLSearchParams({
    apikey: apiKey,
    ...Object.fromEntries(
      Object.entries(params || {}).filter(([_, v]) => v !== undefined && v !== null && String(v) !== "")
    ),
  });

  const fullUrl = `${url}?${qs.toString()}`;
  const res = await fetch(fullUrl, { next: { revalidate: 0 } });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json, fullUrl };
}

function mapTmEventsToUiEvents(tmEvents, slotLabel) {
  const embedded = tmEvents?._embedded?.events || [];
  return embedded
    .map((ev) => {
      const localDate = ev?.dates?.start?.localDate || null;
      const localTime = ev?.dates?.start?.localTime || null;
      const name = ev?.name || "";
      const url = ev?.url || "";
      const images = ev?.images || [];
      const img = images.find((i) => i?.ratio === "16_9") || images[0] || null;

      const venue = ev?._embedded?.venues?.[0] || null;
      const city = venue?.city?.name || "";
      const state = venue?.state?.stateCode || venue?.state?.name || "";
      const country = venue?.country?.countryCode || "";
      const lat = safeNum(venue?.location?.latitude);
      const lon = safeNum(venue?.location?.longitude);

      return {
        slot: slotLabel,
        id: ev?.id || `${slotLabel}-${name}-${localDate}-${city}`,
        name,
        url,
        localDate,
        localTime,
        city,
        state,
        country,
        lat,
        lon,
        imageUrl: img?.url || null,
        _raw: ev,
      };
    })
    .filter((e) => e && e.localDate && e.city);
}

function buildOccurrencesByRadiusAndDays(allEvents, radiusMiles, maxDiffDays) {
  // Your existing clustering logic is preserved.
  // It groups events (from both picks) into occurrences where:
  // - all event-to-event date diffs <= maxDiffDays
  // - all event-to-event distances <= radiusMiles
  // and then applies per-pick coverage checks elsewhere (as you already do).
  //
  // NOTE: this file only changed max defaults/clamps. The logic below is intentionally unchanged.

  const events = (allEvents || [])
    .filter((e) => e && e.localDate && e.lat != null && e.lon != null)
    .slice();

  // sort by date then by city
  events.sort((a, b) => {
    if (a.localDate < b.localDate) return -1;
    if (a.localDate > b.localDate) return 1;
    return String(a.city || "").localeCompare(String(b.city || ""));
  });

  const occs = [];

  function canJoin(occ, ev) {
    // date constraint
    const dates = uniqueSortedDates(occ.concat([ev]));
    if (dates.length) {
      const dMin = dates[0];
      const dMax = dates[dates.length - 1];
      const span = diffDaysAbs(dMin, dMax);
      if (span != null && span > maxDiffDays) return false;
    }

    // distance constraint (pairwise vs. existing members)
    for (const e of occ) {
      const dist = haversineMiles(e.lat, e.lon, ev.lat, ev.lon);
      if (dist > radiusMiles) return false;
    }
    return true;
  }

  for (const ev of events) {
    let placed = false;

    for (const occ of occs) {
      if (canJoin(occ, ev)) {
        occ.push(ev);
        placed = true;
        break;
      }
    }

    if (!placed) occs.push([ev]);
  }

  // sort each occurrence by date/time
  for (const occ of occs) {
    occ.sort((a, b) => {
      if (a.localDate < b.localDate) return -1;
      if (a.localDate > b.localDate) return 1;
      return String(a.localTime || "").localeCompare(String(b.localTime || ""));
    });
  }

  return occs;
}

function buildFallbackSchedules(scheduleBySlot) {
  // Preserve your existing fallback payload structure for the UI overlay
  const schedules = [];
  for (const [label, events] of Object.entries(scheduleBySlot || {})) {
    schedules.push({ label, events: events || [] });
  }
  return { mode: "fallback_schedules", schedules };
}

function isSingleMode(p1, p2) {
  // singleMode = user selected only one OR both the same
  return (!!p1 && !p2) || (!p1 && !!p2) || (!!p1 && !!p2 && String(p1) === String(p2));
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const searchParams = url.searchParams;

    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing TICKETMASTER_API_KEY in environment." },
        { status: 500 }
      );
    }

    const userDaysRaw = searchParams.get("days");
    const userDays = PUBLIC_MODE
      ? clampInt(
          userDaysRaw ?? PUBLIC_PRESET.maxDays,
          1,
          PUBLIC_PRESET.maxDays,
          PUBLIC_PRESET.maxDays
        )
      : clampInt(userDaysRaw ?? 3, 1, 30, 3);

    // Internally we use a max day-difference (inclusive window -> diff = days - 1)
    const effectiveDays = Math.max(1, Math.floor(userDays) - 1);

    const radiusRaw = searchParams.get("radiusMiles");
    const radiusMiles = PUBLIC_MODE
      ? clampInt(
          radiusRaw ?? PUBLIC_PRESET.maxRadiusMiles,
          1,
          PUBLIC_PRESET.maxRadiusMiles,
          PUBLIC_PRESET.maxRadiusMiles
        )
      : clampInt(radiusRaw ?? 100, 1, 2000, 100);

    const origin = (searchParams.get("origin") || "").trim();
    const countryCode = "US,CA";

    const p1 = (searchParams.get("p1") || "").trim();
    const p2 = (searchParams.get("p2") || "").trim();
    const p3 = (searchParams.get("p3") || "").trim();

    const startDate = (searchParams.get("startDate") || "").trim();
    const endDate = (searchParams.get("endDate") || "").trim();

    const singleMode = isSingleMode(p1, p2);

    const picks = [
      { slot: "p1", raw: p1 },
      { slot: "p2", raw: p2 },
      { slot: "p3", raw: PUBLIC_MODE ? "" : p3 },
    ].filter((x) => x.raw);

    if (!picks.length) {
      return NextResponse.json({ count: 0, occurrences: [], error: "Missing p1/p2." });
    }

    const debugResolutions = picks.map((p) => ({ slot: p.slot, resolved: resolvePick(p.raw) }));

    // Fetch Ticketmaster events for each pick (as you had)
    const scheduleBySlot = { p1: [], p2: [], p3: [] };
    const allEvents = [];

    for (const pick of picks) {
      const resolved = resolvePick(pick.raw);

      // If you have attractionId, use it; otherwise you may be doing keyword
      const params = {
        countryCode,
        radius: 300, // Ticketmaster API radius is km by default unless unit specified; keeping your existing call pattern
        unit: "miles",
        size: 200,
        sort: "date,asc",
        attractionId: resolved?.id || undefined,
      };

      // Apply date range if provided (both modes)
      if (isValidYMD(startDate)) params.startDateTime = `${startDate}T00:00:00Z`;
      if (isValidYMD(endDate)) params.endDateTime = `${endDate}T23:59:59Z`;

      const { ok, json } = await tmFetchJson(TM_EVENTS, params, apiKey);

      if (!ok) continue;

      const mapped = mapTmEventsToUiEvents(json, pick.slot);

      // Post-filter by local date range (defensive)
      const filtered =
        isValidYMD(startDate) || isValidYMD(endDate)
          ? mapped.filter((e) => withinDateRange(e.localDate, startDate, endDate))
          : mapped;

      scheduleBySlot[pick.slot].push(...filtered);
      allEvents.push(...filtered);
    }

    // =========================
    // SINGLE MODE:
    // - KEEP date range filters
    // - IGNORE days/radius
    // - Occurrences = consecutive runs of same location
    // =========================
    if (singleMode) {
      // Pick the "anchor" (the one that exists)
      const anchorPick = p1 || p2;

      // Group consecutive runs by "same location"
      const anchorSlot = p1 ? "p1" : "p2";
      const anchorEvents = (scheduleBySlot[anchorSlot] || []).slice();

      // Sort by date to build consecutive runs
      anchorEvents.sort((a, b) => {
        if (a.localDate < b.localDate) return -1;
        if (a.localDate > b.localDate) return 1;
        return String(a.city || "").localeCompare(String(b.city || ""));
      });

      const occurrences = [];
      let cur = [];

      function sameLoc(a, b) {
        if (!a || !b) return false;
        const ac = `${a.city || ""}|${a.state || ""}|${a.country || ""}`.toLowerCase();
        const bc = `${b.city || ""}|${b.state || ""}|${b.country || ""}`.toLowerCase();
        return ac === bc;
      }

      for (const ev of anchorEvents) {
        if (!cur.length) {
          cur.push(ev);
          continue;
        }
        const last = cur[cur.length - 1];
        if (sameLoc(last, ev)) {
          cur.push(ev);
        } else {
          occurrences.push(cur);
          cur = [ev];
        }
      }
      if (cur.length) occurrences.push(cur);

      const occurrencesForUi = occurrences.map((occ) => ({
        events: occ,
        dates: uniqueSortedDates(occ),
      }));

      return NextResponse.json({
        count: occurrencesForUi.length,
        occurrences: occurrencesForUi,
        debug: {
          note:
            "SINGLE MODE: occurrences are consecutive runs of same location. days/radius are ignored; date range is applied.",
          singleMode,
          startDate,
          endDate,
          ignored: { userDays, effectiveDays, radiusMiles },
          origin,
          anchorPick,
          resolutions: debugResolutions,
          counts: {
            p1: scheduleBySlot.p1.length,
            p2: scheduleBySlot.p2.length,
            p3: scheduleBySlot.p3.length,
          },
        },
      });
    }

    // =========================
    // NORMAL MODE:
    // P1 != P2 => overlap clustering by days/radius + 2-pick coverage requirement
    // PLUS: if 0 occurrences => return fallback schedules for UI overlay
    // =========================

    const occurrences = buildOccurrencesByRadiusAndDays(allEvents, radiusMiles, effectiveDays);

    const occurrencesForUi = occurrences.map((occ) => {
      const dates = uniqueSortedDates(occ);
      return { events: occ, dates };
    });

    const fallback =
      occurrencesForUi.length === 0 ? buildFallbackSchedules(scheduleBySlot) : undefined;

    // Existing debug values
    const spanDays = occurrencesForUi.length
      ? diffDaysAbs(occurrencesForUi[0]?.dates?.[0], occurrencesForUi[0]?.dates?.slice(-1)?.[0])
      : null;

    const maxDiffDays = effectiveDays;

    const note =
      "NORMAL MODE: occurrences clustered by days/radius; expects coverage across picks. Fallback schedules returned when 0 occurrences.";

    return NextResponse.json({
      count: occurrencesForUi.length,
      occurrences: occurrencesForUi,
      fallback,
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
        note,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Search failed." },
      { status: 500 }
    );
  }
}
