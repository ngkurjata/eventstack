// FILE: scripts/build_team_attraction_ids.mjs
//
// Usage (PowerShell, from repo root):
//   $env:TICKETMASTER_API_KEY="YOUR_KEY_HERE"
//   node .\scripts\build_team_attraction_ids.mjs
//
// Output:
//   data/team_attraction_ids.json
//   data/team_attraction_misses.json
//   data/team_attraction_throttled.json
//
// Notes:
// - Designed to be resumable: it loads existing data/team_attraction_ids.json and skips filled teams.
// - Distinguishes TRUE misses from throttling (429).
// - Uses backoff + Retry-After handling.

import fs from "fs/promises";
import path from "path";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_ATTRACTIONS = `${TM_BASE}/attractions.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

if (!TM_KEY) {
  console.error("Missing TICKETMASTER_API_KEY in environment.");
  process.exit(1);
}

/* -------------------- Teams (canonical rosters) -------------------- */

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

/* -------------------- Small utilities -------------------- */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function dataPath(rel) {
  return path.join(process.cwd(), "data", rel);
}

async function readJsonIfExists(p, fallback) {
  try {
    const raw = await fs.readFile(p, "utf8");
    const j = JSON.parse(raw);
    return j ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/* -------------------- Normalization + scoring -------------------- */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(vs|versus|v)\b/g, " ")
    .replace(/\b(hockey|basketball|baseball|football|soccer|fc|sc|club)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function leagueHint(league) {
  const L = String(league || "").toUpperCase();
  if (L === "MLS") return "soccer";
  if (L === "CFL") return "football";
  return L; // NHL/NFL/NBA/MLB
}

function scoreCandidate(c, teamName, league) {
  const candName = String(c?.name || "");
  const nCand = norm(candName);
  const nTarget = norm(teamName);

  let score = 0;

  if (nCand === nTarget) score += 220;
  if (nCand.includes(nTarget)) score += 140;

  // token overlap
  const tSet = new Set(nTarget.split(" ").filter(Boolean));
  const cSet = new Set(nCand.split(" ").filter(Boolean));
  let overlap = 0;
  for (const t of tSet) if (cSet.has(t)) overlap += 1;
  score += overlap * 18;

  // classifications hints
  const classes = c?.classifications?.[0] || {};
  const segment = String(classes?.segment?.name || "").toLowerCase();
  const genre = String(classes?.genre?.name || "").toLowerCase();
  const subGenre = String(classes?.subGenre?.name || "").toLowerCase();

  if (segment.includes("sports")) score += 35;
  if (genre.includes(league.toLowerCase())) score += 20;
  if (subGenre.includes(league.toLowerCase())) score += 10;

  const type = String(c?.type || "").toLowerCase();
  if (type.includes("attraction")) score += 8;

  // Penalize obvious non-sports/music collisions (rare, but helps w/ names like "Giants")
  if (segment && !segment.includes("sports")) score -= 40;

  return score;
}

/* -------------------- 429 backoff -------------------- */

function parseRetryAfterMs(res) {
  try {
    const ra = res.headers.get("retry-after");
    if (!ra) return null;

    const s = String(ra).trim();
    if (/^\d+$/.test(s)) return Number(s) * 1000;

    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) {
      const ms = dt.getTime() - Date.now();
      return ms > 0 ? ms : 0;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchWithBackoff(url, { tries = 8, baseDelayMs = 1500 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const res = await fetch(url, { cache: "no-store" });

    if (res.status !== 429) return res;

    const raMs = parseRetryAfterMs(res);
    const jitter = Math.floor(Math.random() * 450);
    const exp = Math.min(60_000, Math.floor(baseDelayMs * Math.pow(1.6, i))) + jitter;
    const waitMs = raMs != null ? Math.max(raMs, 1500) : exp;

    console.log(`429 rate limit. Backing off ${Math.ceil(waitMs / 1000)}s…`);
    await sleep(waitMs);
  }

  // final attempt
  return fetch(url, { cache: "no-store" });
}

/* -------------------- Ticketmaster fetch -------------------- */

async function fetchAttractions(keyword) {
  const u = new URL(TM_ATTRACTIONS);
  u.searchParams.set("apikey", TM_KEY);
  u.searchParams.set("keyword", keyword);
  u.searchParams.set("size", "30");

  const res = await fetchWithBackoff(u.toString(), { tries: 8, baseDelayMs: 1500 });

  if (res.status === 429) return { items: [], status: 429 };

  if (!res.ok) {
    // Capture short error for debugging (don’t spam)
    const txt = await res.text().catch(() => "");
    console.error(`TM attractions failed: HTTP ${res.status} keyword="${keyword}"`);
    if (txt) console.error(txt.slice(0, 240));

    if (res.status === 401 || res.status === 403) {
      throw new Error(`TM auth failed (${res.status}). Check/rotate API key.`);
    }
    return { items: [], status: res.status };
  }

  const json = await res.json().catch(() => ({}));
  const items = json?._embedded?.attractions || [];
  return { items: Array.isArray(items) ? items : [], status: 200 };
}

async function searchAttraction(teamName, league) {
  const tries = [teamName, `${teamName} ${leagueHint(league)}`];

  let best = null;
  let bestScore = -Infinity;

  for (const kw of tries) {
    const { items, status } = await fetchAttractions(kw);
    if (status === 429) return { throttled: true };

    for (const c of items) {
      const s = scoreCandidate(c, teamName, league);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }

    // brief pause between keyword tries
    await sleep(200);
  }

  const id = best?.id ? String(best.id).trim() : "";
  if (!id) return null;

  // threshold to avoid obviously wrong matches; tune if needed
  if (bestScore < 80) return null;

  return { id, bestName: best?.name || null, bestScore };
}

/* -------------------- Progress persistence -------------------- */

async function writeProgress(out, misses, throttled) {
  await writeJson(dataPath("team_attraction_ids.json"), out);
  await writeJson(dataPath("team_attraction_misses.json"), misses);
  await writeJson(dataPath("team_attraction_throttled.json"), throttled);
}

/* -------------------- Main -------------------- */

async function main() {
  console.log("Starting team attractionId build…");

  // Load existing so this is resumable
  const out = await readJsonIfExists(dataPath("team_attraction_ids.json"), {});
  const misses = await readJsonIfExists(dataPath("team_attraction_misses.json"), []);
  const throttled = await readJsonIfExists(dataPath("team_attraction_throttled.json"), []);

  // Ensure league objects exist
  for (const league of Object.keys(TEAMS_BY_LEAGUE)) {
    if (!out[league] || typeof out[league] !== "object") out[league] = {};
  }

  // Conservative spacing to avoid 429 (you can increase once stable)
  const PER_TEAM_SPACING_MS = 1400;

  for (const league of Object.keys(TEAMS_BY_LEAGUE)) {
    const teams = TEAMS_BY_LEAGUE[league];

    for (const teamName of teams) {
      // Skip if already resolved
      if (out[league]?.[teamName]) continue;

      await sleep(PER_TEAM_SPACING_MS);

      const r = await searchAttraction(teamName, league);

      if (r?.throttled) {
        console.log(`THROTTLED  ${league}  ${teamName}`);
        throttled.push({ league, teamName, at: new Date().toISOString() });
        await writeProgress(out, misses, throttled);

        // Cooling off hard after throttling
        await sleep(30_000);
        continue;
      }

      if (!r?.id) {
        console.log(`MISS       ${league}  ${teamName}`);
        misses.push({ league, teamName, at: new Date().toISOString() });
        await writeProgress(out, misses, throttled);
        continue;
      }

      out[league][teamName] = r.id;
      console.log(`OK         ${league}  ${teamName}  -> ${r.id} (score ${r.bestScore})`);
      await writeProgress(out, misses, throttled);
    }
  }

  console.log("\nDone.");
  console.log(`Wrote ${dataPath("team_attraction_ids.json")}`);
  console.log(`Wrote ${dataPath("team_attraction_misses.json")}`);
  console.log(`Wrote ${dataPath("team_attraction_throttled.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});