// FILE: scripts/resolve_artists.ts

import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";

const ROOT = process.cwd();
const ENV_PATH = path.resolve(ROOT, ".env.local");

dotenv.config({ path: ENV_PATH });

const TM_API_KEY = (
  process.env.TICKETMASTER_API_KEY ||
  process.env.TM_API_KEY ||
  process.env.NEXT_PUBLIC_TM_API_KEY ||
  ""
).trim();

if (!TM_API_KEY) {
  console.error("❌ Missing Ticketmaster API key");
  console.error(`Looked in: ${ENV_PATH}`);
  process.exit(1);
}

const INPUT_PATH = path.resolve("data/artist_retry_candidates.json");
const OUTPUT_PATH = path.resolve("data/artist_seeds.json");
const MISSES_PATH = path.resolve("data/artist_misses.json");

const REQUEST_DELAY_MS = 1000;
const RETRY_BASE_DELAY_MS = 15000;
const RETRY_MAX_DELAY_MS = 90000;
const MAX_RETRIES_PER_ARTIST = 4;
const STOP_AFTER_CONSECUTIVE_429S = 3;

type ArtistCandidate = {
  label: string;
  kind: "artist";
  category: string;
  primaryGenre: string;
  searchText: string;
  rank?: number;
};

type ResolvedArtist = ArtistCandidate & {
  attractionId: string;
};

type MissedArtist = ArtistCandidate & {
  reason: string;
  topCandidates?: Array<{
    id: string;
    name: string;
    segment?: string;
    genre?: string;
    subGenre?: string;
    score?: number;
    ticketmasterEvents?: number;
  }>;
};

type TMAttraction = {
  id?: string;
  name?: string;
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
  }>;
  upcomingEvents?: {
    ticketmaster?: number;
    _total?: number;
    [key: string]: unknown;
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number) {
  const swing = Math.floor(ms * 0.2);
  return ms + Math.floor(Math.random() * (swing * 2 + 1)) - swing;
}

function norm(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown) {
  return norm(value).replace(/\s+/g, "");
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out;
}

function getPrimaryClassification(attraction: TMAttraction) {
  const classifications = safeArray<
    { segment?: { name?: string }; genre?: { name?: string }; subGenre?: { name?: string } }
  >(attraction.classifications);

  const first = classifications[0];

  return {
    segment: first?.segment?.name || "",
    genre: first?.genre?.name || "",
    subGenre: first?.subGenre?.name || "",
  };
}

function getTicketmasterEventCount(attraction: TMAttraction) {
  const count = attraction.upcomingEvents?.ticketmaster;
  return Number.isFinite(count) ? Number(count) : 0;
}

function isProbablyPerformerCandidate(attraction: TMAttraction) {
  const { segment, genre, subGenre } = getPrimaryClassification(attraction);

  const s = norm(segment);
  const g = norm(genre);
  const sg = norm(subGenre);

  if (g === "comedy" || sg === "comedy") return true;

  if (s && s !== "music" && s !== "arts theatre" && s !== "miscellaneous") {
    return false;
  }

  const badGenreTokens = new Set([
    "theatre",
    "theater",
    "musical",
    "festival",
    "fair festival",
    "event style",
    "multimedia",
    "lecture seminar",
    "podcast",
    "film",
    "fine art",
    "family",
    "holiday",
    "magic",
    "miscellaneous",
  ]);

  if (badGenreTokens.has(g) || badGenreTokens.has(sg)) return false;

  return true;
}

