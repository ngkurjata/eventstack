// FILE: lib/favorites/resolve.ts

import fs from "node:fs";
import path from "node:path";

import type { Favorite, FavoriteKind } from "@/lib/favorites/types";

import artistOptionsJson from "@/data/artist_options.json";
import teamAttractionIdsJson from "@/data/team_attraction_ids.json";
import teamsMasterJson from "@/data/teams_master.json";

type TeamMasterRow = {
  league: string;
  teamName: string;
};

type TeamAttractionIds = Record<string, Record<string, string>>;

type ArtistOptionRow = {
  id?: string;
  label?: string;
  genres?: string[];
};

export type FavoriteSearchKind = FavoriteKind;

export type FavoriteSearchOption = {
  key: string;
  label: string;
  kind: FavoriteSearchKind;
  rawName: string;
  defaultGenre?: string;
  attractionId?: string;
  league?: string;
  score?: number;
  source?: "local" | "live";
};

type EnrichQueueItem = {
  name: string;
  id?: string;
  sourceQuery?: string;
  discoveredAt: string;
  status?: "pending" | "merged" | "failed";
};

type ArtistEnrichQueue = {
  version: 1;
  updatedAt: string;
  items: EnrichQueueItem[];
};

type TmAttraction = {
  id?: string;
  name?: string;
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
    type?: { name?: string };
    subType?: { name?: string };
  }>;
};

