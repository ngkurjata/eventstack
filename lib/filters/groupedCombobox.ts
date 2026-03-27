// FILE: lib/filters/groupedCombobox.ts

import type { FavoriteOption } from "@/lib/favorites/options";
import type { GroupedGenreOption } from "@/lib/events/groupedGenres";

export type ComboSectionKey = "genres" | "favorites";
export type ComboGroupKey = "music" | "sports" | "teams" | "artists";

export type ComboRow =
  | { type: "section"; key: string; label: string }
  | { type: "group"; key: string; label: string }
  | {
      type: "option";
      key: string;
      label: string;
      displayLabel: string;
      searchText: string;
      optionType: "genre" | "favorite";
      genre?: GroupedGenreOption;
      favorite?: FavoriteOption;
    };

function norm(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/* -------------------- League Priority -------------------- */

const LEAGUE_PRIORITY: Record<string, number> = {
  NHL: 1,
  MLB: 2,
  NFL: 3,
  NBA: 4,

  "NCAA Football": 5,
  "NCAA Basketball": 6,
  "NCAA Hockey": 7,

  WNBA: 8,
  NWSL: 9,
  PWHL: 10,

  AHL: 20,
  OHL: 21,
  WHL: 22,
  QMJHL: 23,
  ECHL: 24,
  MiLB: 25,
};

function leagueRank(league?: string) {
  if (!league) return 999;
  return LEAGUE_PRIORITY[league] ?? 500;
}

/* -------------------- Display -------------------- */

function makeFavoriteDisplayLabel(fav: FavoriteOption) {
  const genre = String(fav.defaultGenre || "").trim().toUpperCase();

  if (genre) {
    return `${fav.label} - ${genre}`;
  }

  return fav.label;
}

function makeFavoriteSearchText(fav: FavoriteOption) {
  return norm(
    [
      fav.label,
      fav.kind,
      fav.defaultGenre,
      fav.league || "",
      ...(fav.aliases || []),
    ].join(" ")
  );
}

/* -------------------- Genres -------------------- */

function displayGenreLabel(genre: GroupedGenreOption) {
  return genre.label;
}

function makeGenreSearchText(genre: GroupedGenreOption) {
  return norm(
    [
      genre.label,
      genre.family,
      ...(genre.examples || []),
      ...(genre.aliases || []),
    ].join(" ")
  );
}

/* -------------------- Group teams by league -------------------- */

function groupTeamsByLeague(favorites: FavoriteOption[]) {
  const map = new Map<string, FavoriteOption[]>();

  for (const fav of favorites) {
    if (fav.kind !== "team") continue;

    const league = fav.league || "Other";

    if (!map.has(league)) {
      map.set(league, []);
    }

    map.get(league)!.push(fav);
  }

  const leagues = Array.from(map.keys()).sort(
    (a, b) => leagueRank(a) - leagueRank(b)
  );

  return leagues.map((league) => ({
    league,
    teams: (map.get(league) || []).sort((a, b) =>
      a.label.localeCompare(b.label)
    ),
  }));
}

/* -------------------- Builders -------------------- */

export function buildHomeFavoriteRows(favorites: FavoriteOption[]): ComboRow[] {
  const artists = favorites
    .filter((f) => f.kind === "artist")
    .sort((a, b) => a.label.localeCompare(b.label));

  const rows: ComboRow[] = [
    { type: "section", key: "favorites", label: "Favorites" },
  ];

  const groupedLeagues = groupTeamsByLeague(favorites);

  if (groupedLeagues.length) {
    rows.push({ type: "group", key: "teams", label: "Teams" });

    for (const group of groupedLeagues) {
      rows.push({
        type: "group",
        key: `league:${group.league}`,
        label: group.league,
      });

      rows.push(
        ...group.teams.map((fav) => ({
          type: "option" as const,
          key: `favorite:${fav.id}`,
          label: fav.label,
          displayLabel: makeFavoriteDisplayLabel(fav),
          searchText: makeFavoriteSearchText(fav),
          optionType: "favorite" as const,
          favorite: fav,
        }))
      );
    }
  }

  if (artists.length) {
    rows.push({ type: "group", key: "artists", label: "Artists" });

    rows.push(
      ...artists.map((fav) => ({
        type: "option" as const,
        key: `favorite:${fav.id}`,
        label: fav.label,
        displayLabel: makeFavoriteDisplayLabel(fav),
        searchText: makeFavoriteSearchText(fav),
        optionType: "favorite" as const,
        favorite: fav,
      }))
    );
  }

  return rows;
}

export function buildResultsFilterRows(
  genres: GroupedGenreOption[],
  favorites: FavoriteOption[]
): ComboRow[] {
  const rows: ComboRow[] = [];

  rows.push({ type: "section", key: "genres", label: "Genres" });

  const music = genres
    .filter((g) => g.family === "music")
    .sort((a, b) => a.label.localeCompare(b.label));

  const sports = genres
    .filter((g) => g.family === "sports")
    .sort((a, b) => a.label.localeCompare(b.label));

  if (music.length) {
    rows.push({ type: "group", key: "music", label: "Music" });
    rows.push(
      ...music.map((genre) => ({
        type: "option" as const,
        key: `genre:${genre.id}`,
        label: genre.label,
        displayLabel: displayGenreLabel(genre),
        searchText: makeGenreSearchText(genre),
        optionType: "genre" as const,
        genre,
      }))
    );
  }

  if (sports.length) {
    rows.push({ type: "group", key: "sports", label: "Sports" });
    rows.push(
      ...sports.map((genre) => ({
        type: "option" as const,
        key: `genre:${genre.id}`,
        label: genre.label,
        displayLabel: displayGenreLabel(genre),
        searchText: makeGenreSearchText(genre),
        optionType: "genre" as const,
        genre,
      }))
    );
  }

  rows.push({ type: "section", key: "favorites", label: "Favorites" });

  const groupedLeagues = groupTeamsByLeague(favorites);

  if (groupedLeagues.length) {
    rows.push({ type: "group", key: "teams", label: "Teams" });

    for (const group of groupedLeagues) {
      rows.push({
        type: "group",
        key: `league:${group.league}`,
        label: group.league,
      });

      rows.push(
        ...group.teams.map((fav) => ({
          type: "option" as const,
          key: `favorite:${fav.id}`,
          label: fav.label,
          displayLabel: makeFavoriteDisplayLabel(fav),
          searchText: makeFavoriteSearchText(fav),
          optionType: "favorite" as const,
          favorite: fav,
        }))
      );
    }
  }

  const artists = favorites
    .filter((f) => f.kind === "artist")
    .sort((a, b) => a.label.localeCompare(b.label));

  if (artists.length) {
    rows.push({ type: "group", key: "artists", label: "Artists" });

    rows.push(
      ...artists.map((fav) => ({
        type: "option" as const,
        key: `favorite:${fav.id}`,
        label: fav.label,
        displayLabel: makeFavoriteDisplayLabel(fav),
        searchText: makeFavoriteSearchText(fav),
        optionType: "favorite" as const,
        favorite: fav,
      }))
    );
  }

  return rows;
}

/* -------------------- Filter -------------------- */

export function filterComboRows(
  rows: ComboRow[],
  input: string,
  limit = 80
): ComboRow[] {
  const q = norm(input);
  if (!q) return rows.slice(0, limit);

  const out: ComboRow[] = [];
  let currentSection: ComboRow | null = null;
  let currentGroup: ComboRow | null = null;
  let sectionAdded = "";
  let groupAdded = "";
  let count = 0;

  for (const row of rows) {
    if (row.type === "section") {
      currentSection = row;
      currentGroup = null;
      continue;
    }

    if (row.type === "group") {
      currentGroup = row;
      continue;
    }

    if (!row.searchText.includes(q)) continue;

    if (currentSection && sectionAdded !== currentSection.key) {
      out.push(currentSection);
      sectionAdded = currentSection.key;
      groupAdded = "";
    }

    if (currentGroup && groupAdded !== currentGroup.key) {
      out.push(currentGroup);
      groupAdded = currentGroup.key;
    }

    out.push(row);
    count++;
    if (count >= limit) break;
  }

  return out;
}