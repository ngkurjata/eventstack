// FILE: lib/favorites/catalog.ts

import type { Favorite } from "./types";

/* -------------------- Curated (attraction-based) -------------------- */

export type CuratedFavorite = {
  id: string;
  label: string;
  kind: "team" | "artist";
  attractionId: string;
  defaultGenre?: string | null;
  aliases?: string[];
};

export const CURATED_FAVORITES: CuratedFavorite[] = [
  // Keep using this for real attraction-backed favorites only
  //
  // Example:
  // {
  //   id: "K8vZ9171oVf",
  //   label: "Toronto Blue Jays",
  //   kind: "team",
  //   attractionId: "K8vZ9171oVf",
  //   defaultGenre: "Baseball",
  //   aliases: ["blue jays", "toronto blue jays", "jays"],
  // },
];

/* -------------------- Series favorites -------------------- */

export const SERIES_FAVORITES: Favorite[] = [
  // --- Motorsports ---
  {
    id: "f1",
    label: "Formula 1",
    kind: "series",
    seriesKey: "f1",
    defaultGenre: "Motorsports",
  },
  {
    id: "nascar",
    label: "NASCAR",
    kind: "series",
    seriesKey: "nascar",
    defaultGenre: "Motorsports",
  },
  {
    id: "indy",
    label: "IndyCar",
    kind: "series",
    seriesKey: "indy",
    defaultGenre: "Motorsports",
  },

  // --- Golf ---
  {
    id: "pga",
    label: "PGA Tour",
    kind: "series",
    seriesKey: "pga",
    defaultGenre: "Golf",
  },
  {
    id: "lpga",
    label: "LPGA",
    kind: "series",
    seriesKey: "lpga",
    defaultGenre: "Golf",
  },
  {
    id: "liv",
    label: "LIV Golf",
    kind: "series",
    seriesKey: "liv",
    defaultGenre: "Golf",
  },
  {
    id: "tgl",
    label: "TGL",
    kind: "series",
    seriesKey: "tgl",
    defaultGenre: "Golf",
  },

  // --- Combat ---
  {
    id: "ufc",
    label: "UFC",
    kind: "series",
    seriesKey: "ufc",
    defaultGenre: "MMA",
  },

  // --- Tennis ---
  {
    id: "atp",
    label: "ATP Tour",
    kind: "series",
    seriesKey: "atp",
    defaultGenre: "Tennis",
  },
  {
    id: "wta",
    label: "WTA Tour",
    kind: "series",
    seriesKey: "wta",
    defaultGenre: "Tennis",
  },
];

/* -------------------- Helpers -------------------- */

function norm(s: string | null | undefined): string {
  return String(s || "").trim().toLowerCase();
}

export function findCuratedFavorites(query: string): CuratedFavorite[] {
  const q = norm(query);
  if (!q) return [];

  return CURATED_FAVORITES.filter((fav) => {
    if (norm(fav.label).includes(q)) return true;

    return (fav.aliases || []).some((alias) => {
      const a = norm(alias);
      return a.includes(q) || q.includes(a);
    });
  });
}

export function findSeriesFavorites(query: string): Favorite[] {
  const q = norm(query);
  if (!q) return [];

  return SERIES_FAVORITES.filter((fav) => norm(fav.label).includes(q));
}

export function findAllFavorites(query: string): Favorite[] {
  return [...findCuratedFavorites(query), ...findSeriesFavorites(query)];
}