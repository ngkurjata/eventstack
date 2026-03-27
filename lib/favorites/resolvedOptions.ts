// FILE: lib/favorites/resolvedOptions.ts

import artistSeedsRaw from "@/data/artist_seeds.json";

import ahlRaw from "@/data/team_attraction_ids/ahl.json";
import echlRaw from "@/data/team_attraction_ids/echl.json";
import milbRaw from "@/data/team_attraction_ids/milb.json";
import ncaaFootballRaw from "@/data/team_attraction_ids/ncaa-football.json";
import nwslRaw from "@/data/team_attraction_ids/nwsl.json";
import ohlRaw from "@/data/team_attraction_ids/ohl.json";
import pwhlRaw from "@/data/team_attraction_ids/pwhl.json";
import qmjhlRaw from "@/data/team_attraction_ids/qmjhl.json";
import whlRaw from "@/data/team_attraction_ids/whl.json";
import wnbaRaw from "@/data/team_attraction_ids/wnba.json";

// ✅ NEW MAJOR LEAGUES
import nhlRaw from "@/data/team_attraction_ids/nhl.json";
import nflRaw from "@/data/team_attraction_ids/nfl.json";
import cflRaw from "@/data/team_attraction_ids/cfl.json";
import nbaRaw from "@/data/team_attraction_ids/nba.json";
import mlbRaw from "@/data/team_attraction_ids/mlb.json";
import mlsRaw from "@/data/team_attraction_ids/mls.json";

import {
  FAVORITE_OPTIONS,
  type FavoriteOption,
} from "@/lib/favorites/options";

type RawResolvedFile =
  | Record<string, unknown>
  | Array<Record<string, unknown> | string>;

type ArtistSeed = {
  label?: unknown;
  attractionId?: unknown;
  category?: unknown;
  primaryGenre?: unknown;
};

function norm(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferGenreFromLeague(league: string) {
  const key = norm(league);

  if (key === "wnba" || key === "nba") return "Basketball";
  if (key === "nfl" || key === "cfl" || key === "ncaa football")
    return "Football";

  if (
    key === "ahl" ||
    key === "echl" ||
    key === "ohl" ||
    key === "qmjhl" ||
    key === "whl" ||
    key === "pwhl" ||
    key === "nhl"
  ) {
    return "Hockey";
  }

  if (key === "nwsl" || key === "mls") return "Soccer";

  if (key === "milb" || key === "mlb") return "Baseball";

  return "Sports";
}

function prettyLeagueName(leagueKey: string) {
  switch (leagueKey) {
    case "ahl":
      return "AHL";
    case "echl":
      return "ECHL";
    case "milb":
      return "MiLB";
    case "mlb":
      return "MLB";
    case "nfl":
      return "NFL";
    case "cfl":
      return "CFL";
    case "nba":
      return "NBA";
    case "nhl":
      return "NHL";
    case "mls":
      return "MLS";
    case "ncaa-football":
      return "NCAA Football";
    case "nwsl":
      return "NWSL";
    case "ohl":
      return "OHL";
    case "pwhl":
      return "PWHL";
    case "qmjhl":
      return "QMJHL";
    case "whl":
      return "WHL";
    case "wnba":
      return "WNBA";
    default:
      return leagueKey;
  }
}

function tryReadLabel(value: Record<string, unknown>, fallbackKey?: string) {
  const candidates = [value.teamName, value.label, value.name, fallbackKey];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }

  return "";
}

function tryReadAttractionId(value: Record<string, unknown>) {
  const candidates = [value.attractionId, value.tmAttractionId, value.id];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }

  return "";
}

function collectResolvedEntries(
  input: unknown,
  league: string,
  out: Array<{
    label: string;
    attractionId: string;
    league: string;
    defaultGenre: string;
  }>,
  fallbackKey?: string
) {
  if (!input) return;

  if (Array.isArray(input)) {
    for (const item of input) {
      collectResolvedEntries(item, league, out, fallbackKey);
    }
    return;
  }

  if (typeof input === "string") {
    const attractionId = String(input || "").trim();
    const label = String(fallbackKey || "").trim();

    if (label && attractionId) {
      out.push({
        label,
        attractionId,
        league,
        defaultGenre: inferGenreFromLeague(league),
      });
    }
    return;
  }

  if (typeof input !== "object") return;

  const record = input as Record<string, unknown>;
  const label = tryReadLabel(record, fallbackKey);
  const attractionId = tryReadAttractionId(record);

  if (label && attractionId) {
    out.push({
      label,
      attractionId,
      league,
      defaultGenre: inferGenreFromLeague(league),
    });
  }

  for (const [key, child] of Object.entries(record)) {
    if (
      key === "teamName" ||
      key === "label" ||
      key === "name" ||
      key === "attractionId" ||
      key === "tmAttractionId" ||
      key === "id"
    ) {
      continue;
    }

    collectResolvedEntries(child, league, out, key);
  }
}

