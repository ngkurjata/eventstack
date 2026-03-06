// FILE: app/api/events/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/**
 * /api/events
 *
 * Inputs:
 * - lat, lon (required)
 * - start, end (YYYY-MM-DD) (required)
 * - radiusMiles, countryCode
 * - favorites[] (team/artist ids; should include attractionId, ex: team:NHL:K8vZ...:Edmonton Oilers)
 * - musicGenres[] (classificationName)
 * - sportsGenres[] (classificationName)
 * - artsGenres[] (classificationName)
 *
 * Output:
 * - events[] filtered to:
 *    (matches favorites OR matches selected genres) OR premium
 * - pillLabel:
 *    - matching genre (preferred)
 *    - else inferred TM genre (e.g. Hockey)
 *    - else Premium
 *
 * Key fix:
 * - Hard dedupe of “sub-events / upsells” so you don’t get:
 *   - Access Pass + main game
 *   - Club Level Seating + main concert
 *   - GARAGE / RESERVE / RENTAL wrappers + main game
 *
 * NEW:
 * - Rolling premium de-noise: for the SAME premium title, show at most 1 every N days (default 3)
 * - Premium upsell suppression:
 *    - Filter obvious add-ons (passes/parking/packages/etc) for Premium-only
 *    - Suppress remaining Premium add-ons near a real headliner at same venue/day
 */

function json(payload, status = 200) {
  return NextResponse.json(payload, { status });
}

/* -------------------- Basic utils -------------------- */

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

function plusToSpace(s) {
  return String(s || "").replace(/\+/g, " ");
}

// Handles accidental double-encoding (e.g. %2520). URLSearchParams decodes once,
// leaving %20 in the string. This decodes a couple passes until stable.
function deepDecodeParam(raw, maxPasses = 2) {
  let s = plusToSpace(String(raw || ""));

  for (let i = 0; i < maxPasses; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) break;
    try {
      const decoded = decodeURIComponent(s);
      if (decoded === s) break;
      s = decoded;
    } catch {
      break;
    }
  }

  return s.trim();
}

function normalizeCountryCodes(raw) {
  const s = String(raw || "").trim();
  if (!s) return ["US", "CA"];
  const parts = s
    .split(/[,\s]+/g)
    .map((x) => String(x || "").trim().toUpperCase())
    .filter(Boolean)
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return parts.length ? Array.from(new Set(parts)) : ["US", "CA"];
}

function normStr(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* -------------------- Ticketmaster fetch -------------------- */

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_EVENTS = `${TM_BASE}/events.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

async function tmFetchEvents(params) {
  if (!TM_KEY) return { ok: false, status: 500, events: [], error: "Missing TICKETMASTER_API_KEY" };

  params.set("apikey", TM_KEY);
  const url = `${TM_EVENTS}?${params.toString()}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const raw = await res.json().catch(() => ({}));
    const events =
      (Array.isArray(raw?._embedded?.events) && raw._embedded.events) ||
      (Array.isArray(raw?.events) && raw.events) ||
      [];

    return { ok: res.ok, status: res.status, events, error: res.ok ? null : `TM error (${res.status})`, raw };
  } catch (e) {
    return { ok: false, status: null, events: [], error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function segmentNameForDomain(domain) {
  const d = String(domain || "").toLowerCase();
  if (d === "music") return "Music";
  if (d === "sports") return "Sports";
  if (d === "arts") return "Arts & Theatre";
  return null;
}

function buildBaseParams({ lat, lon, start, end, radiusMiles, countryCode, sort = "date,asc", size = 80, page = 0 }) {
  const p = new URLSearchParams();
  p.set("sort", sort);
  p.set("latlong", `${lat},${lon}`);
  p.set("radius", String(radiusMiles));
  p.set("unit", "miles");
  p.set("startDateTime", `${start}T00:00:00Z`);
  p.set("endDateTime", `${end}T23:59:59Z`);
  p.set("size", String(size));
  p.set("page", String(page));
  if (countryCode) p.set("countryCode", countryCode);
  return p;
}

async function tmFetchPaged(baseParamsBuilder, { maxPages = 2 }) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const p = baseParamsBuilder(page);
    const r = await tmFetchEvents(p);
    if (!r.ok) return { ok: false, status: r.status, events: out, error: r.error };
    const evs = Array.isArray(r.events) ? r.events : [];
    out.push(...evs);

    // If TM returned fewer than requested, likely no more pages.
    const size = Number(p.get("size") || "0");
    if (Number.isFinite(size) && size > 0 && evs.length < size) break;
  }
  return { ok: true, status: 200, events: out, error: null };
}

