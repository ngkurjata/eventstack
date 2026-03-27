import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const SEEDS_DIR = path.join(DATA_DIR, "team_seeds");
const OUT_DIR = path.join(DATA_DIR, "team_attraction_ids");
const OUT_IDS = path.join(DATA_DIR, "team_attraction_ids.json");
const OUT_MISSES = path.join(DATA_DIR, "team_attraction_misses.json");

const TM_API_BASE = "https://app.ticketmaster.com/discovery/v2/attractions.json";
const REQUEST_DELAY_MS = 300;
const RETRY_DELAY_MS = 1250;
const MAX_RETRIES = 4;
const PAGE_SIZE = 50;
const MIN_CONFIDENCE = 250;

const SUPPORTED_LEAGUES = new Set([
  "NHL",
  "NBA",
  "MLB",
  "NFL",
  "CFL",
  "MLS",
  "WNBA",
  "NWSL",
  "PWHL",
  "AHL",
  "ECHL",
  "WHL",
  "OHL",
  "QMJHL",
  "MiLB",
  "NCAA Football",
  "NCAA Basketball",
  "NCAA Baseball",
  "NCAA Hockey",
  "NCAA Soccer",
]);

const EXPECTED_SPORT_GENRE_BY_LEAGUE = {
  NHL: "Hockey",
  NBA: "Basketball",
  MLB: "Baseball",
  NFL: "Football",
  CFL: "Football",
  MLS: "Soccer",
  WNBA: "Basketball",
  NWSL: "Soccer",
  PWHL: "Hockey",
  AHL: "Hockey",
  ECHL: "Hockey",
  WHL: "Hockey",
  OHL: "Hockey",
  QMJHL: "Hockey",
  MiLB: "Baseball",
  "NCAA Football": "Football",
  "NCAA Basketball": "Basketball",
  "NCAA Baseball": "Baseball",
  "NCAA Hockey": "Hockey",
  "NCAA Soccer": "Soccer",
};

