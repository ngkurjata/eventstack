"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FavoritesAnchorList from "@/app/results/favorites/components/FavoritesAnchorList";
import FavoritesNearbyPanel from "@/app/results/favorites/components/FavoritesNearbyPanel";
import FavoritesNearbySummary from "@/app/results/favorites/components/FavoritesNearbySummary";
import FavoritesSearchControls from "@/app/results/favorites/components/FavoritesSearchControls";
import { useInitialFavorite } from "@/app/results/favorites/hooks/useInitialFavorite";
import {
  addDaysYMD,
  groupByDate,
  type AnchorCard,
} from "@/app/results/favorites/utils";

import { makeFavorite } from "@/lib/favorites/factory";
import type { Favorite, SeriesKey } from "@/lib/favorites/types";

import {
  buildHomeFavoriteRows,
  buildResultsFilterRows,
} from "@/lib/filters/groupedCombobox";
import { RESOLVED_FAVORITE_OPTIONS } from "@/lib/favorites/resolvedOptions";
import { GROUPED_GENRES } from "@/lib/events/groupedGenres";
import { type FavoriteOption } from "@/lib/favorites/options";
import { readSelected } from "@/lib/trip/store";
import { useFavoritesNearby } from "@/hooks/useFavoritesNearby";
import { useFavoritesSearch } from "@/hooks/useFavoritesSearch";