function buildTeamOptionsFromFile(
  raw: RawResolvedFile,
  leagueKey: string
): FavoriteOption[] {
  const league = prettyLeagueName(leagueKey);
  const collected: Array<{
    label: string;
    attractionId: string;
    league: string;
    defaultGenre: string;
  }> = [];

  collectResolvedEntries(raw, league, collected);

  const deduped = new Map<
    string,
    {
      label: string;
      attractionId: string;
      league: string;
      defaultGenre: string;
    }
  >();

  for (const row of collected) {
    const key = norm(row.label);
    if (!key) continue;
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }

  return Array.from(deduped.values()).map((row) => ({
    id: slugify(row.label),
    label: row.label,
    kind: "team",
    attractionId: row.attractionId,
    defaultGenre: row.defaultGenre,
    league: row.league,
  }));
}

function buildArtistOptions(raw: ArtistSeed[]): FavoriteOption[] {
  const deduped = new Map<string, FavoriteOption>();

  for (const row of raw) {
    const label = String(row.label || "").trim();
    const attractionId = String(row.attractionId || "").trim();

    if (!label || !attractionId) continue;

    const key = norm(label);
    if (!key) continue;

    if (!deduped.has(key)) {
      deduped.set(key, {
        id: `artist-${slugify(label)}`,
        label,
        kind: "artist",
        attractionId,
        defaultGenre:
          String(row.primaryGenre || "").trim() ||
          (String(row.category || "").trim().toLowerCase() === "comedy"
            ? "Comedy"
            : "Music"),
      });
    }
  }

  return Array.from(deduped.values());
}

const resolvedTeams = [
  ...buildTeamOptionsFromFile(ahlRaw as RawResolvedFile, "ahl"),
  ...buildTeamOptionsFromFile(echlRaw as RawResolvedFile, "echl"),
  ...buildTeamOptionsFromFile(milbRaw as RawResolvedFile, "milb"),
  ...buildTeamOptionsFromFile(ncaaFootballRaw as RawResolvedFile, "ncaa-football"),
  ...buildTeamOptionsFromFile(nwslRaw as RawResolvedFile, "nwsl"),
  ...buildTeamOptionsFromFile(ohlRaw as RawResolvedFile, "ohl"),
  ...buildTeamOptionsFromFile(pwhlRaw as RawResolvedFile, "pwhl"),
  ...buildTeamOptionsFromFile(qmjhlRaw as RawResolvedFile, "qmjhl"),
  ...buildTeamOptionsFromFile(whlRaw as RawResolvedFile, "whl"),
  ...buildTeamOptionsFromFile(wnbaRaw as RawResolvedFile, "wnba"),

  // ✅ NEW MAJOR LEAGUES
  ...buildTeamOptionsFromFile(nhlRaw as RawResolvedFile, "nhl"),
  ...buildTeamOptionsFromFile(nflRaw as RawResolvedFile, "nfl"),
  ...buildTeamOptionsFromFile(cflRaw as RawResolvedFile, "cfl"),
  ...buildTeamOptionsFromFile(nbaRaw as RawResolvedFile, "nba"),
  ...buildTeamOptionsFromFile(mlbRaw as RawResolvedFile, "mlb"),
  ...buildTeamOptionsFromFile(mlsRaw as RawResolvedFile, "mls"),
];

const resolvedArtists = buildArtistOptions(
  artistSeedsRaw as ArtistSeed[]
);

const resolvedTeamMap = new Map<string, FavoriteOption>();

for (const team of resolvedTeams) {
  const key = norm(team.label);
  if (!key) continue;
  if (!resolvedTeamMap.has(key)) {
    resolvedTeamMap.set(key, team);
  }
}

const manualNonTeams = FAVORITE_OPTIONS.filter(
  (opt) => opt.kind !== "team" && opt.kind !== "artist"
);

for (const opt of FAVORITE_OPTIONS) {
  if (opt.kind !== "team") continue;

  const key = norm(opt.label);
  const existing = resolvedTeamMap.get(key);

  if (!existing) {
    resolvedTeamMap.set(key, opt);
    continue;
  }

  resolvedTeamMap.set(key, {
    ...existing,
    ...opt,
    kind: "team",
    attractionId: String(existing.attractionId || opt.attractionId || "").trim(),
    defaultGenre: String(
      opt.defaultGenre || existing.defaultGenre || "Sports"
    ).trim(),
    league: opt.league || existing.league,
    aliases: opt.aliases || existing.aliases,
  });
}

export const RESOLVED_FAVORITE_OPTIONS: FavoriteOption[] = [
  ...Array.from(resolvedTeamMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label)
  ),
  ...resolvedArtists.sort((a, b) => a.label.localeCompare(b.label)),
  ...manualNonTeams,
];