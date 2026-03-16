// FILE: lib/favorites/catalog.ts

export type CuratedFavorite = {
  id: string;
  label: string;
  kind: "team" | "artist";
  attractionId: string;
  defaultGenre?: string | null;
  aliases?: string[];
};

export const CURATED_FAVORITES: CuratedFavorite[] = [
  // Leave empty for now, or add only real attraction-backed favorites
  // that you explicitly want to curate.
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