/* -------------------- Favorite parsing -------------------- */

function parseFavoriteIdString(id) {
  const sRaw = String(id || "").trim();
  if (!sRaw) return null;

  const s = deepDecodeParam(sRaw);
  if (!s) return null;

  const parts = s
    .split(":")
    .map((x) => deepDecodeParam(x).trim())
    .filter(Boolean);

  const kindRaw0 = (parts[0] || "").toLowerCase();

  // tolerate duplicated kind: artist:artist:...
  let parts2 = parts;
  if (
    parts.length >= 2 &&
    (parts[1] || "").toLowerCase() === kindRaw0 &&
    (kindRaw0 === "artist" || kindRaw0 === "team")
  ) {
    parts2 = [parts[0], ...parts.slice(2)];
  }

  const kindRaw = (parts2[0] || "").toLowerCase();

  let kind = "unknown";
  if (kindRaw === "team") kind = "team";
  else if (kindRaw === "artist") kind = "artist";

  const attractionId =
    parts2.find((p) => /^K8vZ/i.test(p)) ||
    parts2.find((p) => /^K[0-9A-Za-z]+$/.test(p)) ||
    null;

  const label = deepDecodeParam(parts2[parts2.length - 1] || s);

  return { id: s, kind, label, attractionId };
}

function readFavorites(searchParams) {
  const favIds = searchParams
    .getAll("favorites")
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  const favs = favIds.map(parseFavoriteIdString).filter(Boolean);

  const attractionIds = favs
    .map((f) => String(f.attractionId || "").trim())
    .filter(Boolean);

  return { favs, attractionIds };
}

/* -------------------- TM event extraction -------------------- */

function tmEventId(e) {
  return String(e?.id || "").trim() || null;
}
function tmEventName(e) {
  return String(e?.name || "").trim();
}
function tmEventUrl(e) {
  return e?.url ? String(e.url) : null;
}
function tmLocalDate(e) {
  return e?.dates?.start?.localDate ?? null;
}
function tmLocalTime(e) {
  return e?.dates?.start?.localTime ?? null;
}
function tmVenue(e) {
  return e?._embedded?.venues?.[0] || null;
}
function tmVenueName(e) {
  return tmVenue(e)?.name ?? null;
}
function tmCity(e) {
  return tmVenue(e)?.city?.name ?? "";
}
function tmRegion(e) {
  return tmVenue(e)?.state?.stateCode ?? tmVenue(e)?.country?.countryCode ?? "";
}

function tmAttractionIdsForEvent(e) {
  const attrs = e?._embedded?.attractions;
  if (!Array.isArray(attrs)) return [];
  return attrs.map((a) => String(a?.id || "").trim()).filter(Boolean);
}

function tmClassificationNamesForEvent(e) {
  const cls = Array.isArray(e?.classifications) ? e.classifications[0] : null;
  const segment = cls?.segment?.name ? String(cls.segment.name) : null;
  const genre = cls?.genre?.name ? String(cls.genre.name) : null;
  const subGenre = cls?.subGenre?.name ? String(cls.subGenre.name) : null;
  return { segment, genre, subGenre };
}

/* -------------------- Noise + matching -------------------- */

function normalizeName(s) {
  return String(s || "").trim().toLowerCase();
}

function looksLikeNoise(name) {
  const n = normalizeName(name);
  if (!n) return true;

  // hard filters
  const badPhrases = [
    "parking",
    "parkwhiz",
    "lot ",
    "vip",
    "meet & greet",
    "meet and greet",
    "upgrade",
    "add-on",
    "add on",
    "package",
    "merch",
    "preparty",
    "pre-party",
    "afterparty",
    "after-party",
    "lounge",
    "suite",
    "club access",
    "hospitality",
    "tailgate",
    "deposit",
    "ticket deposit",
    "season deposit",
    "membership",
    "voucher",
    "gift card",
    "gift cards",
    "group sales",
    "group tickets",
    "renewal",
    "invoice",
    "payment plan",
    "initial payment",
    "late fee",
    "service fee",
    "convenience fee",
    "access pass",
    "pinstripe pass",
    "premium seating",
    "club level seating",
    "garage",
    "reserve",
    "rental:",
    "rental ",
  ];

  return badPhrases.some((x) => n.includes(x));
}

