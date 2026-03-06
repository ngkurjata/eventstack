// FILE: scripts/build_team_attraction_ids.mjs
import fs from "fs/promises";
import path from "path";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_ATTRACTIONS = `${TM_BASE}/attractions.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

if (!TM_KEY) {
  console.error("Missing TICKETMASTER_API_KEY in environment.");
  process.exit(1);
}

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

const DATA_DIR = path.join(process.cwd(), "data");
const OUT_PATH = path.join(DATA_DIR, "team_attraction_ids.json");
const MISSES_PATH = path.join(DATA_DIR, "team_attraction_misses.json");

/**
 * Hard filters per league:
 * - Segment MUST be "Sports"
 * - Genre MUST match expected sport type
 */
const EXPECTED_SPORT_GENRE_BY_LEAGUE = {
  NHL: "Hockey",
  NBA: "Basketball",
  MLB: "Baseball",
  NFL: "Football",
  MLS: "Soccer",
  CFL: "Football",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms, pct = 0.25) {
  const delta = ms * pct;
  const j = (Math.random() * 2 - 1) * delta;
  return Math.max(0, Math.floor(ms + j));
}

function stripDiacritics(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeName(s) {
  return stripDiacritics(String(s || ""))
    .replace(/[’']/g, "'")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLower(s) {
  return normalizeName(s).toLowerCase();
}

function makeKeywordVariants(teamName) {
  const base = normalizeName(teamName);

  const variants = new Set();
  variants.add(base);

  // Common cleanup for soccer teams etc.
  variants.add(base.replace(/\bFC\b/gi, "").replace(/\s+/g, " ").trim());
  variants.add(base.replace(/\bSC\b/gi, "").replace(/\s+/g, " ").trim());
  variants.add(base.replace(/\bCITY\b/gi, "").replace(/\s+/g, " ").trim());
  variants.add(base.replace(/\bCF\b/gi, "").replace(/\s+/g, " ").trim());
  variants.add(base.replace(/\bD\.C\.\b/gi, "DC").replace(/\s+/g, " ").trim());

  // Drop first token sometimes helps
  const parts = base.split(" ");
  if (parts.length >= 2) variants.add(parts.slice(1).join(" "));

  if (parts.length >= 3) variants.add(parts.slice(-2).join(" "));

  return Array.from(variants).filter(Boolean);
}

function getClassification(c) {
  const cls = c?.classifications?.[0] || {};
  const segment = cls?.segment?.name ? String(cls.segment.name).trim() : "";
  const genre = cls?.genre?.name ? String(cls.genre.name).trim() : "";
  const subGenre = cls?.subGenre?.name ? String(cls.subGenre.name).trim() : "";
  const type = cls?.type?.name ? String(cls.type.name).trim() : "";
  return { segment, genre, subGenre, type };
}

function passesHardSportsFilter(candidate, league) {
  const expectedGenre = EXPECTED_SPORT_GENRE_BY_LEAGUE[league] || "";
  const { segment, genre } = getClassification(candidate);

  // Must be Sports segment
  if (normalizeLower(segment) !== "sports") return false;

  // Must match expected sport genre (baseball/hockey/etc)
  if (expectedGenre) {
    if (normalizeLower(genre) !== normalizeLower(expectedGenre)) return false;
  }

  return true;
}

function scoreCandidate(candidate, teamName) {
  const name = normalizeLower(candidate?.name || "");
  const target = normalizeLower(teamName);

  let score = 0;

  // Name match is now the main differentiator
  if (name === target) score += 1000;
  if (name.includes(target)) score += 250;

  // Word overlap bonus
  const tWords = new Set(target.split(" ").filter(Boolean));
  const nWords = new Set(name.split(" ").filter(Boolean));
  let overlap = 0;
  for (const w of tWords) if (nWords.has(w)) overlap++;
  score += overlap * 40;

  // Prefer classifications that look like a Team
  const { type } = getClassification(candidate);
  if (normalizeLower(type).includes("team")) score += 40;

  return score;
}

async function safeReadJsonIfExists(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  await fs.rename(tmp, filePath);
}

async function fetchJsonWithRetry(url, { tries = 8, baseDelayMs = 650 } = {}) {
  let lastErr = null;

  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store" });

      if (res.status === 429) {
        const ra = res.headers.get("retry-after");
        const retryAfterMs = ra ? Math.max(0, Number(ra) * 1000) : 0;
        const backoff = Math.min(20000, baseDelayMs * Math.pow(2, attempt - 1));
        const wait = jitter(Math.max(retryAfterMs, backoff));
        console.log(`429 rate-limited. Waiting ${wait}ms (attempt ${attempt}/${tries})`);
        await sleep(wait);
        continue;
      }

      if (res.status >= 500) {
        const backoff = Math.min(15000, baseDelayMs * Math.pow(2, attempt - 1));
        const wait = jitter(backoff);
        console.log(`${res.status} server error. Waiting ${wait}ms (attempt ${attempt}/${tries})`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 200)}`);
      }

      return await res.json();
    } catch (e) {
      lastErr = e;
      const backoff = Math.min(12000, baseDelayMs * Math.pow(2, attempt - 1));
      const wait = jitter(backoff);
      console.log(`Fetch failed: ${String(e?.message || e)}. Waiting ${wait}ms (attempt ${attempt}/${tries})`);
      await sleep(wait);
    }
  }

  throw lastErr || new Error("fetchJsonWithRetry failed");
}

