// FILE: lib/favorites/types.ts

export type FavoriteKind = "team" | "artist";

export type Favorite = {
  id: string;
  label: string;
  kind: FavoriteKind;
  attractionId: string;
  defaultGenre?: string | null;
  aliases?: string[];
};

export type FavoriteMatch = {
  attractionId: string;
  label: string;
  kind: FavoriteKind;
};