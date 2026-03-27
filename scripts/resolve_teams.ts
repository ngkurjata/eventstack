import fs from "fs";
import path from "path";

console.log("[resolve-teams] starting...");

function readEnvLocal(projectRoot: string) {
  const envPath = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) return {};

  const text = fs.readFileSync(envPath, "utf8");
  const env: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    env[key] = val;
  }

  return env;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function norm(value: unknown) {
  return String(value || "").trim();
}

function scoreCandidate(
  { team, league }: { team: string; league: string },
  c: any
) {
  const name = String(c?.name || "");
  const nameLc = name.toLowerCase();
  const teamLc = team.toLowerCase();

  let score = 0;

  if (nameLc === teamLc) score += 120;
  if (nameLc.includes(teamLc)) score += 50;

  const subGenre = String(c?.subGenre || "").toLowerCase();
  const genre = String(c?.genre || "").toLowerCase();

  if (subGenre === league.toLowerCase()) score += 40;
  if (subGenre.includes(league.toLowerCase())) score += 20;

  if (league === "MLB" && genre.includes("baseball")) score += 20;
  if (league === "NHL" && genre.includes("hockey")) score += 20;
  if (league === "NBA" && genre.includes("basketball")) score += 20;
  if (league === "NFL" && genre.includes("football")) score += 20;
  if (league === "MLS" && genre.includes("soccer")) score += 20;
  if (league === "CFL" && genre.includes("football")) score += 10;

  return score;
}

async function resolveTeam({
  apiKey,
  team,
  league,
}: {
  apiKey: string;
  team: string;
  league: string;
}) {
  const params = new URLSearchParams();
  params.set("apikey", apiKey);
  params.set("keyword", team);
  params.set("segmentName", "Sports");
  params.set("size", "20");
  params.set("countryCode", "US,CA");

  const url = `https://app.ticketmaster.com/discovery/v2/attractions.json?${params.toString()}`;

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TM fetch failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const attractions = data?._embedded?.attractions || [];

  const candidates = attractions.map((a: any) => {
    const seg = a?.classifications?.[0]?.segment?.name || null;
    const genre = a?.classifications?.[0]?.genre?.name || null;
    const subGenre = a?.classifications?.[0]?.subGenre?.name || null;

    return {
      id: a?.id || null,
      name: a?.name || "",
      segment: seg,
      genre,
      subGenre,
      url: a?.url || null,
    };
  });

  return candidates
    .map((c: any) => ({
      ...c,
      score: scoreCandidate({ team, league }, c),
    }))
    .sort((a: any, b: any) => b.score - a.score);
}

type SeedRow = {
  teamName: string;
  aliases?: string[];
};

function extractTeamName(value: unknown, fallbackKey?: string): string {
  if (typeof value === "string") return norm(value);

  if (!value || typeof value !== "object") {
    return norm(fallbackKey);
  }

  const row = value as Record<string, unknown>;

  return norm(
    row.teamName ??
      row.label ??
      row.name ??
      row.team ??
      fallbackKey
  );
}

function readSeedFile(filePath: string): SeedRow[] {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const out: SeedRow[] = [];
  const seen = new Set<string>();

  function pushTeam(teamName: string, aliases?: string[]) {
    const team = norm(teamName);
    if (!team) return;

    const key = team.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    out.push({
      teamName: team,
      aliases:
        Array.isArray(aliases) && aliases.length
          ? aliases
              .map((a) => norm(a))
              .filter(Boolean)
          : undefined,
    });
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        pushTeam(item);
        continue;
      }

      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const teamName = extractTeamName(row);
        const aliases = Array.isArray(row.aliases)
          ? row.aliases.map((a) => norm(a)).filter(Boolean)
          : undefined;
        pushTeam(teamName, aliases);
      }
    }

    return out;
  }

  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string") {
        pushTeam(key);
        continue;
      }

      if (value && typeof value === "object") {
        const row = value as Record<string, unknown>;
        const teamName = extractTeamName(row, key);
        const aliases = Array.isArray(row.aliases)
          ? row.aliases.map((a) => norm(a)).filter(Boolean)
          : undefined;
        pushTeam(teamName, aliases);
        continue;
      }

      pushTeam(key);
    }
  }

  return out;
}

async function processLeague({
  apiKey,
  league,
  seedPath,
  outputPath,
}: {
  apiKey: string;
  league: string;
  seedPath: string;
  outputPath: string;
}) {
  console.log(`\n[${league}] processing...`);

  const teams = readSeedFile(seedPath);
  console.log(`[${league}] seeds loaded: ${teams.length}`);

  const results: Record<
    string,
    {
      teamName: string;
      attractionId: string;
      aliases?: string[];
    }
  > = {};

  const misses: Array<{
    league: string;
    teamName: string;
    reason: string;
    topCandidates: any[];
  }> = [];

  for (let i = 0; i < teams.length; i++) {
    const row = teams[i];
    const teamName = row.teamName;

    console.log(`[${league}] ${i + 1}/${teams.length} resolving ${teamName}`);

    try {
      const scored = await resolveTeam({
        apiKey,
        team: teamName,
        league,
      });

      const top = scored[0];

      if (top?.id && top.score >= 60) {
        results[teamName] = {
          teamName,
          attractionId: top.id,
          ...(row.aliases?.length ? { aliases: row.aliases } : {}),
        };
        console.log(`  ok: ${teamName} -> ${top.name} (${top.id})`);
      } else {
        misses.push({
          league,
          teamName,
          reason: top ? `low_score_${top.score}` : "no_candidates",
          topCandidates: scored.slice(0, 5),
        });
        console.log(`  miss: ${teamName}`);
      }
    } catch (err: any) {
      misses.push({
        league,
        teamName,
        reason: String(err?.message || err || "unknown_error"),
        topCandidates: [],
      });
      console.log(`  error: ${teamName} -> ${String(err?.message || err)}`);
    }

    await sleep(300);
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");

  const missesPath = outputPath.replace(/\.json$/i, ".misses.json");
  fs.writeFileSync(missesPath, JSON.stringify(misses, null, 2), "utf8");

  console.log(`[${league}] wrote: ${outputPath}`);
  console.log(`[${league}] wrote: ${missesPath}`);
  console.log(`[${league}] resolved: ${Object.keys(results).length}`);
  console.log(`[${league}] misses:   ${misses.length}`);
}

async function main() {
  const projectRoot = process.cwd();
  const env = readEnvLocal(projectRoot);
  const apiKey = env.TICKETMASTER_API_KEY;

  if (!apiKey) {
    console.error("Missing TICKETMASTER_API_KEY in .env.local");
    process.exit(1);
  }

  const seedsDir = path.join(projectRoot, "data", "team_seeds");
  const outDir = path.join(projectRoot, "data", "team_attraction_ids");

  if (!fs.existsSync(seedsDir)) {
    console.error("Missing seeds dir:", seedsDir);
    process.exit(1);
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

const leagues = ["nhl", "nfl", "cfl", "nba", "mlb", "mls"];

  for (const leagueKey of leagues) {
    const seedPath = path.join(seedsDir, `${leagueKey}.json`);
    const outputPath = path.join(outDir, `${leagueKey}.json`);

    if (!fs.existsSync(seedPath)) {
      console.log(`[skip] missing seed file: ${seedPath}`);
      continue;
    }

    await processLeague({
      apiKey,
      league: leagueKey.toUpperCase(),
      seedPath,
      outputPath,
    });
  }

  console.log("\n[resolve-teams] DONE");
}

main().catch((e) => {
  console.error("[resolve-teams] FATAL:", e);
  process.exit(1);
});