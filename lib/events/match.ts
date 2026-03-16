// FILE: lib/events/match.ts

import type { Favorite } from "@/lib/favorites/types";
import type { NormEvent } from "@/lib/events/normalize";

function norm(s: string | null | undefined): string {
  return String(s || "").trim().toLowerCase();
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const raw = String(value || "").trim();
    const key = raw.toLowerCase();
    if (!raw || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }

  return out;
}

export function mergeMatched(into: NormEvent, from: Pick<NormEvent, "matched"> | NormEvent): NormEvent {
  const source = from?.matched || { favorites: [], genres: [], defaultGenres: [] };

  into.matched.favorites = uniqueStrings([
    ...(into.matched.favorites || []),
    ...(source.favorites || []),
  ]);

  into.matched.genres = uniqueStrings([
    ...(into.matched.genres || []),
    ...(source.genres || []),
  ]);

  into.matched.defaultGenres = uniqueStrings([
    ...(into.matched.defaultGenres || []),
    ...(source.defaultGenres || []),
  ]);

  return into;
}

export function getMatchedSelectedGenres(
  event: NormEvent,
  selectedGenres: string[]
): string[] {
  const canonical = norm(event.canonicalGenre);
  if (!canonical) return [];

  return uniqueStrings(
    selectedGenres.filter((genre) => norm(genre) === canonical)
  );
}

export function getMatchedFavoriteIds(
  attractionIdsOnEvent: string[],
  favorites: Favorite[]
): string[] {
  const attractionSet = new Set(
    attractionIdsOnEvent.map((id) => norm(id)).filter(Boolean)
  );

  return uniqueStrings(
    favorites
      .filter((fav) => attractionSet.has(norm(fav.attractionId)))
      .map((fav) => fav.id)
  );
}

export function getMatchedDefaultGenres(
  matchedFavoriteIds: string[],
  favorites: Favorite[]
): string[] {
  const matchedIdSet = new Set(matchedFavoriteIds.map((id) => norm(id)));

  return uniqueStrings(
    favorites
      .filter((fav) => matchedIdSet.has(norm(fav.id)))
      .map((fav) => fav.defaultGenre || null)
  );
}

export function applyMatchesToEvent(
  event: NormEvent,
  args: {
    favorites: Favorite[];
    selectedGenres: string[];
    attractionIdsOnEvent: string[];
  }
): NormEvent {
  const matchedFavoriteIds = getMatchedFavoriteIds(
    args.attractionIdsOnEvent,
    args.favorites
  );

  const matchedGenres = getMatchedSelectedGenres(event, args.selectedGenres);

  const matchedDefaultGenres = getMatchedDefaultGenres(
    matchedFavoriteIds,
    args.favorites
  );

  event.matched.favorites = matchedFavoriteIds;
  event.matched.genres = matchedGenres;
  event.matched.defaultGenres = matchedDefaultGenres;

  return event;
}

export function eventMatchesUserFilters(
  event: NormEvent,
  args: {
    favorites: Favorite[];
    selectedGenres: string[];
    attractionIdsOnEvent: string[];
  }
): boolean {
  const matchedFavoriteIds = getMatchedFavoriteIds(
    args.attractionIdsOnEvent,
    args.favorites
  );

  const matchedGenres = getMatchedSelectedGenres(event, args.selectedGenres);

  return matchedFavoriteIds.length > 0 || matchedGenres.length > 0;
}