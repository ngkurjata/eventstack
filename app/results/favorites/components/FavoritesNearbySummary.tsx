"use client";

import React from "react";

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 ${className}`}
      aria-hidden="true"
    />
  );
}

type Props = {
  appliedNearbyFavorite: boolean;
  nearbyChecking: boolean;
  nearbyMatchCount: number;
  nearbyTotalCount: number;
  selectedFavoriteLabel: string;
  activeNearbyLabel: string;
};

export default function FavoritesNearbySummary({
  appliedNearbyFavorite,
  nearbyChecking,
  nearbyMatchCount,
  nearbyTotalCount,
  selectedFavoriteLabel,
  activeNearbyLabel,
}: Props) {
  if (!appliedNearbyFavorite) return null;

  return (
    <div className="rounded-[24px] border border-green-200 bg-gradient-to-r from-green-50 to-white px-4 py-3 shadow-sm sm:rounded-3xl sm:px-5 sm:py-4">
      <div className="flex items-center justify-center gap-3 text-center">
        {nearbyChecking ? <Spinner className="h-5 w-5" /> : null}

        <div className="text-sm font-black leading-snug text-slate-900 sm:text-lg">
          {nearbyMatchCount}/{nearbyTotalCount} {selectedFavoriteLabel} events
          have a {activeNearbyLabel.toUpperCase()} event nearby
        </div>
      </div>
    </div>
  );
}