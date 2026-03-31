"use client";

import { useMemo } from "react";
import { type ReadonlyURLSearchParams } from "next/navigation";
import { makeFavorite } from "@/lib/favorites/factory";
import type { Favorite, FavoriteKind, SeriesKey } from "@/lib/favorites/types";

export function useInitialFavorite(
  sp: ReadonlyURLSearchParams
): Favorite | null {
  return useMemo(() => {
    const id = (sp.get("id") || "").trim();
    const label = (sp.get("label") || "").trim();

    if (!id || !label) return null;

    const rawKind = (sp.get("kind") || "team").trim().toLowerCase();
    const kind: FavoriteKind =
      rawKind === "artist" || rawKind === "series" ? rawKind : "team";

    const attractionId =
      kind !== "series"
        ? (sp.get("attractionId") || "").trim() || undefined
        : undefined;

    const rawSeriesKey = (sp.get("seriesKey") || "").trim();
    const seriesKey: SeriesKey | undefined =
      kind === "series" && rawSeriesKey
        ? (rawSeriesKey as SeriesKey)
        : undefined;

    const defaultGenre = (sp.get("defaultGenre") || "").trim() || undefined;

    return makeFavorite({
      id,
      label,
      kind,
      attractionId,
      seriesKey,
      defaultGenre,
    });
  }, [sp]);
}