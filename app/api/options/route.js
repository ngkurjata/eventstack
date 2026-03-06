// FILE: app/api/options/route.js
import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

/**
 * Data files expected (relative to project root):
 *   /data/artist_options.json
 *   /data/team_attraction_ids.json
 *   /data/genres_config.json
 *
 * Optional (for city autocomplete):
 *   /data/airports.json  (preferred, used to derive cities)
 *   /data/cities.json    (fallback)
 */

function json(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

async function readJson(relPath) {
  const abs = path.join(process.cwd(), relPath);
  const raw = await fs.readFile(abs, "utf8");
  return JSON.parse(raw);
}

function sortByLabel(a, b) {
  return String(a.label || "").localeCompare(String(b.label || ""));
}

/* -------------------- In-memory cache (module scope) -------------------- */

let CACHE = null;
let CACHE_AT = 0;
const TTL_MS = 10 * 60 * 1000; // 10 minutes

let CITY_CACHE = null;
let CITY_CACHE_AT = 0;
const CITY_TTL_MS = 60 * 60 * 1000; // 60 minutes

function shouldBypassCache(sp) {
  return sp?.get("fresh") === "1";
}

/* -------------------- Normalizers -------------------- */

function normalizeTeams(teamData) {
  const out = [];

  const pushTeam = ({ league, label, attractionId }) => {
    const L = String(league || "TEAM").trim();
    const lbl = String(label || "").trim();
    const aid = String(attractionId || "").trim();
    if (!lbl || !aid) return;

    out.push({
      id: `team:${L}:${aid}:${lbl}`,
      label: lbl,
      kind: "team",
      league: L,
      attractionId: aid,
      group: L,
    });
  };

  if (Array.isArray(teamData)) {
    for (const it of teamData) {
      if (!it || typeof it !== "object") continue;
      const label = it.label || it.name || it.team;
      const league = it.league || it.group || it.sport || it.type || "TEAM";
      const attractionId = it.attractionId || it.id || it.attractionID;
      pushTeam({ league, label, attractionId });
    }
    return out;
  }

  if (teamData && typeof teamData === "object") {
    for (const [leagueKey, val] of Object.entries(teamData)) {
      const league = leagueKey;

      if (Array.isArray(val)) {
        for (const it of val) {
          if (!it || typeof it !== "object") continue;
          const label = it.label || it.name || it.team;
          const attractionId = it.attractionId || it.id;
          pushTeam({ league, label, attractionId });
        }
        continue;
      }

      if (val && typeof val === "object") {
        const arr = Array.isArray(val.teams)
          ? val.teams
          : Array.isArray(val.entries)
          ? val.entries
          : Array.isArray(val.items)
          ? val.items
          : null;

        if (arr) {
          for (const it of arr) {
            if (!it || typeof it !== "object") continue;
            const label = it.label || it.name || it.team;
            const attractionId = it.attractionId || it.id;
            pushTeam({ league, label, attractionId });
          }
          continue;
        }

        for (const [labelKey, v] of Object.entries(val)) {
          if (labelKey === "segmentName" || labelKey === "enabled" || labelKey === "meta") continue;

          let attractionId = null;
          if (typeof v === "string") attractionId = v;
          else if (v && typeof v === "object") attractionId = v.attractionId || v.id || null;

          pushTeam({ league, label: labelKey, attractionId });
        }
      }
    }
  }

  return out;
}

function normalizeArtists(artistData) {
  const out = [];
  const arr = Array.isArray(artistData) ? artistData : [];

  for (const it of arr) {
    if (!it || typeof it !== "object") continue;

    const label = String(it.label || it.name || "").trim();
    const attractionId = String(it.attractionId || it.id || "").trim();
    if (!label || !attractionId) continue;

    out.push({
      id: `artist:${attractionId}:${label}`,
      label,
      kind: "artist",
      attractionId,
      group: "Artists",
    });
  }

  return out;
}

function normalizeGenresFromConfig(cfg) {
  const aliases = cfg && typeof cfg === "object" && cfg.aliases ? cfg.aliases : {};

  function fromBucket(domain) {
    const bucket = cfg?.[domain];
    if (!bucket || typeof bucket !== "object") return [];

    const segmentName = bucket.segmentName || null;
    const entries = Array.isArray(bucket.entries) ? bucket.entries : [];

    const out = [];
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      if (e.enabled === false) continue;

      const rawName = String(e.name || "").trim();
      if (!rawName) continue;

      const label = String(aliases[rawName] || rawName);

      out.push({
        id: `genre:${domain}:${rawName}`,
        label,
        rawName,
        kind: "genre",
        domain,
        group: `Genres (${domain})`,
        segmentName,
        tmClassificationNames: [rawName],
      });
    }
    return out;
  }

  return {
    musicGenres: fromBucket("music"),
    sportsGenres: fromBucket("sports"),
    artsGenres: fromBucket("arts"),
  };
}

/* -------------------- Cities (derived from airports, fallback to cities.json) -------------------- */

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function regionShort(region) {
  const s = String(region || "").trim();
  if (!s) return "";
  return s.includes("-") ? s.split("-")[1] : s;
}

