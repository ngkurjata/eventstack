"use client";

import React from "react";
import GroupedComboBox from "@/app/components/GroupedComboBox";
import type { FavoriteOption } from "@/lib/favorites/options";

type Props = {
  // state
  comboInput: string;
  setComboInput: (v: string) => void;

  selectedFavorite: any;
  setSelectedFavorite: (v: any) => void;

  favoriteRows: any[];

  // control flags
  canEditInputs: boolean;
  loading: boolean;

  // actions
  onPickFavorite: (opt: FavoriteOption) => void;
  onRunSearch: () => void;
  onStopSearch: () => void;

  // UI
  mainSearchButtonLabel: string;
  err?: string | null;
};

export default function FavoritesSearchControls({
  comboInput,
  setComboInput,
  selectedFavorite,
  setSelectedFavorite,
  favoriteRows,
  canEditInputs,
  loading,
  onPickFavorite,
  onRunSearch,
  onStopSearch,
  mainSearchButtonLabel,
  err,
}: Props) {
  return (
    <>
      {/* Favorite Picker */}
      <div
        className={`mt-5 max-w-2xl ${
          canEditInputs ? "" : "pointer-events-none opacity-70"
        }`}
        aria-disabled={!canEditInputs}
      >
        <GroupedComboBox
          label="Favorite Team or Band"
          value={comboInput}
          placeholder="Search favorites…"
          rows={favoriteRows}
          onChange={(next) => {
            if (!canEditInputs) return;

            setComboInput(next);

            if (!next.trim()) {
              setSelectedFavorite(null);
            }
          }}
          onPick={(row) => {
            if (!canEditInputs) return;
            if (!row.favorite) return;

            onPickFavorite(row.favorite);
          }}
          onClear={() => {
            if (!canEditInputs) return;

            setComboInput("");
            setSelectedFavorite(null);
          }}
        />
      </div>

      {/* Main Search Button */}
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => {
            if (loading) {
              onStopSearch();
              return;
            }

            onRunSearch();
          }}
          disabled={!selectedFavorite && !loading}
          className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-extrabold text-white disabled:opacity-50"
        >
          {mainSearchButtonLabel}
        </button>
      </div>

      {/* Error */}
      {err ? (
        <div className="mt-4 text-sm font-semibold text-red-600">
          {err}
        </div>
      ) : null}
    </>
  );
}