function scoreAttraction(candidate: ArtistCandidate, attraction: TMAttraction) {
  const label = String(candidate.label || "").trim();
  const targetNorm = norm(label);
  const targetCompact = compact(label);
  const searchNorm = norm(candidate.searchText || label);

  const name = String(attraction.name || "").trim();
  const nameNorm = norm(name);
  const nameCompact = compact(name);

  if (!name || !attraction.id) return -9999;
  if (!isProbablyPerformerCandidate(attraction)) return -9999;

  let score = 0;

  if (nameNorm === targetNorm) score += 240;
  else if (nameCompact === targetCompact) score += 220;
  else if (searchNorm && nameNorm === searchNorm) score += 210;
  else if (searchNorm && compact(searchNorm) === nameCompact) score += 190;
  else if (nameNorm.startsWith(targetNorm)) score += 120;
  else if (nameNorm.includes(targetNorm)) score += 80;
  else if (searchNorm && nameNorm.startsWith(searchNorm)) score += 110;
  else if (searchNorm && nameNorm.includes(searchNorm)) score += 60;

  const category = norm(candidate.category);
  const primaryGenre = norm(candidate.primaryGenre);
  const { segment, genre, subGenre } = getPrimaryClassification(attraction);
  const segNorm = norm(segment);
  const genreNorm = norm(genre);
  const subGenreNorm = norm(subGenre);

  if (category === "music" && segNorm === "music") score += 40;

  if (category === "comedy") {
    if (genreNorm === "comedy" || subGenreNorm === "comedy") {
      score += 120;
    }
  }

  if (primaryGenre) {
    if (genreNorm === primaryGenre) score += 35;
    else if (subGenreNorm === primaryGenre) score += 25;
    else if (genreNorm.includes(primaryGenre) || subGenreNorm.includes(primaryGenre)) {
      score += 10;
    }
  }

  const badNameBits = [
    "tribute",
    "vs",
    "theme night",
    "party",
    "festival",
    "karaoke",
    "orchestra performs",
    "playing the music of",
    "experience",
    "vip",
    "parking",
    "club",
    "night",
    "live band",
    "songs of",
    "the music of",
    "featuring",
  ];

  for (const token of badNameBits) {
    if (nameNorm.includes(token)) score -= 120;
  }

  // Prefer attractions that actually have Ticketmaster events.
  const eventCount = getTicketmasterEventCount(attraction);
  if (eventCount > 0) {
    score += Math.min(120, eventCount);
  } else {
    score -= 200;
  }

  return score;
}

function topCandidatesForMiss(
  candidate: ArtistCandidate,
  attractions: TMAttraction[]
): MissedArtist["topCandidates"] {
  return attractions
    .map((a) => {
      const cls = getPrimaryClassification(a);
      return {
        id: String(a.id || ""),
        name: String(a.name || ""),
        segment: cls.segment || undefined,
        genre: cls.genre || undefined,
        subGenre: cls.subGenre || undefined,
        score: scoreAttraction(candidate, a),
        ticketmasterEvents: getTicketmasterEventCount(a),
      };
    })
    .sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.ticketmasterEvents || 0) - (a.ticketmasterEvents || 0);
    })
    .slice(0, 5);
}

