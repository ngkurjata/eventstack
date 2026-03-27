import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";

type TMAttraction = {
  id: string;
  name: string;
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
  }>;
  upcomingEvents?: { _total?: number };
};

type TMResponse = {
  _embedded?: {
    attractions?: TMAttraction[];
  };
};

const ROOT = process.cwd();

const SEARCH_TERMS = [
  "Utah Mammoth",
  "Utah Mammoth",
  "Utah Mammoth",
];

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bArizona Coyotes\b/g, "Utah Mammoth"],
  [/\bUtah Hockey Club\b/g, "Utah Mammoth"],
];

const FILE_GLOBS = [
  "data",
  "lib",
  "app",
  "components",
  "scripts",
];

const TEXT_FILE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".cjs",
]);

function getApiKey(): string {
  const key =
    process.env.TICKETMASTER_API_KEY ||
    process.env.TM_API_KEY ||
    process.env.NEXT_PUBLIC_TICKETMASTER_API_KEY;

  if (!key) {
    throw new Error(
      "Missing Ticketmaster API key. Expected TICKETMASTER_API_KEY or TM_API_KEY or NEXT_PUBLIC_TICKETMASTER_API_KEY in env."
    );
  }
  return key;
}

async function fetchAttractions(keyword: string, apiKey: string): Promise<TMAttraction[]> {
  const url = new URL("https://app.ticketmaster.com/discovery/v2/attractions.json");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("size", "25");

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TM fetch failed (${res.status}) for "${keyword}": ${text}`);
  }

  const json = (await res.json()) as TMResponse;
  return json._embedded?.attractions ?? [];
}

function lc(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function isSports(a: TMAttraction) {
  return a.classifications?.some((c) => lc(c.segment?.name) === "sports") ?? false;
}

function mentionsHockey(a: TMAttraction) {
  const vals = [
    ...((a.classifications ?? []).map((c) => c.genre?.name ?? "")),
    ...((a.classifications ?? []).map((c) => c.subGenre?.name ?? "")),
    a.name,
  ].map(lc);

  return vals.some((v) => v.includes("hockey") || v.includes("nhl"));
}

function scoreCandidate(a: TMAttraction) {
  const name = lc(a.name);
  let score = 0;

  if (/^K/i.test(a.id)) score += 100;
  if (isSports(a)) score += 40;
  if (mentionsHockey(a)) score += 30;

  if (name === "utah mammoth") score += 1000;
  else if (name.includes("utah mammoth")) score += 500;
  else if (name === "utah hockey club") score += 250;
  else if (name.includes("utah hockey")) score += 150;
  else if (name === "arizona coyotes") score += 50;

  score += Math.min(a.upcomingEvents?._total ?? 0, 50);

  return score;
}

async function resolveUtahMammothId(apiKey: string): Promise<TMAttraction> {
  const all: TMAttraction[] = [];

  for (const term of SEARCH_TERMS) {
    const rows = await fetchAttractions(term, apiKey);
    all.push(...rows);
  }

  const deduped = new Map<string, TMAttraction>();
  for (const row of all) {
    if (!row?.id) continue;
    if (!deduped.has(row.id)) deduped.set(row.id, row);
  }

  const candidates = [...deduped.values()]
    .filter((a) => /^K/i.test(a.id) || lc(a.name).includes("utah") || lc(a.name).includes("coyotes"))
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

  if (!candidates.length) {
    throw new Error("No Ticketmaster candidates found for Utah Mammoth / Utah Mammoth / Utah Mammoth.");
  }

  const best = candidates[0];

  console.log("\nTop candidates:");
  for (const c of candidates.slice(0, 10)) {
    console.log(
      `- ${c.name} | ${c.id} | sports=${isSports(c)} | hockey=${mentionsHockey(c)} | upcoming=${c.upcomingEvents?._total ?? 0} | score=${scoreCandidate(c)}`
    );
  }

  if (!/^K/i.test(best.id)) {
    throw new Error(
      `Best candidate did not resolve to a K-style Discovery attraction ID: ${best.name} -> ${best.id}`
    );
  }

  return best;
}

function walk(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "build"
      ) {
        continue;
      }
      walk(full, out);
      continue;
    }

    if (TEXT_FILE_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }

  return out;
}

function replaceAcrossCodebase() {
  const files = FILE_GLOBS.flatMap((p) => walk(path.join(ROOT, p)));
  const changed: string[] = [];

  for (const file of files) {
    let text = fs.readFileSync(file, "utf8");
    const original = text;

    for (const [pattern, next] of REPLACEMENTS) {
      text = text.replace(pattern, next);
    }

    if (text !== original) {
      fs.writeFileSync(file, text, "utf8");
      changed.push(path.relative(ROOT, file));
    }
  }

  return changed;
}

function tryUpdateJsonFile(filePath: string, newId: string) {
  if (!fs.existsSync(filePath)) return false;

  const raw = fs.readFileSync(filePath, "utf8");
  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch {
    console.warn(`Could not parse JSON: ${path.relative(ROOT, filePath)}`);
    return false;
  }

  let changed = false;

  function visit(node: any) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if ("Utah Mammoth" in node) {
      delete node["Utah Mammoth"];
      changed = true;
    }

    if ("Utah Mammoth" in node) {
      delete node["Utah Mammoth"];
      changed = true;
    }

    if (node["Utah Mammoth"] !== newId) {
      node["Utah Mammoth"] = newId;
      changed = true;
    }

    for (const value of Object.values(node)) visit(value);
  }

  visit(json);

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n", "utf8");
  }

  return changed;
}

function tryUpdateNhlSeedFile(filePath: string) {
  if (!fs.existsSync(filePath)) return false;

  let text = fs.readFileSync(filePath, "utf8");
  const original = text;

  for (const [pattern, next] of REPLACEMENTS) {
    text = text.replace(pattern, next);
  }

  if (text !== original) {
    fs.writeFileSync(filePath, text, "utf8");
    return true;
  }

  return false;
}

function mainFilesToTry() {
  return {
    attractionIds: [
      path.join(ROOT, "data", "team_attraction_ids.json"),
    ],
    misses: [
      path.join(ROOT, "data", "team_attraction_misses.json"),
    ],
    nhlSeeds: [
      path.join(ROOT, "data", "team_seeds", "nhl.ts"),
      path.join(ROOT, "data", "team_seeds", "nhl.json"),
      path.join(ROOT, "data", "nhl.ts"),
      path.join(ROOT, "data", "nhl.json"),
    ],
  };
}

async function main() {
  const apiKey = getApiKey();

  console.log("Resolving Ticketmaster Utah Mammoth attraction ID...");
  const best = await resolveUtahMammothId(apiKey);

  console.log(`\nChosen candidate: ${best.name} -> ${best.id}\n`);

  const replacedFiles = replaceAcrossCodebase();

  const targets = mainFilesToTry();

  const attractionUpdated = targets.attractionIds.some((p) => tryUpdateJsonFile(p, best.id));
  const nhlSeedUpdated = targets.nhlSeeds.some((p) => tryUpdateNhlSeedFile(p));

  for (const missFile of targets.misses) {
    if (!fs.existsSync(missFile)) continue;
    let text = fs.readFileSync(missFile, "utf8");
    const original = text;
    text = text.replace(/\bArizona Coyotes\b/g, "Utah Mammoth");
    text = text.replace(/\bUtah Hockey Club\b/g, "Utah Mammoth");
    if (text !== original) fs.writeFileSync(missFile, text, "utf8");
  }

  console.log("Updated text references in:");
  for (const f of replacedFiles) {
    console.log(`- ${f}`);
  }

  console.log("\nStructured updates:");
  console.log(`- team_attraction_ids.json updated: ${attractionUpdated}`);
  console.log(`- NHL seed file updated: ${nhlSeedUpdated}`);

  console.log("\nDone.");
  console.log(`Final TM attraction ID for Utah Mammoth: ${best.id}`);
}

main().catch((err) => {
  console.error("\nFAILED:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});