// Premium-only “upsell” detector (applied ONLY to Premium events later)
function looksLikePremiumUpsell(name) {
  const n = normalizeName(name);
  if (!n) return true;

  // Strong, recurring patterns for TM add-ons around games/shows
  const hard = [
    "parking",
    "parkwhiz",
    "designated driver",
    "access pass",
    "ballpark pass",
    "parade pass",
    "pinstripe pass",
    "party pass",
    "cocktail party",
    "opening day cocktail",
    "food and bev",
    "food & bev",
    "food n bev",
    "fan deck",
    "warning track",
    "hospitality",
    "tailgate",
    "pre party",
    "pre-party",
    "after party",
    "after-party",
    "vip package",
    "vip",
    "package",
    "upgrade",
    "add on",
    "add-on",
    "club access",
    "suite",
    "lounge",
    "premium seating",
    "club level seating",
  ];

  for (const x of hard) {
    if (n.includes(x)) return true;
  }

  // Softer: “pass” / “package” alone can be legitimate, so guard with context words
  if (/\bpass(es)?\b/.test(n) && /(deck|ballpark|parade|access|party|fan|food|bev|beverage|hospitality|club|suite)/.test(n)) {
    return true;
  }

  if (/\bpackage(s)?\b/.test(n) && /(vip|hospitality|club|suite|party|food|bev|beverage|deck)/.test(n)) {
    return true;
  }

  return false;
}

function matchesSelectedGenres(e, selectedGenreSet) {
  const { segment, genre, subGenre } = tmClassificationNamesForEvent(e);

  const cands = [segment, genre, subGenre]
    .filter(Boolean)
    .map((x) => normalizeName(x));

  // Exact match first
  for (const c of cands) {
    if (selectedGenreSet.has(c)) return true;
  }

  // Containment match ("Pop / Rock" vs "Rock")
  for (const c of cands) {
    for (const g of selectedGenreSet) {
      if (!g) continue;
      if (c.includes(g) || g.includes(c)) return true;
    }
  }

  return false;
}

function pickGenrePill(e) {
  const { genre, subGenre, segment } = tmClassificationNamesForEvent(e);
  return genre || subGenre || segment || "";
}

/* -------------------- Dedupe helpers -------------------- */

