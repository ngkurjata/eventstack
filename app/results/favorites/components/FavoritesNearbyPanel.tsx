"use client";

import React from "react";
import GroupedComboBox from "@/app/components/GroupedComboBox";
import { buildResultsFilterRows } from "@/lib/filters/groupedCombobox";
import {
  genreKeyToLabel,
  resolveGenreKey,
  type GenreKey,
} from "@/lib/events/genres";

import type { Favorite, SeriesKey } from "@/lib/favorites/types";

type Props = {
  canEditInputs: boolean;
  hasNearbyUI: boolean;

  selectedFavorite: Favorite | null;

  nearbyInput: string;
  setNearbyInput: React.Dispatch<React.SetStateAction<string>>;

  nearbyRows: ReturnType<typeof buildResultsFilterRows>;

  nearbyDraftFavorite: Favorite | null;
  setNearbyDraftFavorite: React.Dispatch<
    React.SetStateAction<Favorite | null>
  >;

  appliedNearbyFavorite: Favorite | null;

  nearbyChecking: boolean;
  hasRunNearbySearch: boolean;
  isNearbyStopped: boolean;
  canContinueSameNearbySearch: boolean;
  nearbySearchButtonLabel: string;

  nearbyMatchCount: number;
  showOnlyMatching: boolean;
  setShowOnlyMatching: React.Dispatch<React.SetStateAction<boolean>>;

  resetNearbyUi: () => void;
  stopNearbySearch: () => void;
  runNearbyCheck: (
    favorite: Favorite | null,
    hasRunNearbySearch: boolean
  ) => void;
  setAppliedNearbyFavorite: React.Dispatch<
    React.SetStateAction<Favorite | null>
  >;
  setHasRunNearbySearch: React.Dispatch<React.SetStateAction<boolean>>;

  makeFavorite: typeof import("@/lib/favorites/factory").makeFavorite;
};

export default function FavoritesNearbyPanel({
  canEditInputs,
  hasNearbyUI,
  selectedFavorite,
  nearbyInput,
  setNearbyInput,
  nearbyRows,
  nearbyDraftFavorite,
  setNearbyDraftFavorite,
  appliedNearbyFavorite,
  nearbyChecking,
  hasRunNearbySearch,
  isNearbyStopped,
  canContinueSameNearbySearch,
  nearbySearchButtonLabel,
  nearbyMatchCount,
  showOnlyMatching,
  setShowOnlyMatching,
  resetNearbyUi,
  stopNearbySearch,
  runNearbyCheck,
  setAppliedNearbyFavorite,
  setHasRunNearbySearch,
  makeFavorite,
}: Props) {
  if (!hasNearbyUI) return null;

  return (
    <div className="mt-7 max-w-2xl rounded-2xl border border-slate-200 bg-white p-4">
      <div
        className={`${canEditInputs ? "" : "pointer-events-none opacity-70"}`}
        aria-disabled={!canEditInputs}
      >
        <GroupedComboBox
          label={`Highlight ${selectedFavorite?.label} events with this nearby`}
          value={nearbyInput}
          placeholder="Music Genre / Sport / Team / Artist"
          rows={nearbyRows}
          onChange={(next) => {
            if (!canEditInputs) return;

            setNearbyInput(next);

            if (!next.trim()) {
              resetNearbyUi();
            }
          }}
          onPick={(row) => {
            if (!canEditInputs) return;

            if (row.favorite) {
              const fav = makeFavorite({
                id: row.favorite.id,
                label: row.favorite.label,
                kind: row.favorite.kind,
                attractionId: row.favorite.attractionId,
                seriesKey: row.favorite.seriesKey as SeriesKey | undefined,
                defaultGenre: row.favorite.defaultGenre,
              });

              setNearbyDraftFavorite(fav);
              setNearbyInput(row.favorite.label);
              return;
            }

            if (row.genre) {
              const displayLabel = String(row.genre.label || "").trim();
              const genreKey =
                resolveGenreKey(displayLabel) ||
                resolveGenreKey(String(row.genre.id || ""));

              if (!genreKey) return;

              const genreFav = makeFavorite({
                id: `GENRE:${genreKey}`,
                label: displayLabel,
                kind: "artist",
                defaultGenre: genreKeyToLabel(genreKey) || displayLabel,
              });

              setNearbyDraftFavorite(genreFav);
              setNearbyInput(displayLabel);
            }
          }}
          onClear={() => {
            if (!canEditInputs) return;
            resetNearbyUi();
          }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-center">
        <button
          type="button"
          onClick={() => {
            if (nearbyChecking) {
              stopNearbySearch();
              return;
            }

            runNearbyCheck(nearbyDraftFavorite, hasRunNearbySearch);
            setAppliedNearbyFavorite(nearbyDraftFavorite);
            setHasRunNearbySearch(true);
          }}
          disabled={!nearbyDraftFavorite && !nearbyChecking}
          className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-extrabold text-white disabled:opacity-40"
        >
          {nearbySearchButtonLabel}
        </button>

        {appliedNearbyFavorite && nearbyMatchCount > 0 && !nearbyChecking ? (
          <button
            type="button"
            onClick={() => setShowOnlyMatching((v) => !v)}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-extrabold text-slate-800"
          >
            {showOnlyMatching
              ? "Show All Events"
              : `Show Only ${appliedNearbyFavorite.label} Matches`}
          </button>
        ) : null}
      </div>

      {hasRunNearbySearch &&
      isNearbyStopped &&
      !canContinueSameNearbySearch &&
      nearbyDraftFavorite ? (
        <div className="mt-3 text-center text-xs font-semibold text-slate-500">
          Changing the nearby selection will start a new search.
        </div>
      ) : null}
    </div>
  );
}