async function searchAttraction(teamName, league) {
  const variants = makeKeywordVariants(teamName);

  let best = null;
  let bestScore = -Infinity;

  for (const keyword of variants) {
    const u = new URL(TM_ATTRACTIONS);
    u.searchParams.set("apikey", TM_KEY);
    u.searchParams.set("keyword", keyword);
    u.searchParams.set("size", "30");

    const json = await fetchJsonWithRetry(u.toString(), { tries: 8, baseDelayMs: 650 }).catch(() => null);
    const items = json?._embedded?.attractions || [];
    if (!Array.isArray(items) || items.length === 0) continue;

    // HARD FILTER: sports-only + correct sport genre for league
    const filtered = items.filter((c) => passesHardSportsFilter(c, league));
    if (filtered.length === 0) continue;

    for (const c of filtered) {
      const s = scoreCandidate(c, teamName);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }

    // If we got a very confident exact-name hit, stop early
    if (bestScore >= 1000) break;
  }

  const id = best?.id ? String(best.id) : null;
  if (!id) return null;

  const cls = getClassification(best);

  return {
    id,
    bestName: best?.name || null,
    bestScore,
    bestClassifications: cls,
  };
}

async function main() {
  console.log("Starting team attractionId build…");

  // Resume prior run if exists
  const existing = await safeReadJsonIfExists(OUT_PATH, {});
  const out = (existing && typeof existing === "object") ? existing : {};

  const missesExisting = await safeReadJsonIfExists(MISSES_PATH, []);
  const misses = Array.isArray(missesExisting) ? missesExisting : [];

  const missKey = (m) => `${m.league}::${m.teamName}`;
  const missSet = new Set(misses.map(missKey));

  let baseDelay = 350;

  for (const league of Object.keys(TEAMS_BY_LEAGUE)) {
    if (!out[league] || typeof out[league] !== "object") out[league] = {};

    for (const teamName of TEAMS_BY_LEAGUE[league]) {
      if (out[league]?.[teamName]) {
        console.log(`SKIP  ${league}  ${teamName}  (already have ${out[league][teamName]})`);
        continue;
      }

      await sleep(jitter(baseDelay));

      const r = await searchAttraction(teamName, league);

      if (!r?.id) {
        console.log(`MISS  ${league}  ${teamName}`);
        const key = missKey({ league, teamName });
        if (!missSet.has(key)) {
          missSet.add(key);
          misses.push({ league, teamName });
        }

        baseDelay = Math.min(1200, Math.floor(baseDelay * 1.05));
      } else {
        out[league][teamName] = r.id;
        console.log(
          `OK    ${league}  ${teamName}  -> ${r.id} (score ${r.bestScore}) [${r.bestClassifications.segment} / ${r.bestClassifications.genre}]`
        );

        baseDelay = Math.max(250, Math.floor(baseDelay * 0.98));
      }

      await writeJsonAtomic(OUT_PATH, out);
      await writeJsonAtomic(MISSES_PATH, misses);
    }
  }

  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`Wrote ${MISSES_PATH} (${misses.length} misses)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});