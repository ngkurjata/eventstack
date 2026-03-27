// FILE: scripts/build-artist-options.ts
/* eslint-disable no-console */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import { normalizeGenres } from "../lib/events/genres";

type ArtistOptionRow = {
  id: string;
  label: string;
  genres: string[];
};

type SeedIndexEntry = {
  fetchedAt: string;
  itemCount: number;
  pageCount: number;
  exhausted: boolean;
  lastMode: "full" | "refresh" | "lookup";
};

type ArtistSeedIndex = {
  version: 1;
  updatedAt: string;
  seeds: Record<string, SeedIndexEntry>;
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
  upcomingEvents?: unknown;
};

type TmAttractionsResponse = {
  _embedded?: {
    attractions?: TmAttraction[];
  };
  page?: {
    size?: number;
    totalElements?: number;
    totalPages?: number;
    number?: number;
  };
};

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const ARTIST_OPTIONS_PATH = path.join(DATA_DIR, "artist_options.json");
const SEED_INDEX_PATH = path.join(DATA_DIR, "artist_seed_index.json");
const ENRICH_QUEUE_PATH = path.join(DATA_DIR, "artist_enrich_queue.json");

const API_KEY = process.env.TM_API_KEY || process.env.TICKETMASTER_API_KEY;
console.log("Has API key:", Boolean(API_KEY));
const TM_BASE = "https://app.ticketmaster.com/discovery/v2/attractions.json";
const DEFAULT_COUNTRY_CODE = "US,CA";

// include digits so artists like 070 Shake / 2 Chainz remain discoverable
const DEFAULT_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";

// keep page * size < 1000
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 4;
const DEFAULT_STALE_DAYS = 30;

function nowIso() {
  return new Date().toISOString();
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function normalizeArtistName(input: string) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function firstCanonicalVisibleGenre(values?: string[]) {
  const normalized = normalizeGenres(Array.isArray(values) ? values : [], 2);
  return normalized[0] || "";
}

function looksLikeEventTitle(label: string) {
  const l = String(label || "").trim().toLowerCase();
  if (!l) return true;

  return (
    l.length > 90 ||
    /\b(outing|scramble|tournament|showcase|expo|fair|festival|summit|conference|seminar|clinic|camp|meet and greet)\b/.test(
      l
    ) ||
    /\b(hotel package|package|upsell|vip|reservation|admission|upgrade)\b/.test(
      l
    ) ||
    /\bmini golf\b/.test(l) ||
    /\bgolf club\b/.test(l) ||
    /\bbridal\b/.test(l) ||
    /\bwedding show\b/.test(l) ||
    /\bopen house\b/.test(l)
  );
}

function isTributeOrVariant(label: string, genres: string[]) {
  const l = String(label || "").trim().toLowerCase();
  const g = (genres || []).join(" ").toLowerCase();

  return (
    /\btribute\b/.test(g) ||
    /\btribute\b/.test(l) ||
    /\bcover\b/.test(l) ||
    /\bexperience\b/.test(l) ||
    /\brevue\b/.test(l) ||
    /\bfeaturing\b/.test(l) ||
    /\bfeat\b/.test(l)
  );
}

function isSportsLikeAttraction(a: TmAttraction) {
  const classes = Array.isArray(a.classifications) ? a.classifications : [];

  const values = classes
    .flatMap((c) => [
      c.segment?.name,
      c.genre?.name,
      c.subGenre?.name,
      c.type?.name,
      c.subType?.name,
    ])
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);

  const blob = values.join(" ");

  return (
    /\b(sports|nhl|nfl|nba|wnba|mlb|milb|cfl|ncaa|soccer|football|baseball|basketball|hockey|lacrosse|racing|golf|tennis|boxing|mma|ufc|wwe)\b/.test(
      blob
    )
  );
}

function attractionGenres(a: TmAttraction) {
  const out = new Set<string>();

  for (const c of a.classifications || []) {
    for (const v of [
      c.segment?.name,
      c.genre?.name,
      c.subGenre?.name,
      c.type?.name,
      c.subType?.name,
    ]) {
      const s = String(v || "").trim();
      if (!s) continue;
      if (/^(undefined|miscellaneous|artist|individual|group|other)$/i.test(s)) {
        continue;
      }
      out.add(s);
    }
  }

  return Array.from(out);
}

function isArtistLikeAttraction(a: TmAttraction) {
  if (isSportsLikeAttraction(a)) return false;

  const genres = attractionGenres(a);
  const canonicalGenre = firstCanonicalVisibleGenre(genres);

  // this is the important gate:
  // if it does not map to one of your app's visible genres, reject it
  if (!canonicalGenre) return false;

  return true;
}