async function buildCities({ bypass = false } = {}) {
  const now = Date.now();
  if (!bypass && CITY_CACHE && now - CITY_CACHE_AT < CITY_TTL_MS) return CITY_CACHE;

  // 1) Try airports.json
  try {
    const raw = await readJson("data/airports.json");
    const airports = Array.isArray(raw) ? raw : [];

    const byKey = new Map();

    for (const a of airports) {
      if (!a || typeof a !== "object") continue;

      const city = String(a.city || a.town || a.municipality || "").trim();
      const country = String(a.country || a.countryCode || "").trim().toUpperCase();
      const reg = regionShort(a.region || a.state || a.province);
      const iata = String(a.iata || "").trim().toUpperCase();

      const lat = toNum(a.lat ?? a.latitude);
      const lon = toNum(a.lon ?? a.lng ?? a.longitude);

      if (!city || !country) continue;
      if (lat === null || lon === null) continue;

      const key = `${country}|${reg}|${city}`.toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, {
          id: `${country}|${reg}|${city}`.replace(/\|\|/g, "|"),
          label: `${city}${reg ? `, ${reg}` : ""}`,
          lat,
          lon,
          country,
          airportIata: iata || null,
        });
      }
    }

    const cities = Array.from(byKey.values());
    if (cities.length) {
      CITY_CACHE = cities;
      CITY_CACHE_AT = now;
      return CITY_CACHE;
    }
  } catch {
    // ignore; fallback to cities.json
  }

  // 2) Fallback cities.json
  try {
    const raw = await readJson("data/cities.json");
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.cities) ? raw.cities : [];

    const out = [];
    const seen = new Set();

    for (const x of arr) {
      if (!x || typeof x !== "object") continue;

      const id = String(x.id || "").trim();
      const label = String(x.label || x.name || "").trim();
      const lat = toNum(x.lat ?? x.latitude);
      const lon = toNum(x.lon ?? x.lng ?? x.longitude);
      const country = x.country ? String(x.country).trim().toUpperCase() : null;

      if (!id || !label) continue;
      if (lat === null || lon === null) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      out.push({ id, label, lat, lon, country });
    }

    CITY_CACHE = out;
    CITY_CACHE_AT = now;
    return CITY_CACHE;
  } catch {
    CITY_CACHE = [];
    CITY_CACHE_AT = now;
    return CITY_CACHE;
  }
}

function searchCities(cities, q, limit = 10) {
  const query = String(q || "").trim().toLowerCase();
  if (query.length < 2) return [];

  const scored = [];
  for (const c of cities) {
    const lbl = String(c?.label || "").toLowerCase();
    const idx = lbl.indexOf(query);
    if (idx === -1) continue;

    const score = (idx === 0 ? 0 : 1000) + idx * 5 + Math.min(200, lbl.length);
    scored.push({ c, score });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((x) => x.c);
}

/* -------------------- Builder -------------------- */

async function buildOptions() {
  const [artistData, teamData, genresCfg] = await Promise.all([
    readJson("data/artist_options.json"),
    readJson("data/team_attraction_ids.json"),
    readJson("data/genres_config.json"),
  ]);

  const teams = normalizeTeams(teamData);
  const artists = normalizeArtists(artistData);

  const favorites = [...teams, ...artists].sort(sortByLabel);

  const { musicGenres, sportsGenres, artsGenres } = normalizeGenresFromConfig(genresCfg);
  const genres = [...musicGenres, ...sportsGenres, ...artsGenres].sort(sortByLabel);

  const leagueCounts = teams.reduce((acc, t) => {
    const k = String(t.league || "TEAM");
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return {
    favorites,
    genres,
    musicGenres,
    sportsGenres,
    artsGenres,
    meta: {
      favoritesCount: favorites.length,
      genresCount: genres.length,
      teamsCount: teams.length,
      artistsCount: artists.length,
      musicGenresCount: musicGenres.length,
      sportsGenresCount: sportsGenres.length,
      artsGenresCount: artsGenres.length,
      leagueCounts,
    },
  };
}

/* -------------------- Route -------------------- */

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const bypass = shouldBypassCache(searchParams);

    const kind = String(searchParams.get("kind") || "").trim();

    // Cities endpoint
    if (kind === "cities") {
      const q = String(searchParams.get("q") || "").trim();
      const all = searchParams.get("all") === "1";
      const debug = searchParams.get("debug") === "1";

      const cities = await buildCities({ bypass });
      const hits = all ? cities : searchCities(cities, q, 10);

      if (debug) {
        return json({
          ok: true,
          q,
          all,
          meta: { citiesTotal: cities.length },
          cities: hits,
        });
      }

      return json({ ok: true, cities: hits });
    }

    // Base options (favorites/genres)
    const now = Date.now();
    if (!bypass && CACHE && now - CACHE_AT < TTL_MS) return json(CACHE);

    const built = await buildOptions();
    CACHE = built;
    CACHE_AT = now;
    return json(built);
  } catch (e) {
    return json(
      {
        ok: false,
        error: String(e?.message || e),
        hint:
          "Check /data files: artist_options.json, team_attraction_ids.json, genres_config.json. For cities: airports.json or cities.json.",
      },
      500
    );
  }
}