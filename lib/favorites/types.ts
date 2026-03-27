// FILE: lib/favorites/types.ts

export type FavoriteKind = "team" | "artist" | "series";

export type SeriesKey =
  | "f1"
  | "nascar"
  | "indy"
  | "pga"
  | "lpga"
  | "liv"
  | "tgl"
  | "ufc"
  | "atp"
  | "wta";

export type Favorite = {
  id: string;
  label: string;
  kind: FavoriteKind;
  defaultGenre?: string | null;
  aliases?: string[];

  // team / artist favorites
  attractionId?: string;

  // series favorites
  seriesKey?: SeriesKey;
};

export type FavoriteMatch = {
  label: string;
  kind: FavoriteKind;
  attractionId?: string;
  seriesKey?: SeriesKey;
};