// app/api/options/route.js
import { NextResponse } from "next/server";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_ATTRACTIONS = `${TM_BASE}/attractions.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;
const TM_EVENTS = `${TM_BASE}/events.json`;

// Tune these
const OPTIONS_TTL_SECONDS = 60 * 60; // 1 hour (CDN + memory cache)
const STALE_WHILE_REVALIDATE_SECONDS = 60 * 60 * 24; // 24 hours

function sortByLabel(a, b) {
  return String(a.label).localeCompare(String(b.label));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function resolveWithRetry(fn, { tries = 3, baseDelayMs = 250 } = {}) {
  let last = null;

  for (let i = 0; i < tries; i++) {
    try {
      const out = await fn();
      if (out) return out;
      last = out;
    } catch (e) {
      last = null;

      // If TM is rate-limiting, back off harder
      const msg = String(e?.message || e || "");
      const is429 = msg.includes("429");
      const delay = is429 ? 1200 + i * 800 : baseDelayMs * Math.pow(2, i);
      await sleep(delay);
      continue;
    }

    // small backoff even if result is null (common when TM is flaky)
    await sleep(baseDelayMs * Math.pow(2, i));
  }

  return last;
}


// Canonical team rosters
const TEAMS_BY_LEAGUE = {
  NHL: [
    "Anaheim Ducks","Arizona Coyotes","Boston Bruins","Buffalo Sabres","Calgary Flames","Carolina Hurricanes",
    "Chicago Blackhawks","Colorado Avalanche","Columbus Blue Jackets","Dallas Stars","Detroit Red Wings",
    "Edmonton Oilers","Florida Panthers","Los Angeles Kings","Minnesota Wild","Montreal Canadiens",
    "Nashville Predators","New Jersey Devils","New York Islanders","New York Rangers","Ottawa Senators",
    "Philadelphia Flyers","Pittsburgh Penguins","San Jose Sharks","Seattle Kraken","St. Louis Blues",
    "Tampa Bay Lightning","Toronto Maple Leafs","Vancouver Canucks","Vegas Golden Knights","Washington Capitals",
    "Winnipeg Jets"
  ],
  NBA: [
    "Atlanta Hawks","Boston Celtics","Brooklyn Nets","Charlotte Hornets","Chicago Bulls","Cleveland Cavaliers",
    "Dallas Mavericks","Denver Nuggets","Detroit Pistons","Golden State Warriors","Houston Rockets","Indiana Pacers",
    "LA Clippers","Los Angeles Lakers","Memphis Grizzlies","Miami Heat","Milwaukee Bucks","Minnesota Timberwolves",
    "New Orleans Pelicans","New York Knicks","Oklahoma City Thunder","Orlando Magic","Philadelphia 76ers",
    "Phoenix Suns","Portland Trail Blazers","Sacramento Kings","San Antonio Spurs","Toronto Raptors",
    "Utah Jazz","Washington Wizards"
  ],
  MLB: [
    "Arizona Diamondbacks","Atlanta Braves","Baltimore Orioles","Boston Red Sox","Chicago Cubs","Chicago White Sox",
    "Cincinnati Reds","Cleveland Guardians","Colorado Rockies","Detroit Tigers","Houston Astros","Kansas City Royals",
    "Los Angeles Angels","Los Angeles Dodgers","Miami Marlins","Milwaukee Brewers","Minnesota Twins","New York Mets",
    "New York Yankees","Oakland Athletics","Philadelphia Phillies","Pittsburgh Pirates","San Diego Padres",
    "San Francisco Giants","Seattle Mariners","St. Louis Cardinals","Tampa Bay Rays","Texas Rangers",
    "Toronto Blue Jays","Washington Nationals"
  ],
  NFL: [
    "Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills","Carolina Panthers","Chicago Bears",
    "Cincinnati Bengals","Cleveland Browns","Dallas Cowboys","Denver Broncos","Detroit Lions","Green Bay Packers",
    "Houston Texans","Indianapolis Colts","Jacksonville Jaguars","Kansas City Chiefs","Las Vegas Raiders",
    "Los Angeles Chargers","Los Angeles Rams","Miami Dolphins","Minnesota Vikings","New England Patriots",
    "New Orleans Saints","New York Giants","New York Jets","Philadelphia Eagles","Pittsburgh Steelers",
    "San Francisco 49ers","Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans","Washington Commanders"
  ],
  MLS: [
    "Atlanta United","Austin FC","CF Montréal","Charlotte FC","Chicago Fire FC","Colorado Rapids","Columbus Crew",
    "D.C. United","FC Cincinnati","FC Dallas","Houston Dynamo FC","Inter Miami CF","LA Galaxy",
    "Los Angeles Football Club","Minnesota United FC","Nashville SC","New England Revolution",
    "New York City FC","New York Red Bulls","Orlando City SC","Philadelphia Union","Portland Timbers",
    "Real Salt Lake","San Diego FC","San Jose Earthquakes","Seattle Sounders FC","Sporting Kansas City",
    "St. Louis CITY SC","Toronto FC","Vancouver Whitecaps FC"
  ],
  CFL: [
    "BC Lions","Calgary Stampeders","Edmonton Elks","Saskatchewan Roughriders","Winnipeg Blue Bombers",
    "Hamilton Tiger-Cats","Toronto Argonauts","Ottawa Redblacks","Montreal Alouettes"
  ],
};

/* -------------------- ID builders (Option A) -------------------- */

function tmTeamId(league, attractionId, name) {
  const L = String(league || "").trim();
  const A = String(attractionId || "").trim();
  const N = String(name || "").trim();
  // team:<LEAGUE>:<ATTRACTION_ID>:<NAME>
  return `team:${L}:${A}:${N}`;
}

function tmArtistId(attractionId, name) {
  const A = String(attractionId || "").trim();
  const N = String(name || "").trim();
  // artist:<ATTRACTION_ID>:<NAME>
  return `artist:${A}:${N}`;
}

/* -------------------- fetch helper -------------------- */

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: OPTIONS_TTL_SECONDS },
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e) };
  } finally {
    clearTimeout(timeout);
  }
}

/* -------------------- small concurrency limiter -------------------- */

async function mapWithConcurrency(list, limit, mapper) {
  const out = new Array(list.length);
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= list.length) return;
      out[idx] = await mapper(list[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return out;
}

/* -------------------- Attraction resolution (Teams + Artists) -------------------- */

/**
 * Resolve best Sports attractionId for a given team name.
 * We use segmentName=Sports and keyword=teamName, restricted to US/CA.
 *
 * NOTE: Ticketmaster is not perfectly consistent; this is a best-effort resolver
 * used only at options-build time (then cached).
 */

async function resolveTeamAttractionId(teamName, league) {
  if (!TM_KEY) return null;

  const name = String(teamName || "").trim();
  const leagueName = String(league || "").trim(); // e.g. "NHL"

  // ---------- Attempt 1: Attractions search (current approach) ----------
  {
    const params = new URLSearchParams();
    params.set("apikey", TM_KEY);
    params.set("segmentName", "Sports");
    params.set("keyword", name);
    params.set("size", "20");
    params.set("countryCode", "US,CA");

    const url = `${TM_ATTRACTIONS}?${params.toString()}`;
    const r = await fetchJson(url);

    if (r.ok) {
      const list = r.json?._embedded?.attractions || [];
      if (Array.isArray(list) && list.length) {
        const q = name.toLowerCase();

        const exact = list.find((a) => String(a?.name || "").trim().toLowerCase() === q && a?.id);
        if (exact?.id) return exact.id;

        const incl = list.find((a) => String(a?.name || "").trim().toLowerCase().includes(q) && a?.id);
        if (incl?.id) return incl.id;

        const first = list.find((a) => a?.id);
        if (first?.id) return first.id;
      }
    }
  }

  // ---------- Attempt 2 (NEW): Events search fallback ----------
  // Pull the team attractionId from a real event that matches the team.
  {
    const params = new URLSearchParams();
    params.set("apikey", TM_KEY);
    params.set("keyword", name);
    params.set("size", "10");
    params.set("sort", "relevance,desc");
    params.set("countryCode", "US,CA");

    // This filter tends to help a lot for teams:
    params.set("segmentName", "Sports");

    // If Ticketmaster accepts classificationName for league, try it (harmless if ignored)
    if (leagueName) params.set("classificationName", leagueName);

    const url = `${TM_EVENTS}?${params.toString()}`;
    const r = await fetchJson(url);

    if (r.ok) {
      const events = r.json?._embedded?.events || [];
      if (Array.isArray(events) && events.length) {
        // Search embedded attractions for a matching name; otherwise take first attraction id.
        const q = name.toLowerCase();

        for (const ev of events) {
          const atts = ev?._embedded?.attractions;
          if (!Array.isArray(atts)) continue;

          const exact = atts.find((a) => String(a?.name || "").trim().toLowerCase() === q && a?.id);
          if (exact?.id) return exact.id;

          const incl = atts.find((a) => String(a?.name || "").trim().toLowerCase().includes(q) && a?.id);
          if (incl?.id) return incl.id;

          const first = atts.find((a) => a?.id);
          if (first?.id) return first.id;
        }
      }
    }
  }

  return null;
}

async function findArtistByKeyword(name) {
  if (!TM_KEY) return null;
  const params = new URLSearchParams();
  params.set("apikey", TM_KEY);
  params.set("segmentName", "Music");
  params.set("keyword", name);
  params.set("size", "20");
  params.set("countryCode", "US,CA");

  const url = `${TM_ATTRACTIONS}?${params.toString()}`;
  const r = await fetchJson(url);
  const list = r.json?._embedded?.attractions || [];
  const best = list.find((a) => a?.id && a?.name) || null;
  return best ? { id: best.id, name: best.name } : null;
}

async function getMusicArtists(limit = 1200) {
  if (!TM_KEY) return [];

  const pagesToFetch = 10; // up to ~2000 raw records
  const size = 200;

  const all = [];

  for (let page = 0; page < pagesToFetch; page++) {
    const url =
      `${TM_ATTRACTIONS}?apikey=${TM_KEY}` +
      `&classificationName=music` +
      `&size=${size}&page=${page}&sort=relevance,desc` +
      `&countryCode=US,CA`;

    const r = await fetchJson(url);
    if (!r.ok) continue;

    const attractions = r.json?._embedded?.attractions ?? [];
    for (const a of attractions) {
      if (!a?.id || !a?.name) continue;

      all.push({
        id: tmArtistId(a.id, a.name), // ✅ Option A artist id
        label: a.name,
        group: "Artists",
        kind: "artist",
      });
    }
  }

  // Force include Luke Combs if still missing
  const mustHave = ["Luke Combs"];
  for (const name of mustHave) {
    const exists = all.some((x) => x.label.toLowerCase() === name.toLowerCase());
    if (!exists) {
      const found = await findArtistByKeyword(name);
      if (found?.id) {
        all.push({
          id: tmArtistId(found.id, found.name), // ✅ Option A artist id
          label: found.name,
          group: "Artists",
          kind: "artist",
        });
      }
    }
  }

  // dedupe by label
  const map = new Map();
  for (const o of all) {
    const key = o.label.trim().toLowerCase();
    if (!map.has(key)) map.set(key, o);
  }

  return Array.from(map.values()).sort(sortByLabel).slice(0, limit);
}

/* -------------------- Teams (resolve attractionId + build options) -------------------- */

async function buildTeamOptionsResolved() {
  // Flatten roster
  const roster = [];
  for (const league of Object.keys(TEAMS_BY_LEAGUE)) {
    const teams = TEAMS_BY_LEAGUE[league].slice().sort((a, b) => a.localeCompare(b));
    for (const name of teams) roster.push({ league, name });
  }

  // Resolve attractionIds with a conservative concurrency cap
  const CONCURRENCY = 6;

  const resolved = await mapWithConcurrency(roster, CONCURRENCY, async ({ league, name }) => {
const attractionId = await resolveWithRetry(
  () => resolveTeamAttractionId(name, league),
  { tries: 3, baseDelayMs: 300 }
);
    return { league, name, attractionId: attractionId || "" };
  });

  const unresolved = resolved.filter((x) => !x.attractionId).map((x) => `${x.league}:${x.name}`);

  const options = resolved.map((t) => ({
    id: tmTeamId(t.league, t.attractionId, t.name), // ✅ Option A team id
    label: t.name,
    group: t.league,
    kind: "team",
    league: t.league,
    attractionId: t.attractionId, // optional, useful for debugging
  }));

  return { options, unresolved };
}

/**
 * In-memory cache (per warm instance). Greatly reduces repeated work
 * during bursts and repeat visits; CDN cache headers cover the bigger picture.
 */
function getCacheBucket() {
  if (!globalThis.__EVENTSTACK_OPTIONS_CACHE__) {
    globalThis.__EVENTSTACK_OPTIONS_CACHE__ = {
      value: null,
      expiresAt: 0,
      inflight: null,
    };
  }
  return globalThis.__EVENTSTACK_OPTIONS_CACHE__;
}

async function buildCombinedOptions() {
  const teamsRes = await buildTeamOptionsResolved();
  const artists = await getMusicArtists(1200);

  const combined = [...teamsRes.options, ...artists];

  return {
    combined,
    debug: {
      teamsCount: teamsRes.options.length,
      artistsCount: artists.length,
      combinedCount: combined.length,
      teamAttractionIdsResolved: teamsRes.options.filter((x) => !!x.attractionId).length,
      teamAttractionIdsMissing: teamsRes.options.filter((x) => !x.attractionId).length,
      // Keep this list short; it can be large otherwise
      teamAttractionIdsMissingSample: teamsRes.unresolved.slice(0, 25),
    },
  };
}

export async function GET() {
  const cache = getCacheBucket();
  const now = Date.now();

  // Serve from memory cache
  if (cache.value && cache.expiresAt > now) {
    return NextResponse.json(cache.value, {
      headers: {
        "Cache-Control": `public, s-maxage=${OPTIONS_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`,
        "X-Options-Cache": "HIT",
      },
    });
  }

  // Deduplicate concurrent requests
  if (cache.inflight) {
    const payload = await cache.inflight;
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": `public, s-maxage=${OPTIONS_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`,
        "X-Options-Cache": "HIT-INFLIGHT",
      },
    });
  }

  cache.inflight = (async () => {
    try {
      const payload = await buildCombinedOptions();
      cache.value = payload;
      cache.expiresAt = Date.now() + OPTIONS_TTL_SECONDS * 1000;
      return payload;
    } catch (err) {
      return { combined: [], error: err?.message || "Unknown error" };
    } finally {
      cache.inflight = null;
    }
  })();

  const payload = await cache.inflight;

  // If buildCombinedOptions failed, respond 500; otherwise 200.
  const status = payload?.error ? 500 : 200;

  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": `public, s-maxage=${OPTIONS_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`,
      "X-Options-Cache": "MISS",
    },
  });
}
