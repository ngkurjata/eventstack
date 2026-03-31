"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BuildTripHeader from "./components/BuildTripHeader";
import BuildTripEventsSection from "./components/BuildTripEventsSection";
import TripActionButtons from "./components/TripActionButtons";
import { useBuildTripBootstrap } from "./hooks/useBuildTripBootstrap";
import { useBuildTripState } from "./hooks/useBuildTripState";

export default function BuildTripPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const rawTripId = (sp.get("tripId") || "").trim();
  const rawShareId = (sp.get("shareId") || sp.get("share") || "").trim();

  const state = useBuildTripState();

  const bootstrap = useBuildTripBootstrap({
    rawTripId,
    rawShareId,
    hydrateFromBootstrap: state.hydrateFromBootstrap,
    syncTrip: state.sync,
  });

  const tripId = bootstrap.tripId;

  if (!tripId) {
    return (
      <main className="app-shell">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-black text-slate-900">Missing trip</h1>
            <p className="mt-2 text-slate-600">
              Start a new trip from the home page.
            </p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-5 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white"
            >
              Go Home
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="page-wrap py-4 pb-20 sm:py-6 lg:py-10">
        <TripActionButtons
          copied={state.copied}
          shared={state.shared}
          onCopy={() =>
            void state.copyTripLink(tripId, bootstrap.shareId, bootstrap.setShareId)
          }
          onShare={() =>
            void state.shareTrip(tripId, bootstrap.shareId, bootstrap.setShareId)
          }
        />

        <BuildTripHeader
          tripId={tripId}
          tripName={state.tripName}
          draftTripName={state.draftTripName}
          isEditingTripName={state.isEditingTripName}
          tripDateRange={state.tripDateRange}
          onDraftTripNameChange={state.setDraftTripName}
          onStartEditingTripName={state.startEditingTripName}
          onSaveTripNameEdit={() => state.saveTripNameEdit(tripId)}
          onCancelTripNameEdit={state.cancelTripNameEdit}
          onAddEventsByCity={() =>
            router.push(`/results/area?tripId=${encodeURIComponent(tripId)}`)
          }
          onAddEventsByFavorites={() =>
            router.push(`/results/favorites?tripId=${encodeURIComponent(tripId)}`)
          }
        />

        <BuildTripEventsSection
          events={state.events}
          maybeIdSet={state.maybeIdSet}
          grouped={state.grouped}
          confirmedMapEvents={state.confirmedMapEvents}
          orderById={state.orderById}
          showMap={state.showMap}
          showMaybe={state.showMaybe}
          onToggleMap={() => state.setShowMap((prev) => !prev)}
          onToggleShowMaybe={() => state.setShowMaybe((prev) => !prev)}
          onToggleMaybe={(id) => state.toggleMaybe(tripId, id)}
          onRemove={(id) => state.removeEvent(tripId, id)}
          onOpenNearbySearch={(event) => state.openNearbySearch(tripId, event)}
        />
      </div>
    </main>
  );
}