export default function FavoritesResultsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const tripId = (sp.get("tripId") || "").trim();
  const countryCode = (sp.get("countryCode") || "US,CA").trim() || "US,CA";

  const initialFavorite = useInitialFavorite(sp);

  const [selectedFavorite, setSelectedFavorite] =
    useState<Favorite | null>(initialFavorite);
  const [comboInput, setComboInput] = useState(initialFavorite?.label || "");
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});

  const [nearbyInput, setNearbyInput] = useState("");
  const [nearbyDraftFavorite, setNearbyDraftFavorite] =
    useState<Favorite | null>(null);
  const [appliedNearbyFavorite, setAppliedNearbyFavorite] =
    useState<Favorite | null>(null);
  const [showOnlyMatching, setShowOnlyMatching] = useState(false);
  const [hasRunNearbySearch, setHasRunNearbySearch] = useState(false);

  const favoriteRows = useMemo(
    () => buildHomeFavoriteRows(RESOLVED_FAVORITE_OPTIONS),
    []
  );

  const nearbyRows = useMemo(
    () => buildResultsFilterRows(GROUPED_GENRES, RESOLVED_FAVORITE_OPTIONS),
    []
  );

  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleOrderRef = useRef(0);
  const [visibleRankById, setVisibleRankById] = useState<Record<string, number>>(
    {}
  );

  const {
    resp,
    loading,
    err,
    hasRunMainSearch,
    searchStoppedRef,
    runSearch,
    stopMainSearch,
  } = useFavoritesSearch({
    tripId,
    countryCode,
    selectedFavorite,
    setAppliedNearbyFavorite,
    setNearbyDraftFavorite,
    setNearbyInput,
    setShowOnlyMatching,
  });

  const {
    statusByAnchorId,
    nearbyByAnchorId,
    expandedIds,
    setExpandedIds,
    nearbyChecking,
    runNearbyCheck,
    stopNearbySearch,
    resetNearbyUi,
    isNearbyStopped,
  } = useFavoritesNearby({
    resp,
    appliedNearbyFavorite,
    visibleRankById,
    addDaysYMD,
  });

  const isAnySearchRunning = loading || nearbyChecking;
  const canEditInputs = !isAnySearchRunning;

  const mainSearchButtonLabel = loading
    ? "Stop Search"
    : hasRunMainSearch && searchStoppedRef.current
      ? "Continue Search"
      : "Search";

  const nearbySearchButtonLabel = nearbyChecking
    ? "Stop Search"
    : hasRunNearbySearch && isNearbyStopped
      ? "Continue Search"
      : "Start Search";

  const activeNearbyLabel = useMemo(() => {
    return (appliedNearbyFavorite?.label || "").trim();
  }, [appliedNearbyFavorite]);

  const registerAnchor = useCallback((id: string, el: HTMLDivElement | null) => {
    if (!observerRef.current) return;
    if (el) {
      el.dataset.anchorId = id;
      observerRef.current.observe(el);
    }
  }, []);

  useEffect(() => {
    function sync() {
      if (!tripId) return;

      const nextMap: Record<string, boolean> = Object.fromEntries(
        readSelected(tripId).map((event) => [event.id, true])
      );

      setSelectedMap(nextMap);
    }

    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", sync);

    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [tripId]);

  useEffect(() => {
    observerRef.current?.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        let changed = false;
        const next: Record<string, number> = {};

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLDivElement).dataset.anchorId;
          if (!id) continue;
          next[id] = ++visibleOrderRef.current;
          changed = true;
        }

        if (changed) {
          setVisibleRankById((prev) => ({ ...prev, ...next }));
        }
      },
      {
        root: null,
        rootMargin: "250px 0px",
        threshold: 0.01,
      }
    );

    return () => {
      observerRef.current?.disconnect();
    };
  }, [resp?.anchorCards?.length]);

  useEffect(() => {
    if (!initialFavorite) return;
    stopNearbySearch();
    resetNearbyUi();
    runSearch(initialFavorite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nearbyRunKey = useMemo(() => {
    if (!appliedNearbyFavorite) return "";
    return [
      appliedNearbyFavorite.label || "",
      appliedNearbyFavorite.attractionId || "",
      appliedNearbyFavorite.seriesKey || "",
      appliedNearbyFavorite.defaultGenre || "",
    ].join("|");
  }, [appliedNearbyFavorite]);

  const draftNearbyRunKey = useMemo(() => {
    if (!nearbyDraftFavorite) return "";
    return [
      nearbyDraftFavorite.label || "",
      nearbyDraftFavorite.attractionId || "",
      nearbyDraftFavorite.seriesKey || "",
      nearbyDraftFavorite.defaultGenre || "",
    ].join("|");
  }, [nearbyDraftFavorite]);

  function handlePickF1(opt: FavoriteOption) {
    const next = makeFavorite({
      id: opt.id,
      label: opt.label,
      kind: opt.kind,
      attractionId: opt.attractionId,
      seriesKey: opt.seriesKey as SeriesKey | undefined,
      defaultGenre: opt.defaultGenre,
    });

    setSelectedFavorite(next);
    setComboInput(opt.label);
  }

  const grouped = useMemo(() => {
    const all = (resp?.anchorCards || []) as AnchorCard[];

    const filtered =
      showOnlyMatching && appliedNearbyFavorite
        ? all.filter((card) => statusByAnchorId[card.id] === "match")
        : all;

    return groupByDate(filtered);
  }, [resp, showOnlyMatching, statusByAnchorId, appliedNearbyFavorite]);

  const nearbyMatchCount = useMemo(
    () => Object.values(statusByAnchorId).filter((s) => s === "match").length,
    [statusByAnchorId]
  );

  const nearbyTotalCount = useMemo(
    () => resp?.anchorCards?.length || 0,
    [resp]
  );

  const hasNearbyUI = !!resp?.anchorCards?.length && !!selectedFavorite;

  const canContinueSameNearbySearch =
    hasRunNearbySearch &&
    isNearbyStopped &&
    !!appliedNearbyFavorite &&
    !!nearbyDraftFavorite &&
    nearbyRunKey === draftNearbyRunKey;

  return (
    <main className="app-shell">
      <div className="page-wrap py-4 pb-32 sm:py-6 sm:pb-24">
        <section className="mobile-card p-4 sm:p-7">
          <h1 className="text-2xl font-black text-slate-900">
            Add Events by Favorite
          </h1>

          <FavoritesSearchControls
            comboInput={comboInput}
            setComboInput={setComboInput}
            selectedFavorite={selectedFavorite}
            setSelectedFavorite={setSelectedFavorite}
            favoriteRows={favoriteRows}
            canEditInputs={canEditInputs}
            loading={loading}
            mainSearchButtonLabel={mainSearchButtonLabel}
            err={err}
            onPickFavorite={handlePickF1}
            onRunSearch={() => {
              stopNearbySearch();
              resetNearbyUi();
              runSearch();
            }}
            onStopSearch={() => {
              stopNearbySearch();
              stopMainSearch();
            }}
          />

          <FavoritesNearbyPanel
            canEditInputs={canEditInputs}
            hasNearbyUI={hasNearbyUI}
            selectedFavorite={selectedFavorite}
            nearbyInput={nearbyInput}
            setNearbyInput={setNearbyInput}
            nearbyRows={nearbyRows}
            nearbyDraftFavorite={nearbyDraftFavorite}
            setNearbyDraftFavorite={setNearbyDraftFavorite}
            appliedNearbyFavorite={appliedNearbyFavorite}
            nearbyChecking={nearbyChecking}
            hasRunNearbySearch={hasRunNearbySearch}
            isNearbyStopped={isNearbyStopped}
            canContinueSameNearbySearch={canContinueSameNearbySearch}
            nearbySearchButtonLabel={nearbySearchButtonLabel}
            nearbyMatchCount={nearbyMatchCount}
            showOnlyMatching={showOnlyMatching}
            setShowOnlyMatching={setShowOnlyMatching}
            resetNearbyUi={resetNearbyUi}
            stopNearbySearch={stopNearbySearch}
            runNearbyCheck={runNearbyCheck}
            setAppliedNearbyFavorite={setAppliedNearbyFavorite}
            setHasRunNearbySearch={setHasRunNearbySearch}
            makeFavorite={makeFavorite}
          />
        </section>

        <section className="mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:mt-5 sm:rounded-3xl sm:p-7">
          {loading ? (
            <div className="text-sm font-semibold text-slate-500">Loading…</div>
          ) : !resp || !resp.anchorCards?.length ? (
            <div className="text-sm font-semibold text-slate-500">
              NO EVENTS SCHEDULED
            </div>
          ) : (
            <div className="space-y-4 sm:space-y-5">
              <FavoritesNearbySummary
                appliedNearbyFavorite={!!appliedNearbyFavorite}
                nearbyChecking={nearbyChecking}
                nearbyMatchCount={nearbyMatchCount}
                nearbyTotalCount={nearbyTotalCount}
                selectedFavoriteLabel={selectedFavorite?.label || ""}
                activeNearbyLabel={activeNearbyLabel}
              />

              <FavoritesAnchorList
                grouped={grouped}
                selectedMap={selectedMap}
                setSelectedMap={setSelectedMap}
                tripId={tripId}
                appliedNearbyFavorite={appliedNearbyFavorite}
                statusByAnchorId={statusByAnchorId}
                nearbyByAnchorId={nearbyByAnchorId}
                expandedIds={expandedIds}
                setExpandedIds={setExpandedIds}
                registerAnchor={registerAnchor}
              />
            </div>
          )}
        </section>
      </div>

      <footer className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-5xl items-center justify-center px-4 py-3">
          <button
            type="button"
            onClick={() =>
              router.push(`/build-trip?tripId=${encodeURIComponent(tripId)}`)
            }
            className="min-w-[220px] rounded-2xl bg-slate-900 px-6 py-3 text-sm font-extrabold text-white shadow-sm"
          >
            View Trip
          </button>
        </div>
      </footer>
    </main>
  );
}