type TmAttractionsResponse = {
  _embedded?: {
    attractions?: TmAttraction[];
  };
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const ENRICH_QUEUE_PATH = path.join(DATA_DIR, "artist_enrich_queue.json");

const TM_API_KEY = process.env.TM_API_KEY || process.env.TICKETMASTER_API_KEY;
const TM_BASE = "https://app.ticketmaster.com/discovery/v2/attractions.json";
const TM_COUNTRY_CODE = "US,CA";

const teamAttractionIds = teamAttractionIdsJson as TeamAttractionIds;
const teamsMaster = (teamsMasterJson as TeamMasterRow[]) || [];
const artistOptions = (artistOptionsJson as ArtistOptionRow[]) || [];

function normalizeName(input: string) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function canonicalizeArtistName(input: string) {
  return normalizeName(input)
    .replace(/\b(official|tickets?|live|tour)\b/g, " ")
    .replace(/\b(uk|us|usa|canada|ca|au|australia)\b$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstGenre(genres?: string[]) {
  return Array.isArray(genres) && genres.length ? genres[0] : "Music";
}

function uniqueByKey<T>(items: T[], getKey: (item: T) => string) {
  const out: T[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function scoreStringMatch(query: string, candidate: string) {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1000;
  if (c.startsWith(q)) return 850;
  if (q.startsWith(c)) return 800;

  const qTokens = q.split(/\s+/).filter(Boolean);
  const cTokens = c.split(/\s+/).filter(Boolean);

  let score = 0;

  if (c.includes(q)) score += 500;
  if (qTokens.every((t) => c.includes(t))) score += 250;

  const exactTokenMatches = qTokens.filter((t) => cTokens.includes(t)).length;
  score += exactTokenMatches * 40;

  const startsWithTokenMatches = qTokens.filter((t) =>
    cTokens.some((ct) => ct.startsWith(t)),
  ).length;
  score += startsWithTokenMatches * 25;

  score -= Math.abs(c.length - q.length);

  return score;
}

function buildArtistLocalOptions(): FavoriteSearchOption[] {
  return artistOptions
    .map((row) => {
      const id = String(row.id || "").trim();
      const label = String(row.label || "").trim();
      if (!id || !label) return null;

      return {
        key: `artist:${id}`,
        label,
        kind: "artist" as const,
        rawName: label,
        defaultGenre: firstGenre(row.genres),
        attractionId: id,
        source: "local" as const,
      };
    })
    .filter(Boolean) as FavoriteSearchOption[];
}

function buildTeamLocalOptions(): FavoriteSearchOption[] {
  const byNormTeam = new Map<
    string,
    { league: string; teamName: string; attractionId: string }
  >();

  for (const [league, teams] of Object.entries(teamAttractionIds || {})) {
    for (const [teamName, attractionId] of Object.entries(teams || {})) {
      const label = String(teamName || "").trim();
      const id = String(attractionId || "").trim();
      if (!label || !id) continue;

      byNormTeam.set(normalizeName(label), {
        league,
        teamName: label,
        attractionId: id,
      });
    }
  }

  for (const row of teamsMaster) {
    const league = String(row.league || "").trim();
    const teamName = String(row.teamName || "").trim();
    if (!league || !teamName) continue;

    const attractionId = teamAttractionIds?.[league]?.[teamName];
    if (!attractionId) continue;

    byNormTeam.set(normalizeName(teamName), {
      league,
      teamName,
      attractionId,
    });
  }

  return Array.from(byNormTeam.values()).map((x) => ({
    key: `team:${x.league}:${x.attractionId}`,
    label: x.teamName,
    kind: "team" as const,
    rawName: x.teamName,
    defaultGenre: x.league,
    attractionId: x.attractionId,
    league: x.league,
    source: "local" as const,
  }));
}

const LOCAL_ARTIST_OPTIONS = buildArtistLocalOptions();
const LOCAL_TEAM_OPTIONS = buildTeamLocalOptions();

function dedupeArtistOptionsByCanonicalName(
  items: FavoriteSearchOption[],
): FavoriteSearchOption[] {
  const byCanonical = new Map<string, FavoriteSearchOption>();

  for (const item of items) {
    const canonical = canonicalizeArtistName(item.label);
    const fallback = normalizeName(item.label);
    const key = canonical || fallback || String(item.attractionId || "").trim();
    if (!key) continue;

    const existing = byCanonical.get(key);
    if (!existing) {
      byCanonical.set(key, item);
      continue;
    }

    const existingScore = Number(existing.score || 0);
    const itemScore = Number(item.score || 0);

    if (itemScore > existingScore) {
      byCanonical.set(key, item);
      continue;
    }

    if (itemScore < existingScore) {
      continue;
    }

    if ((existing.source || "") !== (item.source || "")) {
      if (existing.source === "local") continue;
      if (item.source === "local") {
        byCanonical.set(key, item);
        continue;
      }
    }

    if (item.label.length < existing.label.length) {
      byCanonical.set(key, item);
      continue;
    }

    if (item.label.localeCompare(existing.label) < 0) {
      byCanonical.set(key, item);
    }
  }

  return Array.from(byCanonical.values());
}

function rankLocalOptions(
  query: string,
  kind: FavoriteSearchKind,
  limit = 8,
): FavoriteSearchOption[] {
  const source = kind === "team" ? LOCAL_TEAM_OPTIONS : LOCAL_ARTIST_OPTIONS;

  const scored = source
    .map((opt) => ({
      ...opt,
      score: scoreStringMatch(query, opt.label),
    }))
    .filter((opt) => (opt.score || 0) > 0)
    .sort((a, b) => {
      const byScore = (b.score || 0) - (a.score || 0);
      if (byScore !== 0) return byScore;
      return a.label.localeCompare(b.label);
    });

  if (kind === "team") {
    return uniqueByKey(
      scored,
      (x) => `${x.kind}:${x.league}:${x.attractionId}`,
    ).slice(0, limit);
  }

  return dedupeArtistOptionsByCanonicalName(scored).slice(0, limit);
}

function shouldUseArtistLiveFallback(
  query: string,
  local: FavoriteSearchOption[],
) {
  if (!query.trim()) return false;
  if (!local.length) return true;

  const q = normalizeName(query);
  const top = local[0];
  const topNorm = normalizeName(top.label);
  const topScore = Number(top.score || 0);

  if (topNorm === q) return false;
  if (topScore >= 900) return false;

  if (topScore < 700) return true;
  if (local.length < 3) return true;

  return false;
}

function isArtistLikeAttraction(a: TmAttraction) {
  const classes = Array.isArray(a.classifications) ? a.classifications : [];
  const segmentNames = classes
    .map((c) => String(c.segment?.name || "").trim().toLowerCase())
    .filter(Boolean);

  const genreNames = classes
    .flatMap((c) => [
      c.genre?.name,
      c.subGenre?.name,
      c.type?.name,
      c.subType?.name,
    ])
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);

  const all = [...segmentNames, ...genreNames].join(" ");

  if (segmentNames.includes("sports")) return false;
  if (
    /\b(nhl|nfl|nba|wnba|mlb|milb|cfl|ncaa|soccer|football|baseball|basketball|hockey|lacrosse|racing|golf|tennis|boxing|mma|ufc|wwe)\b/.test(
      all,
    )
  ) {
    return false;
  }

  return true;
}

function attractionGenres(a: TmAttraction) {
  const out = new Set<string>();

  for (const c of a.classifications || []) {
    for (const v of [
      c.genre?.name,
      c.subGenre?.name,
      c.type?.name,
      c.subType?.name,
    ]) {
      const s = String(v || "").trim();
      if (!s) continue;
      if (/^(undefined|miscellaneous|artist|individual|group)$/i.test(s)) continue;
      out.add(s);
    }
  }

  return Array.from(out);
}

function isLikelyTributeOrVariantArtist(
  option: FavoriteSearchOption,
  query: string,
) {
  const labelNorm = normalizeName(option.label);
  const queryNorm = normalizeName(query);
  const genreNorm = normalizeName(option.defaultGenre || "");

  if (labelNorm === queryNorm) return false;

  if (
    /\b(tribute|tribute band|experience|cover|covers|revue|vs|featuring|feat)\b/.test(
      labelNorm,
    )
  ) {
    return true;
  }

  if (/\b(tribute|tribute band)\b/.test(genreNorm)) {
    return true;
  }

  if (labelNorm === `${queryNorm} uk`) {
    return true;
  }

  if (labelNorm.startsWith(`the ${queryNorm} `)) {
    return true;
  }

  return false;
}

function cleanupArtistSearchResults(
  query: string,
  items: FavoriteSearchOption[],
): FavoriteSearchOption[] {
  const exactNorm = normalizeName(query);
  const hasExact = items.some((x) => normalizeName(x.label) === exactNorm);

  let filtered = [...items];

  if (hasExact) {
    filtered = filtered.filter((x) => !isLikelyTributeOrVariantArtist(x, query));
  }

  filtered = dedupeArtistOptionsByCanonicalName(filtered);

  return filtered.sort((a, b) => {
    const byScore = (b.score || 0) - (a.score || 0);
    if (byScore !== 0) return byScore;

    if (a.source !== b.source) {
      return a.source === "local" ? -1 : 1;
    }

    return a.label.localeCompare(b.label);
  });
}

async function searchLiveArtistOptions(
  query: string,
  limit = 8,
): Promise<FavoriteSearchOption[]> {
  if (!TM_API_KEY || !query.trim()) return [];

  const qs = new URLSearchParams();
  qs.set("apikey", TM_API_KEY);
  qs.set("keyword", query.trim());
  qs.set("size", "25");
  qs.set("sort", "name,asc");
  qs.set("countryCode", TM_COUNTRY_CODE);

  const res = await fetch(`${TM_BASE}?${qs.toString()}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return [];
  }

  const data = (await res.json()) as TmAttractionsResponse;
  const items = data._embedded?.attractions || [];

  const scored: FavoriteSearchOption[] = [];

  for (const a of items) {
    const id = String(a.id || "").trim();
    const label = String(a.name || "").trim();
    if (!id || !label) continue;
    if (!isArtistLikeAttraction(a)) continue;

    const score = scoreStringMatch(query, label);

    scored.push({
      key: `artist:${id}`,
      label,
      kind: "artist",
      rawName: label,
      defaultGenre: firstGenre(attractionGenres(a)),
      attractionId: id,
      score,
      source: "live",
    });
  }

  return cleanupArtistSearchResults(
    query,
    uniqueByKey(
      scored
        .filter((x) => (x.score || 0) > 0)
        .sort((a, b) => {
          const byScore = (b.score || 0) - (a.score || 0);
          if (byScore !== 0) return byScore;
          return a.label.localeCompare(b.label);
        }),
      (x) => String(x.attractionId || normalizeName(x.label)),
    ),
  ).slice(0, limit);
}

function readEnrichQueue(): ArtistEnrichQueue {
  try {
    if (!fs.existsSync(ENRICH_QUEUE_PATH)) {
      return { version: 1, updatedAt: new Date().toISOString(), items: [] };
    }
    return JSON.parse(
      fs.readFileSync(ENRICH_QUEUE_PATH, "utf8"),
    ) as ArtistEnrichQueue;
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), items: [] };
  }
}

function writeEnrichQueue(queue: ArtistEnrichQueue) {
  try {
    fs.mkdirSync(path.dirname(ENRICH_QUEUE_PATH), { recursive: true });
    fs.writeFileSync(
      ENRICH_QUEUE_PATH,
      JSON.stringify(queue, null, 2) + "\n",
      "utf8",
    );
  } catch {
    // swallow write failures so autocomplete/resolve still works in readonly envs
  }
}

function queueArtistForEnrichment(
  option: FavoriteSearchOption,
  sourceQuery: string,
) {
  if (option.kind !== "artist") return;
  if (!option.label || !option.attractionId) return;

  const localMatch = LOCAL_ARTIST_OPTIONS.find(
    (x) =>
      x.attractionId === option.attractionId ||
      canonicalizeArtistName(x.label) === canonicalizeArtistName(option.label),
  );
  if (localMatch) return;

  const queue = readEnrichQueue();
  const exists = queue.items.some(
    (x) =>
      (x.id && x.id === option.attractionId) ||
      canonicalizeArtistName(x.name) === canonicalizeArtistName(option.label),
  );
  if (exists) return;

  queue.items.push({
    name: option.label,
    id: option.attractionId,
    sourceQuery,
    discoveredAt: new Date().toISOString(),
    status: "pending",
  });
  queue.updatedAt = new Date().toISOString();

  writeEnrichQueue(queue);
}

export async function searchFavoriteOptions(
  q: string,
  kind: FavoriteSearchKind,
  limit = 8,
): Promise<FavoriteSearchOption[]> {
  const query = String(q || "").trim();
  if (!query) return [];

  const local = rankLocalOptions(query, kind, limit);

  if (kind !== "artist") {
    return local.slice(0, limit);
  }

  if (!shouldUseArtistLiveFallback(query, local)) {
    return cleanupArtistSearchResults(query, local).slice(0, limit);
  }

  const live = await searchLiveArtistOptions(query, limit);

  for (const item of live) {
    queueArtistForEnrichment(item, query);
  }

  const combined = cleanupArtistSearchResults(
    query,
    uniqueByKey(
      [...local, ...live].sort((a, b) => {
        const byScore = (b.score || 0) - (a.score || 0);
        if (byScore !== 0) return byScore;

        if (a.source !== b.source) {
          return a.source === "local" ? -1 : 1;
        }

        return a.label.localeCompare(b.label);
      }),
      (x) =>
        x.kind === "team"
          ? `${x.kind}:${x.league}:${x.attractionId}`
          : `${x.kind}:${x.attractionId || normalizeName(x.label)}`,
    ),
  );

  return combined.slice(0, limit);
}

export async function resolveFavorite(
  input: string,
  kind: FavoriteSearchKind,
): Promise<Favorite | null> {
  const query = String(input || "").trim();
  if (!query) return null;

  const results = await searchFavoriteOptions(query, kind, 8);
  if (!results.length) return null;

  const qNorm = normalizeName(query);

  const exact =
    results.find((x) => normalizeName(x.label) === qNorm) ||
    results.find((x) => normalizeName(x.rawName) === qNorm);

  const best = exact || results[0];
  if (!best?.attractionId) return null;

  if (best.kind === "artist") {
    queueArtistForEnrichment(best, query);
  }

  return {
    id: best.key,
    label: best.label,
    kind: best.kind,
    attractionId: best.attractionId,
    defaultGenre:
      best.defaultGenre ||
      (best.kind === "team" ? best.league || "Sports" : "Music"),
  };
}