function attractionToRow(a: TmAttraction): ArtistOptionRow | null {
  const id = String(a.id || "").trim();
  const label = String(a.name || "").trim();
  if (!id || !label) return null;

  const genres = attractionGenres(a);

  if (!isArtistLikeAttraction(a)) return null;
  if (looksLikeEventTitle(label)) return null;
  if (isTributeOrVariant(label, genres)) return null;

  return {
    id,
    label,
    genres,
  };
}

function dedupeArtistRows(rows: ArtistOptionRow[]) {
  const byId = new Map<string, ArtistOptionRow>();
  const byNorm = new Map<string, ArtistOptionRow>();

  for (const row of rows) {
    const id = String(row.id || "").trim();
    const label = String(row.label || "").trim();
    if (!id || !label) continue;

    const norm = normalizeArtistName(label);
    const existingById = byId.get(id);
    const existingByNorm = byNorm.get(norm);

    if (existingById) {
      const mergedGenres = new Set([...(existingById.genres || []), ...(row.genres || [])]);
      byId.set(id, {
        ...existingById,
        label: existingById.label.length >= label.length ? existingById.label : label,
        genres: Array.from(mergedGenres).sort(),
      });
      continue;
    }

    if (existingByNorm) {
      const mergedGenres = new Set([...(existingByNorm.genres || []), ...(row.genres || [])]);
      const preferred = existingByNorm.label.length <= label.length ? existingByNorm : row;

      const merged: ArtistOptionRow = {
        id: preferred.id,
        label: preferred.label,
        genres: Array.from(mergedGenres).sort(),
      };

      byNorm.set(norm, merged);
      byId.set(merged.id, merged);
      continue;
    }

    const clean: ArtistOptionRow = {
      id,
      label,
      genres: Array.from(new Set(row.genres || [])).sort(),
    };

    byId.set(id, clean);
    byNorm.set(norm, clean);
  }

  return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
}