// Remove wrappers / upsells so they collapse onto the “real” event
function canonicalizeTitleForDedupe(name) {
  let s = String(name || "").trim();

  // Strip obvious upsell prefixes
  s = s.replace(/^(premium seating|club level seating|access pass)\s*:\s*/i, "");
  s = s.replace(/^(premium seating|club level seating|access pass)\s+/i, "");

  // Strip garage/reserve wrappers (esp. NHL)
  s = s.replace(/^(comerica garage|lexus garage|lexus reserve|garage|reserve)\s*:\s*/i, "");

  // Strip rental wrappers
  s = s.replace(/^rental\s*:\s*/i, "");

  // normalize "v." -> "vs"
  s = s.replace(/\bv\.\b/gi, "vs");

  // clean decorations
  s = s.replace(/\*[^*]*\*/g, " ");
  s = s.replace(/[*•|]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

function timeBucketHHMM(localTime, bucketMinutes = 30) {
  const t = String(localTime || "").trim();
  if (!t) return "no-time";
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "no-time";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "no-time";
  const total = hh * 60 + mm;
  const b = Math.floor(total / bucketMinutes) * bucketMinutes;
  const bh = String(Math.floor(b / 60)).padStart(2, "0");
  const bm = String(b % 60).padStart(2, "0");
  return `${bh}:${bm}`;
}

function parseLocalTimeToMinutes(localTime) {
  const t = String(localTime || "").trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function locationSigFromRow(row) {
  const v = normStr(row?.venueName);
  if (v) return `v:${v}`;
  const c = normStr(row?.city);
  const r = normStr(row?.region);
  if (c || r) return `cr:${c}|${r}`;
  return "loc:unknown";
}

// Strict-ish signature: title + date + time bucket + venue/city
function eventSignatureStrict(row) {
  const title = normStr(canonicalizeTitleForDedupe(row?.name));
  const date = String(row?.localDate || "").slice(0, 10) || "no-date";
  const tb = timeBucketHHMM(row?.localTime, 30);
  const loc = locationSigFromRow(row);
  return `${title}__${date}__${tb}__${loc}`;
}

// Prefer non-premium, and prefer “real” titles (vs / tour), and prefer those with url
function dedupeWinnerScore(row) {
  let s = 0;
  const pill = String(row?.pillLabel || "");
  if (pill !== "Premium") s += 20; // keep anchor-matched over premium when colliding
  if (row?.url) s += 8;
  if (row?.venueName) s += 2;
  if (row?.localTime) s += 1;

  const n = normStr(row?.name);
  if (/\bvs\b/.test(n)) s += 10;
  if (/\btour\b/.test(n)) s += 6;
  if (/\bpresents\b/.test(n)) s += 4;

  // punish wrappers if any remain
  if (/\b(access pass|premium seating|club level seating|garage|reserve|rental)\b/.test(n)) s -= 12;

  // mild preference for richer text
  s += Math.min(Math.max(n.length, 0) / 40, 3);

  return s;
}

function mergeRowMeta(base, incoming) {
  const out = { ...base };

  for (const k of ["url", "venueName", "city", "region", "localTime"]) {
    if (!out[k] && incoming[k]) out[k] = incoming[k];
  }

  // Merge matchedFavorites without dupes
  const a = Array.isArray(out.matchedFavorites) ? out.matchedFavorites : [];
  const b = Array.isArray(incoming.matchedFavorites) ? incoming.matchedFavorites : [];
  out.matchedFavorites = Array.from(new Set([...a, ...b])).filter(Boolean);

  // Prefer a non-Premium pill if present
  if (String(out.pillLabel || "") === "Premium" && String(incoming.pillLabel || "") !== "Premium") {
    out.pillLabel = incoming.pillLabel;
  }

  // Prefer more canonical display name (non-wrapper)
  const baseCanon = canonicalizeTitleForDedupe(out.name);
  const incCanon = canonicalizeTitleForDedupe(incoming.name);
  if (baseCanon !== out.name && incCanon === incoming.name) out.name = incoming.name;

  // Preserve internal markers if present
  if (out._isPremium !== true && incoming._isPremium === true) out._isPremium = true;
  if (!out._rawName && incoming._rawName) out._rawName = incoming._rawName;

  return out;
}

function dedupeRowsStrict(rows) {
  const map = new Map(); // sig -> row

  for (const r of rows || []) {
    if (!r) continue;
    const sig = eventSignatureStrict(r);
    const cur = map.get(sig);
    if (!cur) {
      map.set(sig, r);
      continue;
    }

    const keepCur = dedupeWinnerScore(cur) >= dedupeWinnerScore(r);
    const winner = keepCur ? mergeRowMeta(cur, r) : mergeRowMeta(r, cur);
    map.set(sig, winner);
  }

  return Array.from(map.values());
}

// If multiple rows still share same title+date+venue (e.g. “Access Pass” removed title but time differs),
// keep the later (more “main” showtime) but keep caps small.
function collapseSameDaySameVenueKeepEvening(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const key = [
      normStr(canonicalizeTitleForDedupe(r.name)),
      String(r.localDate || "").slice(0, 10),
      normStr(r.venueName),
      normStr(r.city),
    ].join("|");

    const existing = map.get(key);
    if (!existing) {
      map.set(key, r);
      continue;
    }

    const tA = String(existing.localTime || "00:00:00");
    const tB = String(r.localTime || "00:00:00");
    if (tB > tA) map.set(key, r);
    else map.set(key, mergeRowMeta(existing, r));
  }
  return Array.from(map.values());
}

/* -------------------- Premium upsell suppression -------------------- */

function isHeadlinerRow(row) {
  // A “headliner” is anything not Premium, or anything whose title looks like a real show/game.
  if (String(row?.pillLabel || "") !== "Premium") return true;

  const n = normStr(row?._rawName || row?.name);
  if (!n) return false;

  // Sports games
  if (/\bvs\b/.test(n)) return true;

  // Common show indicators
  if (/\b(tour|live|in concert|presented by|presents)\b/.test(n)) return true;

  // If it's Premium but not obviously an upsell, treat as potential headliner
  if (!looksLikePremiumUpsell(row?._rawName || row?.name)) return true;

  return false;
}

function suppressPremiumUpsellsNearHeadliner(rows, { hoursWindow = 6 } = {}) {
  const byKey = new Map(); // venue/day -> rows
  for (const r of rows || []) {
    const day = String(r?.localDate || "").slice(0, 10);
    const loc = locationSigFromRow(r);
    const key = `${day}__${loc}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }

  const out = [];
  let dropped = 0;

  for (const group of byKey.values()) {
    const headliners = group.filter(isHeadlinerRow);
    const headTimes = headliners
      .map((h) => parseLocalTimeToMinutes(h.localTime))
      .filter((x) => Number.isFinite(x));

    const hasAnyHeadliner = headliners.length > 0;

    for (const r of group) {
      const isPremium = String(r?.pillLabel || "") === "Premium";
      if (!isPremium) {
        out.push(r);
        continue;
      }

      const rawName = r?._rawName || r?.name;
      const isUpsell = looksLikePremiumUpsell(rawName);

      // If it's Premium and clearly upsell, we can drop immediately
      if (isUpsell) {
        dropped += 1;
        continue;
      }

      // If there is a headliner at same venue/day, suppress premium “nearby” items
      // that look like add-ons after canonicalization or are time-adjacent.
      if (hasAnyHeadliner && headTimes.length) {
        const t = parseLocalTimeToMinutes(r.localTime);
        if (Number.isFinite(t)) {
          const close = headTimes.some((ht) => Math.abs(ht - t) <= hoursWindow * 60);
          if (close) {
            // only suppress if it has some add-on scent even if not caught above
            const n = normStr(rawName);
            if (/(pass|package|upgrade|vip|deck|food|bev|beverage|hospitality|parking|tailgate|club|suite|lounge)/.test(n)) {
              dropped += 1;
              continue;
            }
          }
        }
      }

      out.push(r);
    }
  }

  return { rows: out, dropped };
}

/* -------------------- Rolling premium rate-limit helpers -------------------- */

function absDaysBetweenYMD(aYMD, bYMD) {
  const a = new Date(`${String(aYMD).slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${String(bYMD).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Infinity;
  return Math.abs(Math.round((b.getTime() - a.getTime()) / 86400000));
}

// Group obvious title variants so "Hamilton", "Hamilton (Tour)" etc. throttle together
function canonicalizePremiumTitle(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Keep all non-premium. For Premium, keep at most 1 per titleKey every minGapDays.
function rateLimitPremiumEveryNDays(events, { minGapDays = 3 } = {}) {
  const lastShownByTitle = new Map(); // titleKey -> lastDateYMD
  const out = [];

  for (const e of events || []) {
    if (!e) continue;

    const isPremium = String(e.pillLabel || "") === "Premium";
    if (!isPremium) {
      out.push(e);
      continue;
    }

    const titleKey = canonicalizePremiumTitle(e.name);
    const d = String(e.localDate || "").slice(0, 10);

    if (!titleKey || !d) {
      out.push(e);
      continue;
    }

    const prev = lastShownByTitle.get(titleKey);
    if (!prev) {
      lastShownByTitle.set(titleKey, d);
      out.push(e);
      continue;
    }

    if (absDaysBetweenYMD(prev, d) >= minGapDays) {
      lastShownByTitle.set(titleKey, d);
      out.push(e);
    }
  }

  return out;
}

/* -------------------- Handler -------------------- */

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const lat = Number(searchParams.get("lat"));
    const lon = Number(searchParams.get("lon"));
    const start = String(searchParams.get("start") || "").trim();
    const end = String(searchParams.get("end") || "").trim();

    const radiusMiles = clampInt(searchParams.get("radiusMiles"), 1, 500, 120);
    const countryCodes = normalizeCountryCodes(searchParams.get("countryCode") || "US,CA");

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json({ error: "Missing/invalid lat/lon" }, 400);
    }
    if (!isYMD(start) || !isYMD(end)) {
      return json({ error: "Missing/invalid start/end (YYYY-MM-DD)" }, 400);
    }
    if (!TM_KEY) return json({ error: "Missing TICKETMASTER_API_KEY" }, 500);

    // Inputs
    const { attractionIds } = readFavorites(searchParams);

    const musicGenres = searchParams.getAll("musicGenres").map(deepDecodeParam).filter(Boolean);
    const sportsGenres = searchParams.getAll("sportsGenres").map(deepDecodeParam).filter(Boolean);
    const artsGenres = searchParams.getAll("artsGenres").map(deepDecodeParam).filter(Boolean);

    const selectedGenres = [...musicGenres, ...sportsGenres, ...artsGenres]
      .map((g) => normalizeName(g))
      .filter(Boolean);

    const selectedGenreSet = new Set(selectedGenres);

    // 1) ANCHOR EVENTS: fetch directly by favorites + genres (reliable)
    const anchorRows = []; // { e, source: "favorite" | "genre" }

    // TM doesn't reliably accept multiple countryCode values in one call.
    const ccList = (countryCodes && countryCodes.length ? countryCodes : ["US"]).slice(0, 2);

    // Favorites by attractionId
    for (const cc of ccList) {
      for (const aid of attractionIds) {
        const r = await tmFetchPaged(
          (page) => {
            const p = buildBaseParams({
              lat,
              lon,
              start,
              end,
              radiusMiles,
              countryCode: cc,
              sort: "date,asc",
              size: 80,
              page,
            });
            p.set("attractionId", String(aid));
            return p;
          },
          { maxPages: 2 }
        );

        if (r.ok) {
          for (const ev of r.events) anchorRows.push({ e: ev, source: "favorite" });
        }
      }
    }

    // Genres by classificationName (+ segmentName)
    const genreAnchors = [
      ...musicGenres.map((g) => ({ domain: "music", name: g })),
      ...sportsGenres.map((g) => ({ domain: "sports", name: g })),
      ...artsGenres.map((g) => ({ domain: "arts", name: g })),
    ];

    for (const cc of ccList) {
      for (const ga of genreAnchors) {
        const seg = segmentNameForDomain(ga.domain);

        const r = await tmFetchPaged(
          (page) => {
            const p = buildBaseParams({
              lat,
              lon,
              start,
              end,
              radiusMiles,
              countryCode: cc,
              sort: "date,asc",
              size: 80,
              page,
            });
            if (seg) p.set("segmentName", seg);
            p.set("classificationName", String(ga.name));
            return p;
          },
          { maxPages: 2 }
        );

        if (r.ok) {
          for (const ev of r.events) anchorRows.push({ e: ev, source: "genre" });
        }
      }
    }

    // 2) PREMIUM EVENTS: relevance-based top events for same window
    const premiumParams = new URLSearchParams();
    premiumParams.set("sort", "relevance,desc");
    premiumParams.set("latlong", `${lat},${lon}`);
    premiumParams.set("radius", String(radiusMiles));
    premiumParams.set("unit", "miles");
    premiumParams.set("startDateTime", `${start}T00:00:00Z`);
    premiumParams.set("endDateTime", `${end}T23:59:59Z`);
    premiumParams.set("size", "50");
    premiumParams.set("page", "0");
    premiumParams.set("countryCode", countryCodes[0] || "US");

    const premiumFetch = await tmFetchEvents(premiumParams);
    const premiumRaw = premiumFetch.ok && Array.isArray(premiumFetch.events) ? premiumFetch.events : [];

    // Combine by TM event id (first-pass)
    const byId = new Map(); // id -> { e, source }
    for (const row of anchorRows) {
      const e = row.e;
      const id = tmEventId(e);
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, { e, source: row.source });
    }
    for (const e of premiumRaw) {
      const id = tmEventId(e);
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, { e, source: "premium" });
    }

    const all = Array.from(byId.values());

    // Compute match flags + pill
    const favSet = new Set(attractionIds.map((x) => String(x).trim()).filter(Boolean));

    const out = [];
    let premiumKept = 0;
    const PREMIUM_CAP = 14;

    for (const row of all) {
      const e = row.e;
      const id = tmEventId(e);
      if (!id) continue;

      const rawName = tmEventName(e);
      if (!rawName || looksLikeNoise(rawName)) continue;

      const url = tmEventUrl(e);
      const localDate = tmLocalDate(e);
      if (!localDate) continue;

      const fromFavoriteFetch = row.source === "favorite";
      const fromGenreFetch = row.source === "genre";

      const attrIds = tmAttractionIdsForEvent(e);
      const favMatch = fromFavoriteFetch || attrIds.some((a) => favSet.has(a));

      const genreMatch = fromGenreFetch || (selectedGenreSet.size ? matchesSelectedGenres(e, selectedGenreSet) : false);

      const isPremium = row.source === "premium" && !favMatch && !genreMatch;

      // Keep only (favorite OR genre) OR premium (capped)
      if (!(favMatch || genreMatch || isPremium)) continue;

      if (isPremium) {
        if (premiumKept >= PREMIUM_CAP) continue;
        premiumKept += 1;
      }

      // Pill: selected genre if possible; else infer TM genre; else Premium
      let pillLabel = "";
      let matchedFavorites = [];

      if (genreMatch) {
        const { segment, genre, subGenre } = tmClassificationNamesForEvent(e);
        const cands = [genre, subGenre, segment].filter(Boolean);
        const pick = cands.find((c) => selectedGenreSet.has(normalizeName(c))) || cands[0] || "";
        pillLabel = pick || "Genre";
        matchedFavorites = pillLabel ? [pillLabel] : [];
      } else if (favMatch) {
        const inferred = pickGenrePill(e); // e.g. Hockey
        pillLabel = inferred || "Favorite";
        matchedFavorites = [pillLabel];
      } else {
        pillLabel = "Premium";
        matchedFavorites = ["Premium"];
      }

      out.push({
        id,
        name: canonicalizeTitleForDedupe(rawName), // display uses de-wrapper title
        url,
        localDate,
        localTime: tmLocalTime(e),
        city: tmCity(e),
        region: tmRegion(e),
        venueName: tmVenueName(e) || "Venue",
        matchedFavorites,
        pillLabel,

        // internal markers (removed before returning)
        _rawName: rawName,
        _isPremium: isPremium,
      });
    }

    // ✅ Premium upsell suppression (Premium-only)
    const beforeUpsell = out.length;
    const sup = suppressPremiumUpsellsNearHeadliner(out, { hoursWindow: 6 });
    let outSuppressed = sup.rows;

    // ✅ HARD DEDUPE: remove Access Pass / Garage / Seating wrappers etc.
    const beforeStrict = outSuppressed.length;
    let outDeduped = dedupeRowsStrict(outSuppressed);
    outDeduped = collapseSameDaySameVenueKeepEvening(outDeduped);

    // Sort by date/time
    outDeduped.sort((a, b) => {
      const ad = String(a.localDate || "");
      const bd = String(b.localDate || "");
      if (ad !== bd) return ad < bd ? -1 : 1;
      const at = String(a.localTime || "");
      const bt = String(b.localTime || "");
      if (at !== bt) return at < bt ? -1 : 1;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    // ✅ Rolling premium de-noise: same Premium title max 1 every 3 days
    const minGapDaysPremium = 3;
    const outRateLimited = rateLimitPremiumEveryNDays(outDeduped, { minGapDays: minGapDaysPremium });

    const CAP = 140;

    // Strip internal fields
    const cleaned = outRateLimited.slice(0, CAP).map((r) => {
      const { _rawName, _isPremium, ...rest } = r || {};
      return rest;
    });

    return json({
      count: cleaned.length,
      events: cleaned,
      debug: {
        rawFavorites: searchParams.getAll("favorites"),
        favoritesAttractionIds: attractionIds,
        selectedGenres,

        anchorRowsCount: anchorRows.length,
        anchorRowsSources: anchorRows.reduce((acc, r) => {
          acc[r.source] = (acc[r.source] || 0) + 1;
          return acc;
        }, {}),

        premiumFetchedOk: !!premiumFetch.ok,
        premiumFetchedApprox: premiumRaw.length,
        premiumKept,

        premiumUpsellSuppression: {
          before: beforeUpsell,
          after: outSuppressed.length,
          dropped: Math.max(0, sup.dropped),
        },

        dedupe: {
          beforeStrict,
          afterStrict: outDeduped.length,
          dropped: Math.max(0, beforeStrict - outDeduped.length),
        },

        premiumRateLimit: {
          minGapDays: minGapDaysPremium,
          before: outDeduped.length,
          after: outRateLimited.length,
        },

        totalCombined: all.length,
        totalReturned: cleaned.length,
      },
    });
  } catch (e) {
    return json({ error: "Events API error", detail: String(e?.message || e) }, 500);
  }
}