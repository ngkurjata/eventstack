// FILE: lib/favorites/options.ts

export type FavoriteKind = "team" | "artist" | "series";

export type FavoriteOption = {
  id: string;
  label: string;
  kind: FavoriteKind;
  attractionId?: string; // made optional for series support
  seriesKey?: string;    // ✅ added
  defaultGenre: string;
  aliases?: string[];
  league?: string;
};

export const FAVORITE_OPTIONS: FavoriteOption[] = [
  {
    id: "edmonton-oilers",
    label: "Edmonton Oilers",
    kind: "team",
    attractionId: "K8vZ9171oYV",
    defaultGenre: "Hockey",
    aliases: ["oilers", "edmonton", "nhl", "hockey"],
    league: "NHL",
  },
  {
    id: "toronto-blue-jays",
    label: "Toronto Blue Jays",
    kind: "team",
    attractionId: "K8vZ9171okV",
    defaultGenre: "Baseball",
    aliases: ["blue jays", "jays", "toronto", "mlb", "baseball"],
    league: "MLB",
  },
  {
    id: "luke-combs",
    label: "Luke Combs",
    kind: "artist",
    attractionId: "K8vZ9175G7f",
    defaultGenre: "Country",
    aliases: ["country", "country music"],
  },
  {
    id: "kiss",
    label: "KISS",
    kind: "artist",
    attractionId: "K8vZ9171Cq0",
    defaultGenre: "Rock",
    aliases: ["rock", "classic rock"],
  },

  // Example future-ready series (optional, safe to include now)
  {
    id: "formula-1",
    label: "Formula 1",
    kind: "series",
    seriesKey: "f1",
    defaultGenre: "Motorsports",
    aliases: ["f1", "formula 1", "grand prix"],
  },
];