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
 * "Blob" of segment+genre+subGenre (your key fix).
 */
function classificationBlob(e) {
  const c0 = e?.classifications?.[0] || null;
  const parts = [c0?.segment?.name, c0?.genre?.name, c0?.subGenre?.name]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return norm(parts.join(" "));
}

function looksLikeCurling(e) {
  const n = String(e?.name || "").toLowerCase();
  return (
    n.includes("curling") ||
    n.includes("brier") ||
    n.includes("scotties") ||
    n.includes("grand slam of curling")
  );
}

function localDateTimeForSort(e) {
  return e?.dates?.start?.dateTime || e?.dates?.start?.localDate || "9999-12-31";
}

/**
 * Determine which selected parent pill this event matched.
 */
function matchedParentLabelForEvent(e, musicParentsNorm, sportsParentsNorm, musicParentsRaw, sportsParentsRaw) {
  const blob = classificationBlob(e);
  const seg = getSegment(e);

  if (seg === "music") {
    for (let i = 0; i < musicParentsNorm.length; i++) {
      const g = musicParentsNorm[i];
      if (g && blob.includes(g)) return musicParentsRaw[i] || null;
    }
    return null;
  }

  if (seg === "sports") {
    for (let i = 0; i < sportsParentsNorm.length; i++) {
      const g = sportsParentsNorm[i];
      if (g && blob.includes(g)) return sportsParentsRaw[i] || null;
    }
    return null;
  }

  return null;
}

/**
 * Fetch a single TM page, return raw events + page info.
 */
async function fetchPage(urlBase, page) {
  const url = new URL(urlBase.toString());
  url.searchParams.set("page", String(page));

  const r = await fetch(url.toString(), { cache: "no-store" });
  const json = await r.json().catch(() => ({}));

  if (!r.ok) {
    return { ok: false, error: "Ticketmaster error", status: r.status, detail: json, raw: [], page: null, size: null };
  }

  const raw = Array.isArray(json?._embedded?.events) ? json._embedded.events : [];
  const pageInfo = json?.page || null;
  const size = Number(url.searchParams.get("size") || 200);

  return { ok: true, raw, page: pageInfo, size };
}

/**
 * Your prior bulk fetch (kept for full events mode).
 */
async function fetchAllPages(urlBase, maxPages) {
  const all = [];
  let page = 0;

  while (page < maxPages && all.length < HARD_MATCH_EVENT_CAP) {
    const r = await fetchPage(urlBase, page);
    if (!r.ok) return { ok: false, error: r.error, status: r.status, detail: r.detail, events: [] };

    all.push(...r.raw);

    const totalPages = Number(r.page?.totalPages);
    const number = Number(r.page?.number);

    if (Number.isFinite(totalPages) && Number.isFinite(number)) {
      if (number >= totalPages - 1) break;
    }

    if (r.raw.length < (r.size || 200)) break;
    page += 1;
  }

  return { ok: true, events: all };
}

/**
 * NEW: exists-only scan that stops as soon as it finds 1 qualifying event after filtering/dedupe.
 * Returns { exists: boolean, debug }.
 */