const LEAGUE_ALIASES = {
  nhl: "NHL",
  nba: "NBA",
  mlb: "MLB",
  nfl: "NFL",
  cfl: "CFL",
  mls: "MLS",
  wnba: "WNBA",
  nwsl: "NWSL",
  pwhl: "PWHL",
  ahl: "AHL",
  echl: "ECHL",
  whl: "WHL",
  ohl: "OHL",
  qmjhl: "QMJHL",
  milb: "MiLB",
  "minor-league-baseball": "MiLB",
  minorleaguebaseball: "MiLB",
  "ncaa-football": "NCAA Football",
  ncaafootball: "NCAA Football",
  "ncaa-basketball": "NCAA Basketball",
  ncaabasketball: "NCAA Basketball",
  "ncaa-baseball": "NCAA Baseball",
  ncaabaseball: "NCAA Baseball",
  "ncaa-hockey": "NCAA Hockey",
  ncaahockey: "NCAA Hockey",
  "ncaa-soccer": "NCAA Soccer",
  ncaasoccer: "NCAA Soccer",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function norm(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function slug(value) {
  return norm(value).replace(/\s+/g, "-");
}

function canonicalLeague(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (SUPPORTED_LEAGUES.has(raw)) return raw;

  const compact = norm(raw).replace(/\s+/g, "");
  const dashed = slug(raw);

  return (
    LEAGUE_ALIASES[compact] ||
    LEAGUE_ALIASES[dashed] ||
    LEAGUE_ALIASES[raw.toLowerCase()] ||
    null
  );
}

function titleFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  return canonicalLeague(base);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function uniqueObjectsByKey(values, keyFn) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

async function readEnvLocalFallback() {
  try {
    const raw = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function getApiKey() {
  if (process.env.TICKETMASTER_API_KEY) {
    return process.env.TICKETMASTER_API_KEY.trim();
  }
  const env = await readEnvLocalFallback();
  return String(env.TICKETMASTER_API_KEY || "").trim();
}

async function loadSeedFiles() {
  await ensureDir(SEEDS_DIR);
  const entries = await fs.readdir(SEEDS_DIR, { withFileTypes: true });
  const out = {};

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;

    const fullPath = path.join(SEEDS_DIR, entry.name);
    const json = await readJson(fullPath);

    if (Array.isArray(json)) {
  const league = titleFromFilename(entry.name);
  if (!league) {
    throw new Error(`Could not infer league from filename: ${entry.name}`);
  }

  const teamNames = json.map((team) => {
    if (typeof team === "string") return team;
    if (team && typeof team === "object" && typeof team.name === "string") {
      return team.name.trim();
    }
    throw new Error(`Invalid team entry in ${entry.name}: ${JSON.stringify(team)}`);
  });

  out[league] = uniqueStrings([...(out[league] || []), ...teamNames]);
  continue;
}

    if (json && typeof json === "object" && typeof json.league === "string" && Array.isArray(json.teams)) {
      const league = canonicalLeague(json.league);
      if (!league) {
        throw new Error(`Unsupported league in ${entry.name}: ${json.league}`);
      }
      out[league] = uniqueStrings([...(out[league] || []), ...json.teams]);
      continue;
    }

    if (json && typeof json === "object") {
      for (const [rawLeague, teams] of Object.entries(json)) {
        const league = canonicalLeague(rawLeague);
        if (!league) {
          throw new Error(`Unsupported league key in ${entry.name}: ${rawLeague}`);
        }
        if (!Array.isArray(teams)) {
          throw new Error(`Expected array of team names for ${rawLeague} in ${entry.name}`);
        }
        out[league] = uniqueStrings([...(out[league] || []), ...teams]);
      }
      continue;
    }

    throw new Error(`Unsupported JSON shape in ${entry.name}`);
  }

  const ordered = {};
  for (const league of Object.keys(out).sort()) {
    ordered[league] = out[league].sort((a, b) => a.localeCompare(b));
  }
  return ordered;
}

async function loadExistingIds() {
  try {
    const json = await readJson(OUT_IDS);
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}

function buildSearchVariants(teamName, league) {
  const raw = String(teamName || "").trim();
  const variants = new Set([raw]);

  const cleaned = raw
    .replace(/\bFC\b/gi, "")
    .replace(/\bCF\b/gi, "")
    .replace(/\bSC\b/gi, "")
    .replace(/\bHC\b/gi, "")
    .replace(/\bClub\b/gi, "")
    .replace(/\bFootball Club\b/gi, "")
    .replace(/\bHockey Club\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned && cleaned.toLowerCase() !== raw.toLowerCase()) {
    variants.add(cleaned);
  }

  if (league.startsWith("NCAA")) {
    variants.add(`${raw} athletics`);
    variants.add(`${raw} ${EXPECTED_SPORT_GENRE_BY_LEAGUE[league]}`);
    variants.add(
      raw
        .replace(/\bUniversity\b/gi, "U")
        .replace(/\bState University\b/gi, "State")
        .replace(/\bCollege\b/gi, "")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  if (["MLS", "NWSL"].includes(league)) variants.add(`${raw} soccer`);
  if (["NBA", "WNBA", "NCAA Basketball"].includes(league)) variants.add(`${raw} basketball`);
  if (["NFL", "CFL", "NCAA Football"].includes(league)) variants.add(`${raw} football`);
  if (["MLB", "MiLB", "NCAA Baseball"].includes(league)) variants.add(`${raw} baseball`);
  if (["NHL", "PWHL", "AHL", "ECHL", "WHL", "OHL", "QMJHL", "NCAA Hockey"].includes(league)) {
    variants.add(`${raw} hockey`);
  }

  return uniqueStrings([...variants]);
}

async function fetchJson(url, attempt = 1) {
  const res = await fetch(url, { headers: { accept: "application/json" } });

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= MAX_RETRIES) {
      const text = await res.text().catch(() => "");
      throw new Error(`TM fetch failed (${res.status}): ${text}`);
    }
    await sleep(RETRY_DELAY_MS * attempt);
    return fetchJson(url, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TM fetch failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function searchAttractions(apiKey, keyword) {
  const url = new URL(TM_API_BASE);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("sort", "name,asc");
  const json = await fetchJson(url.toString());
  return Array.isArray(json?._embedded?.attractions) ? json._embedded.attractions : [];
}

function getClassifications(attraction) {
  const list = Array.isArray(attraction?.classifications) ? attraction.classifications : [];
  return list.map((c) => ({
    segment: String(c?.segment?.name || "").trim(),
    genre: String(c?.genre?.name || "").trim(),
    subGenre: String(c?.subGenre?.name || "").trim(),
  }));
}

function isSportsAttraction(attraction) {
  return getClassifications(attraction).some((c) => norm(c.segment) === "sports");
}

function matchesExpectedGenre(attraction, expectedGenre) {
  if (!expectedGenre) return true;
  const wanted = norm(expectedGenre);
  return getClassifications(attraction).some((c) => {
    const genre = norm(c.genre);
    const subGenre = norm(c.subGenre);
    return genre === wanted || subGenre === wanted;
  });
}

function candidateDisplay(attraction) {
  return {
    name: String(attraction?.name || "").trim(),
    id: String(attraction?.id || "").trim(),
    classifications: getClassifications(attraction)
      .map((c) => [c.segment, c.genre, c.subGenre].filter(Boolean).join(" / "))
      .filter(Boolean)
      .join(" | "),
  };
}

function scoreCandidate(attraction, teamName, league, expectedGenre) {
  let score = 0;
  const attractionName = String(attraction?.name || "").trim();
  const attractionNorm = norm(attractionName);
  const teamNorm = norm(teamName);

  if (!attraction?.id) score -= 1000;
  if (!isSportsAttraction(attraction)) score -= 500;
  if (matchesExpectedGenre(attraction, expectedGenre)) score += 250;
  else score -= 250;

  if (attractionNorm === teamNorm) score += 1000;
  if (attractionNorm.includes(teamNorm)) score += 300;
  if (teamNorm.includes(attractionNorm)) score += 120;

  const teamTokens = new Set(teamNorm.split(" ").filter(Boolean));
  const attractionTokens = new Set(attractionNorm.split(" ").filter(Boolean));
  let overlap = 0;
  for (const token of teamTokens) {
    if (attractionTokens.has(token)) overlap += 1;
  }
  score += overlap * 40;

  if (league.startsWith("NCAA")) {
    if (/\bcollege\b|\buniversity\b|\bathletics\b|\bstate\b/i.test(attractionName)) {
      score += 25;
    }
  }

  return score;
}

async function searchCandidates(apiKey, teamName, league) {
  const variants = buildSearchVariants(teamName, league);
  const all = [];

  for (const variant of variants) {
    await sleep(REQUEST_DELAY_MS);
    const rows = await searchAttractions(apiKey, variant);
    all.push(...rows);
  }

  return uniqueObjectsByKey(all, (row) => String(row?.id || row?.name || ""));
}

function chooseBestCandidate(candidates, teamName, league) {
  const expectedGenre = EXPECTED_SPORT_GENRE_BY_LEAGUE[league] || null;

  const sportsOnly = candidates.filter(isSportsAttraction);
  const genreFiltered = sportsOnly.filter((row) => matchesExpectedGenre(row, expectedGenre));
  const pool = genreFiltered.length ? genreFiltered : sportsOnly.length ? sportsOnly : candidates;

  const scored = pool
    .map((row) => ({
      row,
      score: scoreCandidate(row, teamName, league, expectedGenre),
    }))
    .sort((a, b) => b.score - a.score);

  return {
    best: scored[0] || null,
    top: scored.slice(0, 5).map((item) => ({
      score: item.score,
      ...candidateDisplay(item.row),
    })),
  };
}

function makeMissRow(league, teamName, reason, top = []) {
  return { league, teamName, reason, topCandidates: top };
}

async function writePerLeagueFiles(allIds) {
  await ensureDir(OUT_DIR);
  for (const [league, map] of Object.entries(allIds)) {
    const filePath = path.join(OUT_DIR, `${slug(league)}.json`);
    await writeJsonAtomic(filePath, { [league]: map });
  }
}

async function main() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("Missing TICKETMASTER_API_KEY in environment or .env.local");
  }

  await ensureDir(DATA_DIR);
  await ensureDir(SEEDS_DIR);
  await ensureDir(OUT_DIR);

  const seedsByLeague = await loadSeedFiles();
  const existingIds = await loadExistingIds();

  const output = {};
  const misses = [];

  for (const league of Object.keys(seedsByLeague).sort()) {
    output[league] = { ...(existingIds[league] || {}) };
    const teams = seedsByLeague[league];

    console.log(`\n=== ${league} (${teams.length}) ===`);

    for (let i = 0; i < teams.length; i += 1) {
      const teamName = teams[i];
      const already = String(output[league]?.[teamName] || "").trim();

      if (already) {
        console.log(`[${league}] ${i + 1}/${teams.length} keep ${teamName} -> ${already}`);
        continue;
      }

      try {
        console.log(`[${league}] ${i + 1}/${teams.length} resolving ${teamName}`);
        const candidates = await searchCandidates(apiKey, teamName, league);

        if (!candidates.length) {
          misses.push(makeMissRow(league, teamName, "no_candidates", []));
          console.log("  miss: no candidates");
          continue;
        }

        const { best, top } = chooseBestCandidate(candidates, teamName, league);

        if (!best?.row?.id) {
          misses.push(makeMissRow(league, teamName, "no_viable_match", top));
          console.log("  miss: no viable match");
          continue;
        }

        const bestId = String(best.row.id).trim();
        const bestScore = Number(best.score || 0);

        if (bestScore < MIN_CONFIDENCE) {
          misses.push(makeMissRow(league, teamName, "low_confidence", top));
          console.log(`  miss: low confidence (${bestScore})`);
          continue;
        }

        output[league][teamName] = bestId;
        console.log(`  ok: ${teamName} -> ${bestId} (${bestScore})`);

        await writeJsonAtomic(OUT_IDS, output);
        await writeJsonAtomic(OUT_MISSES, misses);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        misses.push(makeMissRow(league, teamName, `error: ${message}`, []));
        console.log(`  error: ${message}`);
        await writeJsonAtomic(OUT_MISSES, misses);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  const orderedOutput = {};
  for (const league of Object.keys(output).sort()) {
    orderedOutput[league] = {};
    for (const teamName of Object.keys(output[league]).sort((a, b) => a.localeCompare(b))) {
      orderedOutput[league][teamName] = output[league][teamName];
    }
  }

  const orderedMisses = misses.sort((a, b) =>
    `${a.league} ${a.teamName}`.toLowerCase().localeCompare(`${b.league} ${b.teamName}`.toLowerCase())
  );

  await writeJsonAtomic(OUT_IDS, orderedOutput);
  await writeJsonAtomic(OUT_MISSES, orderedMisses);
  await writePerLeagueFiles(orderedOutput);

  const resolvedCount = Object.values(orderedOutput).reduce(
    (sum, leagueMap) => sum + Object.keys(leagueMap).length,
    0
  );

  console.log(`\nDone.`);
  console.log(`Resolved: ${resolvedCount}`);
  console.log(`Misses:   ${orderedMisses.length}`);
  console.log(`Wrote:    ${path.relative(ROOT, OUT_IDS)}`);
  console.log(`Wrote:    ${path.relative(ROOT, OUT_MISSES)}`);
  console.log(`Wrote:    ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
  console.error("\nFatal error:");
  console.error(err);
  process.exit(1);
});