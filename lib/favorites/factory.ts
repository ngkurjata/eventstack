import type { Favorite, FavoriteKind, SeriesKey } from "./types";

type MakeFavoriteInput = {
  id: string;
  label: string;
  kind: FavoriteKind;
  defaultGenre?: string | null;
  aliases?: string[];

  attractionId?: string;
  seriesKey?: SeriesKey;
};

/**
 * Canonical constructor for Favorite objects.
 * Keeps Favorite creation consistent across the app.
 */
export function makeFavorite(input: MakeFavoriteInput): Favorite {
  return {
    id: String(input.id || "").trim(),
    label: String(input.label || "").trim(),
    kind: input.kind,

    defaultGenre: normalizeOptionalGenre(input.defaultGenre),
    aliases: normalizeAliases(input.aliases),

    attractionId: input.attractionId?.trim() || undefined,
    seriesKey: input.seriesKey || undefined,
  };
}

function normalizeOptionalGenre(value?: string | null): string | null | undefined {
  if (value == null) return value;

  const g = String(value).trim();
  if (!g) return null;

  return g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
}

function normalizeAliases(value?: string[]): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const cleaned = value
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  return cleaned.length ? cleaned : undefined;
}