async function tmFetchAttractions(
  keyword: string,
  page: number,
  size = DEFAULT_PAGE_SIZE,
  countryCode = DEFAULT_COUNTRY_CODE
): Promise<TmAttractionsResponse> {
  if (!API_KEY) {
    throw new Error("Missing TM_API_KEY or TICKETMASTER_API_KEY");
  }

  const qs = new URLSearchParams();
  qs.set("apikey", API_KEY);
  qs.set("keyword", keyword);
  qs.set("page", String(page));
  qs.set("size", String(size));
  qs.set("sort", "name,asc");

  if (countryCode.trim()) {
    qs.set("countryCode", countryCode);
  }

  const url = `${TM_BASE}?${qs.toString()}`;
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TM attractions fetch failed (${res.status}): ${text}`);
  }

  return (await res.json()) as TmAttractionsResponse;
}

async function fetchSeedRows(
  seed: string,
  maxPages = DEFAULT_MAX_PAGES,
  pageSize = DEFAULT_PAGE_SIZE
) {
  const out: ArtistOptionRow[] = [];
  let pagesFetched = 0;
  let exhausted = false;

  for (let page = 0; page < maxPages; page += 1) {
    const data = await tmFetchAttractions(seed, page, pageSize);
    pagesFetched += 1;

    const attractions = data._embedded?.attractions || [];
    for (const a of attractions) {
      const row = attractionToRow(a);
      if (row) out.push(row);
    }

    const totalPages = Number(data.page?.totalPages || 0);
    if (!totalPages || page >= totalPages - 1) {
      exhausted = true;
      break;
    }
  }

  return {
    rows: dedupeArtistRows(out),
    pageCount: pagesFetched,
    exhausted,
  };
}

async function lookupArtistRows(name: string) {
  const attempts = [name.trim()];
  const found: ArtistOptionRow[] = [];

  for (const q of attempts) {
    const data = await tmFetchAttractions(q, 0, 50);
    const attractions = data._embedded?.attractions || [];

    for (const a of attractions) {
      const row = attractionToRow(a);
      if (!row) continue;

      const qNorm = normalizeArtistName(name);
      const rowNorm = normalizeArtistName(row.label);

      if (
        rowNorm === qNorm ||
        rowNorm.startsWith(qNorm) ||
        rowNorm.includes(qNorm) ||
        qNorm.includes(rowNorm)
      ) {
        found.push(row);
      }
    }
  }

  return dedupeArtistRows(found);
}

function loadArtistOptions() {
  return readJsonFile<ArtistOptionRow[]>(ARTIST_OPTIONS_PATH, []);
}

function saveArtistOptions(rows: ArtistOptionRow[]) {
  writeJsonFile(ARTIST_OPTIONS_PATH, dedupeArtistRows(rows));
}

function loadSeedIndex() {
  return readJsonFile<ArtistSeedIndex>(SEED_INDEX_PATH, {
    version: 1,
    updatedAt: nowIso(),
    seeds: {},
  });
}

function saveSeedIndex(index: ArtistSeedIndex) {
  index.updatedAt = nowIso();
  writeJsonFile(SEED_INDEX_PATH, index);
}

function loadEnrichQueue() {
  return readJsonFile<ArtistEnrichQueue>(ENRICH_QUEUE_PATH, {
    version: 1,
    updatedAt: nowIso(),
    items: [],
  });
}

function saveEnrichQueue(queue: ArtistEnrichQueue) {
  queue.updatedAt = nowIso();
  writeJsonFile(ENRICH_QUEUE_PATH, queue);
}

function mergeRowsIntoArtistOptions(rows: ArtistOptionRow[]) {
  const existing = loadArtistOptions();
  const merged = dedupeArtistRows([...existing, ...rows]);
  saveArtistOptions(merged);
  return merged;
}

function markQueueItemsMerged(mergedRows: ArtistOptionRow[]) {
  if (!mergedRows.length) return;

  const mergedIds = new Set(mergedRows.map((r) => String(r.id || "").trim()));
  const mergedNorms = new Set(
    mergedRows.map((r) => normalizeArtistName(String(r.label || "")))
  );

  const queue = loadEnrichQueue();
  let changed = false;

  queue.items = queue.items.map((item) => {
    const itemNorm = normalizeArtistName(item.name);
    if ((item.id && mergedIds.has(item.id)) || mergedNorms.has(itemNorm)) {
      changed = true;
      return { ...item, status: "merged" };
    }
    return item;
  });

  if (changed) saveEnrichQueue(queue);
}

function buildSeeds(charset = DEFAULT_CHARSET) {
  const chars = charset.split("");
  const seeds = new Set<string>();

  for (const c of chars) seeds.add(c);
  for (const a of chars) {
    for (const b of chars) {
      seeds.add(`${a}${b}`);
    }
  }

  return Array.from(seeds);
}

function daysOld(iso: string | undefined) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function parseArgs(argv: string[]) {
  const parts = [...argv];
  const mode = (parts[0] || "full").toLowerCase() as "full" | "refresh" | "lookup";

  let lookup = "";
  if (mode === "lookup") {
    lookup = parts.slice(1).join(" ").trim();
  }

  const flags = new Map<string, string>();
  for (const part of parts) {
    if (!part.startsWith("--")) continue;
    const idx = part.indexOf("=");
    if (idx >= 0) {
      flags.set(part.slice(2, idx), part.slice(idx + 1));
    } else {
      flags.set(part.slice(2), "true");
    }
  }

  return {
    mode,
    lookup,
    limitSeeds: Number(flags.get("limit-seeds") || 0),
    staleDays: Number(flags.get("stale-days") || DEFAULT_STALE_DAYS),
    maxPages: Number(flags.get("pages") || DEFAULT_MAX_PAGES),
    pageSize: Number(flags.get("size") || DEFAULT_PAGE_SIZE),
    charset: String(flags.get("charset") || DEFAULT_CHARSET),
    processQueueOnly: flags.get("queue-only") === "true",
  };
}

async function runFull(charset: string, maxPages: number, pageSize: number, limitSeeds = 0) {
  const seeds = buildSeeds(charset);
  const selected = limitSeeds > 0 ? seeds.slice(0, limitSeeds) : seeds;
  const seedIndex = loadSeedIndex();
  let merged = loadArtistOptions();

  for (let i = 0; i < selected.length; i += 1) {
    const seed = selected[i];
    console.log(`[full] ${i + 1}/${selected.length} seed="${seed}"`);

    try {
      const result = await fetchSeedRows(seed, maxPages, pageSize);
      merged = dedupeArtistRows([...merged, ...result.rows]);

      seedIndex.seeds[seed] = {
        fetchedAt: nowIso(),
        itemCount: result.rows.length,
        pageCount: result.pageCount,
        exhausted: result.exhausted,
        lastMode: "full",
      };

      saveArtistOptions(merged);
      saveSeedIndex(seedIndex);
    } catch (err) {
      console.error(`[full] seed="${seed}" failed`, err);
    }
  }

  console.log(`Done. Wrote ${merged.length} artists to ${ARTIST_OPTIONS_PATH}`);
}

async function processEnrichmentQueue() {
  const queue = loadEnrichQueue();
  const pending = queue.items.filter((x) => x.status !== "merged");

  if (!pending.length) {
    console.log("[queue] No pending items.");
    return;
  }

  let merged = loadArtistOptions();
  let changed = false;

  for (let i = 0; i < pending.length; i += 1) {
    const item = pending[i];
    console.log(`[queue] ${i + 1}/${pending.length} lookup "${item.name}"`);

    try {
      const rows = await lookupArtistRows(item.name);
      if (rows.length) {
        merged = dedupeArtistRows([...merged, ...rows]);
        changed = true;

        const norms = new Set(rows.map((r) => normalizeArtistName(r.label)));
        const ids = new Set(rows.map((r) => r.id));

        queue.items = queue.items.map((q) => {
          const isMatch =
            normalizeArtistName(q.name) &&
            (norms.has(normalizeArtistName(q.name)) || (q.id ? ids.has(q.id) : false));

          if (!isMatch) return q;
          return { ...q, status: "merged", id: q.id || rows[0]?.id };
        });
      } else {
        queue.items = queue.items.map((q) =>
          q === item ? { ...q, status: "failed" } : q
        );
      }
    } catch (err) {
      console.error(`[queue] lookup failed for "${item.name}"`, err);
    }
  }

  if (changed) {
    saveArtistOptions(merged);
  }
  saveEnrichQueue(queue);

  console.log(`[queue] Done. Artist options count: ${merged.length}`);
}

async function runRefresh(
  staleDays: number,
  maxPages: number,
  pageSize: number,
  limitSeeds = 0,
  processQueueOnly = false
) {
  if (!processQueueOnly) {
    await processEnrichmentQueue();
  } else {
    await processEnrichmentQueue();
    return;
  }

  const seedIndex = loadSeedIndex();
  const allSeeds = buildSeeds();

  const staleSeeds = allSeeds
    .filter((seed) => daysOld(seedIndex.seeds[seed]?.fetchedAt) >= staleDays)
    .sort((a, b) => {
      const da = daysOld(seedIndex.seeds[a]?.fetchedAt);
      const db = daysOld(seedIndex.seeds[b]?.fetchedAt);
      return db - da;
    });

  const selected = limitSeeds > 0 ? staleSeeds.slice(0, limitSeeds) : staleSeeds;

  let merged = loadArtistOptions();

  for (let i = 0; i < selected.length; i += 1) {
    const seed = selected[i];
    console.log(`[refresh] ${i + 1}/${selected.length} seed="${seed}"`);

    try {
      const result = await fetchSeedRows(seed, maxPages, pageSize);
      merged = dedupeArtistRows([...merged, ...result.rows]);

      seedIndex.seeds[seed] = {
        fetchedAt: nowIso(),
        itemCount: result.rows.length,
        pageCount: result.pageCount,
        exhausted: result.exhausted,
        lastMode: "refresh",
      };

      saveArtistOptions(merged);
      saveSeedIndex(seedIndex);
    } catch (err) {
      console.error(`[refresh] seed="${seed}" failed`, err);
    }
  }

  console.log(`Done. Wrote ${merged.length} artists to ${ARTIST_OPTIONS_PATH}`);
}

async function runLookup(name: string) {
  if (!name.trim()) {
    throw new Error(
      `Lookup mode requires a name, e.g. npm run build:artist-options -- lookup "Gord Bamford"`
    );
  }

  const rows = await lookupArtistRows(name);
  if (!rows.length) {
    console.log(`[lookup] No matching artist rows found for "${name}"`);
    return;
  }

  const merged = mergeRowsIntoArtistOptions(rows);
  markQueueItemsMerged(rows);

  const seedIndex = loadSeedIndex();
  seedIndex.seeds[`lookup:${normalizeArtistName(name)}`] = {
    fetchedAt: nowIso(),
    itemCount: rows.length,
    pageCount: 1,
    exhausted: true,
    lastMode: "lookup",
  };
  saveSeedIndex(seedIndex);

  console.log(`[lookup] Added/merged ${rows.length} rows for "${name}"`);
  console.log(`Done. Wrote ${merged.length} artists to ${ARTIST_OPTIONS_PATH}`);
  console.log(rows);
}

async function main() {
  const {
    mode,
    lookup,
    limitSeeds,
    staleDays,
    maxPages,
    pageSize,
    charset,
    processQueueOnly,
  } = parseArgs(process.argv.slice(2));

  if (!API_KEY) {
    throw new Error("Missing TM_API_KEY or TICKETMASTER_API_KEY");
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  switch (mode) {
    case "full":
      await runFull(charset, maxPages, pageSize, limitSeeds);
      return;
    case "refresh":
      await runRefresh(staleDays, maxPages, pageSize, limitSeeds, processQueueOnly);
      return;
    case "lookup":
      await runLookup(lookup);
      return;
    default:
      throw new Error(`Unknown mode "${mode}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});