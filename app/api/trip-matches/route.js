import { NextResponse } from "next/server";
import {
  genreKeyToBucket,
  genreKeyToLabel,
  resolveGenreKey,
  normalizeGenreKeys,
} from "@/lib/events/genres";

const TM_EVENTS = "https://app.ticketmaster.com/discovery/v2/events.json";

// 🔥 reduced cost
const HARD_MATCH_EVENT_CAP = 300;
const MAX_PAGES = 2;
const MAX_TOTAL_GENRES = 4;

// 🔥 cache
const EXISTS_CACHE = new Map();
const EXISTS_TTL = 1000 * 60 * 5;

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

function looksLikeCompetitionDayEvent(e) {
  const name = String(e?.name || "").toLowerCase();
  return !/(package|vip|suite|pass)/i.test(name);
}

function getNormalizedGenreKeysFromTMEvent(e) {
  const cls = e?.classifications?.[0] || null;
  return normalizeGenreKeys(
    [cls?.subGenre?.name, cls?.genre?.name, cls?.segment?.name],
    2
  );
}

function normalizeSelectedGenres(labels) {
  const seen = new Set();
  const out = [];

  for (const label of labels) {
    const key = resolveGenreKey(label);
    const bucket = genreKeyToBucket(key);
    const canonicalLabel = genreKeyToLabel(key);

    if (!key || !bucket || !canonicalLabel) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push({ key, bucket, label: canonicalLabel });
  }

  return out.slice(0, MAX_TOTAL_GENRES);
}

async function fetchPage(urlBase, page) {
  const url = new URL(urlBase.toString());
  url.searchParams.set("page", String(page));

  const r = await fetch(url.toString(), { cache: "no-store" });
  const json = await r.json().catch(() => ({}));

  if (!r.ok) {
    return { ok: false, raw: [] };
  }

  return {
    ok: true,
    raw: Array.isArray(json?._embedded?.events)
      ? json._embedded.events
      : [],
  };
}

async function existsScan(urlBase, maxPages, filters) {
  const { musicGenreKeys, sportsGenreKeys, wantsAnyFilter } = filters;
  const selectedGenreKeys = [...musicGenreKeys, ...sportsGenreKeys];

  let page = 0;
  let scanned = 0;

  while (page < maxPages && scanned < HARD_MATCH_EVENT_CAP) {
    const r = await fetchPage(urlBase, page);
    if (!r.ok) return { ok: true, exists: false };

    const raw = r.raw || [];
    scanned += raw.length;

    for (const e of raw) {
      if (!looksLikeCompetitionDayEvent(e)) continue;

      if (wantsAnyFilter) {
        const keys = getNormalizedGenreKeysFromTMEvent(e);

        let matched = keys.some((k) => selectedGenreKeys.includes(k));

        if (!matched) {
          const cls = e?.classifications?.[0] || {};
          const vals = [cls?.subGenre?.name, cls?.genre?.name, cls?.segment?.name];

          matched = vals.some((v) => {
            const k = resolveGenreKey(v);
            return k && selectedGenreKeys.includes(k);
          });
        }

        if (!matched) continue;
      }

      return { ok: true, exists: true };
    }

    if (raw.length < 200) break;
    page++;
  }

  return { ok: true, exists: false };
}

export async function GET(req) {
  try {
    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing API key" }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);

    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const lat = Number(searchParams.get("lat"));
    const lon = Number(searchParams.get("lon"));
    const radiusMiles = Number(searchParams.get("radiusMiles") || 25);

    const rawGenres = getParamList(searchParams, "genres");

    const cacheKey = [
      start,
      end,
      lat,
      lon,
      radiusMiles,
      rawGenres.join("|"),
    ].join("|");

    const cached = EXISTS_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < EXISTS_TTL) {
      return NextResponse.json(cached.value);
    }

    const normalized = normalizeSelectedGenres(rawGenres);

    const musicGenreKeys = normalized
      .filter((g) => g.bucket === "music")
      .map((g) => g.key);

    const sportsGenreKeys = normalized
      .filter((g) => g.bucket === "sports")
      .map((g) => g.key);

    const url = new URL(TM_EVENTS);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("latlong", `${lat},${lon}`);
    url.searchParams.set("radius", String(Math.round(milesToKm(radiusMiles))));
    url.searchParams.set("unit", "km");
    url.searchParams.set("startDateTime", `${start}T00:00:00Z`);
    url.searchParams.set("endDateTime", `${end}T23:59:59Z`);
    url.searchParams.set("size", "200");

    const result = await existsScan(url, MAX_PAGES, {
      musicGenreKeys,
      sportsGenreKeys,
      wantsAnyFilter: normalized.length > 0,
    });

    EXISTS_CACHE.set(cacheKey, { ts: Date.now(), value: result });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    );
  }
}