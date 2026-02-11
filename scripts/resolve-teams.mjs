import fs from "fs";
import path from "path";

console.log("[resolve-teams] starting...");

function readEnvLocal(projectRoot) {
  const envPath = path.join(projectRoot, ".env.local");
  console.log("[resolve-teams] reading", envPath);
  if (!fs.existsSync(envPath)) return {};
  const text = fs.readFileSync(envPath, "utf8");
  const env = {};
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function scoreCandidate({ team, league }, c) {
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

async function resolveTeam({ apiKey, team, league, countryCode }) {
  const params = new URLSearchParams();
  params.set("apikey", apiKey);
  params.set("keyword", team);
  params.set("segmentName", "Sports");
  params.set("size", "20");
  if (countryCode) params.set("countryCode", countryCode);

  const url = `https://app.ticketmaster.com/discovery/v2/attractions.json?${params.toString()}`;

  const res = await fetch(url);
  const data = await res.json();

  const attractions = data?._embedded?.attractions || [];
  const candidates = attractions.map((a) => {
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

  const scored = candidates
    .map((c) => ({ ...c, score: scoreCandidate({ team, league }, c) }))
    .sort((a, b) => b.score - a.score);

  return scored;
}

async function main() {
  const projectRoot = process.cwd();
  console.log("[resolve-teams] projectRoot:", projectRoot);

  const env = readEnvLocal(projectRoot);
  const apiKey = env.TICKETMASTER_API_KEY;

  if (!apiKey) {
    console.error("[resolve-teams] ERROR: Missing TICKETMASTER_API_KEY in .env.local");
    process.exit(1);
  }

  const teamsPath = path.join(projectRoot, "app", "api", "options", "teams.json");
  console.log("[resolve-teams] reading teams:", teamsPath);

  if (!fs.existsSync(teamsPath)) {
    console.error("[resolve-teams] ERROR: teams.json not found:", teamsPath);
    process.exit(1);
  }

  const teams = JSON.parse(fs.readFileSync(teamsPath, "utf8"));
  console.log(`[resolve-teams] teams loaded: ${teams.length}`);

  const missing = teams.filter((t) => !t.attractionId);
  console.log(`[resolve-teams] missing attractionId: ${missing.length}`);

  const countryCode = "US,CA";

  const resolved = [];
  const unresolved = [];

  for (const t of teams) {
    if (t.attractionId) {
      resolved.push(t);
      continue;
    }

    const scored = await resolveTeam({
      apiKey,
      team: t.team,
      league: t.league,
      countryCode,
    });

    const top = scored[0];

    if (top?.id && top.score >= 60) {
      resolved.push({ ...t, attractionId: top.id });
      console.log(`[OK] ${t.league} — ${t.team} -> ${top.id} (${top.name}) score=${top.score}`);
    } else {
      resolved.push(t);
      unresolved.push({
        league: t.league,
        team: t.team,
        topCandidates: scored.slice(0, 5),
      });
      console.log(`[MISS] ${t.league} — ${t.team} (top score=${top?.score ?? 0})`);
    }

    await sleep(250);
  }

  const outResolvedPath = path.join(projectRoot, "app", "api", "options", "teams.resolved.json");
  const outUnresolvedPath = path.join(projectRoot, "scripts", "teams.unresolved.json");

  fs.writeFileSync(outResolvedPath, JSON.stringify(resolved, null, 2), "utf8");
  fs.writeFileSync(outUnresolvedPath, JSON.stringify(unresolved, null, 2), "utf8");

  console.log("[resolve-teams] wrote:", outResolvedPath);
  console.log("[resolve-teams] wrote:", outUnresolvedPath);
  console.log("[resolve-teams] done.");
}

main().catch((e) => {
  console.error("[resolve-teams] FATAL:", e);
  process.exit(1);
});