function isStrongEnoughMatch(
  candidate: ArtistCandidate,
  attraction: TMAttraction,
  score: number
) {
  const name = String(attraction.name || "").trim();
  const label = String(candidate.label || "").trim();

  const nameNorm = norm(name);
  const labelNorm = norm(label);
  const nameCompact = compact(name);
  const labelCompact = compact(label);

  const { segment, genre, subGenre } = getPrimaryClassification(attraction);
  const segNorm = norm(segment);
  const genreNorm = norm(genre);
  const subGenreNorm = norm(subGenre);
  const category = norm(candidate.category);

  const eventCount = getTicketmasterEventCount(attraction);
  if (eventCount === 0) return false;

  const exactName = nameNorm === labelNorm || nameCompact === labelCompact;

  // Rule 1: exact match + correct segment wins
  if (exactName) {
    if (category === "music" && segNorm === "music") return true;
    if (category === "comedy" && (genreNorm === "comedy" || subGenreNorm === "comedy")) {
      return true;
    }
    return false;
  }

  // Rule 2: reject dangerous partial matches
  const isShortName = labelNorm.length <= 6;
  const startsWithButNotExact = nameNorm.startsWith(labelNorm) && nameNorm !== labelNorm;

  if (isShortName || startsWithButNotExact) {
    return false;
  }

  // Rule 3: reject obvious junk / tribute / title-like candidates
  const badPatterns = [
    "tribute",
    "songs of",
    "experience",
    "the music of",
    "featuring",
    "vs",
    "karaoke",
    "orchestra",
    "play",
    "theme night",
    "party",
    "festival",
  ];

  for (const bad of badPatterns) {
    if (nameNorm.includes(bad)) return false;
  }

  // Rule 4: only allow strong longer-name matches with real events
  if (score >= 140) {
    if (category === "music" && segNorm === "music") return true;
    if (category === "comedy" && (genreNorm === "comedy" || subGenreNorm === "comedy")) {
      return true;
    }
  }

  return false;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchAttractions(keyword: string) {
  const url = new URL("https://app.ticketmaster.com/discovery/v2/attractions.json");
  url.searchParams.set("apikey", String(TM_API_KEY));
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("size", "50");
  url.searchParams.set("sort", "name,asc");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const text = await response.text();

  if (!response.ok) {
    const error = new Error(`TM fetch failed (${response.status}): ${text}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return JSON.parse(text);
}

async function fetchWithRetry(keyword: string) {
  let attempt = 0;

  while (true) {
    try {
      return await fetchAttractions(keyword);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      attempt += 1;

      if (status !== 429 || attempt > MAX_RETRIES_PER_ARTIST) throw error;

      const delay = Math.min(
        RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1),
        RETRY_MAX_DELAY_MS
      );

      console.log(`  429 hit; retrying in ${Math.round(delay / 1000)}s...`);
      await sleep(jitter(delay));
    }
  }
}

async function fetchCandidatesForArtist(candidate: ArtistCandidate) {
  const queries = uniqueStrings([candidate.searchText, candidate.label]);

  const merged: TMAttraction[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const data = await fetchWithRetry(query);
    const attractions = safeArray<TMAttraction>(data?._embedded?.attractions);

    for (const attraction of attractions) {
      const id = String(attraction?.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(attraction);
    }

    await sleep(jitter(250));
  }

  return merged;
}

async function main() {
  const candidates = await readJsonFile<ArtistCandidate[]>(INPUT_PATH, []);
  const existingResolved = await readJsonFile<ResolvedArtist[]>(OUTPUT_PATH, []);
  const existingMisses = await readJsonFile<MissedArtist[]>(MISSES_PATH, []);

  const resolvedMap = new Map<string, ResolvedArtist>();
  const missMap = new Map<string, MissedArtist>();

  for (const row of existingResolved) resolvedMap.set(norm(row.label), row);
  for (const row of existingMisses) missMap.set(norm(row.label), row);

  const pending = candidates.filter((candidate) => {
    const key = norm(candidate.label);
    if (resolvedMap.has(key)) return false;

    const priorMiss = missMap.get(key);
    if (!priorMiss) return true;
    if (String(priorMiss.reason || "").startsWith("error:")) return true;
    if (priorMiss.reason === "no_confident_match") return true;
    return false;
  });

  console.log(`Using env: ${ENV_PATH}`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Already resolved: ${resolvedMap.size}`);
  console.log(`Already missed: ${missMap.size}`);
  console.log(`Pending: ${pending.length}`);

  let consecutive429s = 0;
  let processedThisRun = 0;

  for (const candidate of pending) {
    processedThisRun += 1;
    const key = norm(candidate.label);

    console.log(`[${processedThisRun}/${pending.length}] resolving ${candidate.label}`);

    try {
      const attractions = await fetchCandidatesForArtist(candidate);
      consecutive429s = 0;

      const scored = attractions
        .map((a) => ({
          attraction: a,
          score: scoreAttraction(candidate, a),
          ticketmasterEvents: getTicketmasterEventCount(a),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return b.ticketmasterEvents - a.ticketmasterEvents;
        });

      const best = scored[0];

      if (
        !best ||
        !best.attraction.id ||
        !best.attraction.name ||
        !isStrongEnoughMatch(candidate, best.attraction, best.score)
      ) {
        missMap.set(key, {
          ...candidate,
          reason: "no_confident_match",
          topCandidates: topCandidatesForMiss(candidate, attractions),
        });
        console.log("  miss: no confident match");
      } else {
        resolvedMap.set(key, {
          ...candidate,
          attractionId: String(best.attraction.id),
        });
        missMap.delete(key);
        console.log(
          `  ok: ${candidate.label} -> ${best.attraction.name} (${best.attraction.id}) [tm=${best.ticketmasterEvents}]`
        );
      }

      await writeJsonFile(
        OUTPUT_PATH,
        Array.from(resolvedMap.values()).sort((a, b) => a.label.localeCompare(b.label))
      );

      await writeJsonFile(
        MISSES_PATH,
        Array.from(missMap.values()).sort((a, b) => a.label.localeCompare(b.label))
      );

      await sleep(jitter(REQUEST_DELAY_MS));
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      const message = error instanceof Error ? error.message : String(error);

      if (status === 429) {
        consecutive429s += 1;
        console.log(`  429: ${message}`);

        if (consecutive429s >= STOP_AFTER_CONSECUTIVE_429S) {
          console.log(`Stopped after ${consecutive429s} consecutive 429 responses.`);
          break;
        }

        const pauseMs = jitter(60000);
        console.log(`  cooling off for ${Math.round(pauseMs / 1000)}s...`);
        await sleep(pauseMs);
        processedThisRun -= 1;
        continue;
      }

      console.log(`  error: ${message}`);
      missMap.set(key, { ...candidate, reason: `error:${message}` });

      await writeJsonFile(
        MISSES_PATH,
        Array.from(missMap.values()).sort((a, b) => a.label.localeCompare(b.label))
      );

      await sleep(jitter(REQUEST_DELAY_MS));
    }
  }

  console.log("");
  console.log("Done.");
  console.log(`Resolved total: ${resolvedMap.size}`);
  console.log(`Misses total: ${missMap.size}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});