async function existsScan(urlBase, maxPages, wantsCurling, filters) {
  const byKeyTM = new Map(); // key -> best raw TM variant
  const parentByKey = new Map(); // key -> parent label

  const {
    musicGenresRaw,
    sportsGenresRaw,
    musicParentsNorm,
    sportsParentsNorm,
    wantsAnyFilter,
  } = filters;

  // Curling: try keyword=curling first; if none, fall back to broad fetch.
  const tryCurlingFirst = wantsCurling === true;

  const scanWithUrl = async (scanUrlBase) => {
    let page = 0;
    let scanned = 0;

    while (page < maxPages && scanned < HARD_MATCH_EVENT_CAP) {
      const r = await fetchPage(scanUrlBase, page);
      if (!r.ok) return { ok: false, error: r.error, status: r.status, detail: r.detail };

      const raw = r.raw || [];
      scanned += raw.length;

      for (const e of raw) {
        if (!looksLikeCompetitionDayEvent(e)) continue;

        const key = gameKeyFromTMEvent(e);
        if (!key) continue;

        const segment = getSegment(e);

        if (wantsAnyFilter && segment === "other") continue;

        if (wantsAnyFilter) {
          if (musicGenresRaw.length === 0 && segment === "music") continue;
          if (sportsGenresRaw.length === 0 && segment === "sports") continue;
        }

        // Apply parent-genre matching (blob includes subgenres)
        let matchedParent = null;

        if (!wantsAnyFilter) {
          matchedParent = null;
        } else {
          matchedParent = matchedParentLabelForEvent(
            e,
            musicParentsNorm,
            sportsParentsNorm,
            musicGenresRaw,
            sportsGenresRaw
          );

          // Curling override
          if (!matchedParent && wantsCurling && getSegment(e) === "sports" && looksLikeCurling(e)) {
            matchedParent = "Curling";
          }

          if (!matchedParent) continue;
        }

        const existing = byKeyTM.get(key);
        if (!existing) {
          byKeyTM.set(key, e);
          parentByKey.set(key, matchedParent);
        } else {
          const better = chooseBetterTMVariant(existing, e);
          byKeyTM.set(key, better);
          if (!parentByKey.has(key)) parentByKey.set(key, matchedParent);
        }

        // ✅ We found at least one qualifying (deduped) match — stop immediately.
        return {
          ok: true,
          exists: true,
          debug: {
            scanned,
            page,
            dedupedKeys: byKeyTM.size,
          },
        };
      }

      const totalPages = Number(r.page?.totalPages);
      const number = Number(r.page?.number);
      if (Number.isFinite(totalPages) && Number.isFinite(number)) {
        if (number >= totalPages - 1) break;
      }

      if (raw.length < (r.size || 200)) break;
      page += 1;
    }

    return {
      ok: true,
      exists: false,
      debug: {
        scanned,
        pagesTried: page + 1,
        dedupedKeys: byKeyTM.size,
      },
    };
  };

  if (tryCurlingFirst) {
    const curlingUrl = new URL(urlBase.toString());
    curlingUrl.searchParams.set("keyword", "curling");

    const first = await scanWithUrl(curlingUrl);
    if (!first.ok) return first;
    if (first.exists) return first;

    // If keyword path had no qualifying results, fall back to broad
    return await scanWithUrl(urlBase);
  }

  return await scanWithUrl(urlBase);
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

    const existsOnly =
      searchParams.get("exists") === "1" ||
      searchParams.get("existsOnly") === "1" ||
      searchParams.get("onlyExists") === "1";

    // Treat incoming as DISPLAY strings; keep raw order
    let musicGenresRaw = getParamList(searchParams, "musicGenres");
    let sportsGenresRaw = getParamList(searchParams, "sportsGenres");

    // ✅ HARD CAP: max 4 total (music + sports combined)
    const MAX_TOTAL_GENRES = 4;
    let combined = [...musicGenresRaw, ...sportsGenresRaw];

    if (combined.length > MAX_TOTAL_GENRES) {
      combined = combined.slice(0, MAX_TOTAL_GENRES);
    }

    // Re-split after cap (preserve original ordering within combined)
    musicGenresRaw = combined.filter((g) => musicGenresRaw.includes(g));
    sportsGenresRaw = combined.filter((g) => sportsGenresRaw.includes(g));

    const musicParentsNorm = musicGenresRaw.map((s) => norm(s));
    const sportsParentsNorm = sportsGenresRaw.map((s) => norm(s));

    // Curling is keyword-driven: TM classification often won't say "Curling"
    const wantsCurling = sportsGenresRaw.some((g) => String(g).toLowerCase() === "curling");

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

    // If Curling selected, add keyword search to pull curling inventory reliably
    if (wantsCurling) {
      url.searchParams.set("keyword", 'curling brier scotties "grand slam of curling"');
    }

    const wantsAnyFilter = musicGenresRaw.length + sportsGenresRaw.length > 0;

    const filterBundle = {
      musicGenresRaw,
      sportsGenresRaw,
      musicParentsNorm,
      sportsParentsNorm,
      wantsAnyFilter,
    };

    // ✅ FAST PATH: exists-only scan
    if (existsOnly) {
      const r = await existsScan(url, MAX_PAGES, wantsCurling, filterBundle);

      if (!r.ok) {
        return NextResponse.json(
          { error: r.error || "Ticketmaster error", status: r.status, detail: r.detail },
          { status: 502 }
        );
      }

      return NextResponse.json({
        exists: !!r.exists,
        debug: {
          mode: "exists",
          exists: !!r.exists,
          ...r.debug,
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
    }

    // --- Full list mode (existing behavior) ---

    // Default: broad fetch (no keyword) to get the full local inventory.
    // Curling: try keyword=curling first; if none, fall back to broad fetch.
    let fetched = null;

    if (wantsCurling) {
      const curlingUrl = new URL(url.toString());
      curlingUrl.searchParams.set("keyword", "curling");

      const curlingFetched = await fetchAllPages(curlingUrl, MAX_PAGES);

      if (!curlingFetched.ok) {
        return NextResponse.json(
          { error: curlingFetched.error || "Ticketmaster error", status: curlingFetched.status, detail: curlingFetched.detail },
          { status: 502 }
        );
      }

      if ((curlingFetched.events || []).length > 0) {
        fetched = curlingFetched;
      }
    }

    if (!fetched) {
      fetched = await fetchAllPages(url, MAX_PAGES);

      if (!fetched.ok) {
        return NextResponse.json(
          { error: fetched.error || "Ticketmaster error", status: fetched.status, detail: fetched.detail },
          { status: 502 }
        );
      }
    }

    const rawAll = fetched.events || [];

    // key -> best raw TM event for that key
    const byKeyTM = new Map();
    // key -> matched parent pill label (string) for that key
    const parentByKey = new Map();

    for (const e of rawAll) {
      if (!looksLikeCompetitionDayEvent(e)) continue;

      const key = gameKeyFromTMEvent(e);
      if (!key) continue;

      const segment = getSegment(e);

      if (wantsAnyFilter && segment === "other") continue;

      if (wantsAnyFilter) {
        if (musicGenresRaw.length === 0 && segment === "music") continue;
        if (sportsGenresRaw.length === 0 && segment === "sports") continue;
      }

      let matchedParent = null;

      if (!wantsAnyFilter) {
        matchedParent = null;
      } else {
        matchedParent = matchedParentLabelForEvent(
          e,
          musicParentsNorm,
          sportsParentsNorm,
          musicGenresRaw,
          sportsGenresRaw
        );

        if (!matchedParent && wantsCurling && getSegment(e) === "sports" && looksLikeCurling(e)) {
          matchedParent = "Curling";
        }

        if (!matchedParent) continue;
      }

      const existing = byKeyTM.get(key);
      if (!existing) {
        byKeyTM.set(key, e);
        parentByKey.set(key, matchedParent);
      } else {
        const better = chooseBetterTMVariant(existing, e);
        byKeyTM.set(key, better);

        if (!parentByKey.has(key)) parentByKey.set(key, matchedParent);
      }
    }

    const events = Array.from(byKeyTM.entries())
      .sort(([, a], [, b]) => {
        const ad = localDateTimeForSort(a);
        const bd = localDateTimeForSort(b);
        return ad < bd ? -1 : ad > bd ? 1 : 0;
      })
      .map(([key, e]) => {
        const parentLabel = parentByKey.get(key) || null;

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
          genre: wantsAnyFilter ? parentLabel : null,
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
