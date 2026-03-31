"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isYMD } from "@/lib/date/ymd";
import { toggleTripEvent, readSelected } from "@/lib/trip/store";
import { visibleGenresByBucket } from "@/lib/events/genres";
import { sortGenresByPopularity } from "@/lib/events/genreOrder";
import AreaSearchPanel from "./components/AreaSearchPanel";
import AreaGenreFilters from "./components/AreaGenreFilters";
import AreaResultsList from "./components/AreaResultsList";
import useAreaCities from "./hooks/useAreaCities";
import useAreaSearchState from "./hooks/useAreaSearchState";
import {
  type ApiResp,
  type FilterFamily,
  type NormEvent,
  clamp,
  collectAvailableGenresForFamily,
  eventMatchesGenre,
  eventToStored,
  groupByDate,
  norm,
} from "./utils";

export default function AreaResultsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const tripId = (sp.get("tripId") || "").trim();
  const autoSearchFlag = (sp.get("autoSearch") || "").trim() === "1";
  const autoRanRef = useRef(false);

  const cities = useAreaCities();

  const {
    search,
    setCityLabel,
    pickCity,
    setStartDate,
    setEndDate,
  } = useAreaSearchState(sp, autoSearchFlag);

  const [resp, setResp] = useState<ApiResp | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});
  const [activeFamily, setActiveFamily] = useState<FilterFamily>(null);
  const [activeGenre, setActiveGenre] = useState<string | null>(null);

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

  const runSearch = useCallback(async () => {
    const latN = Number(search.lat);
    const lonN = Number(search.lon);

    if (!search.cityLabel.trim() || !Number.isFinite(latN) || !Number.isFinite(lonN)) {
      alert("Please select a valid city.");
      return;
    }

    if (!isYMD(search.startDate) || !isYMD(search.endDate)) {
      alert("Please select valid start and end dates.");
      return;
    }

    setLoading(true);
    setErr(null);
    setHasSearched(true);
    setActiveFamily(null);
    setActiveGenre(null);

    try {
      const r = await fetch("/api/search/area", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          city: { label: search.cityLabel, lat: latN, lon: lonN },
          startDate: search.startDate,
          endDate: search.endDate,
          radiusMiles: clamp(search.radiusMiles, 10, 120),
          countryCode: "US,CA",
          favorites: [],
          genres: [],
        }),
      });

      const j = (await r.json()) as ApiResp;
      if (!r.ok) throw new Error((j as { error?: string })?.error || "Failed");

      console.log(
  "CODEFENDANTS MATCHES",
  (j.events || []).filter((e) =>
    String(e.name || "").toLowerCase().includes("codefendants")
  )
);

      setResp(j);

      const params = new URLSearchParams();
      params.set("tripId", tripId);
      params.set("cityLabel", search.cityLabel);
      params.set("lat", String(latN));
      params.set("lon", String(lonN));
      params.set("start", search.startDate);
      params.set("end", search.endDate);
      params.set("radiusMiles", String(clamp(search.radiusMiles, 10, 120)));
      router.replace(`/results/area?${params.toString()}`, { scroll: false });
    } catch (e) {
      const error = e as Error;
      setErr(error?.message || "Failed");
      setResp(null);
    } finally {
      setLoading(false);
    }
  }, [router, search, tripId]);

  useEffect(() => {
    if (!autoSearchFlag) return;
    if (autoRanRef.current) return;
    if (loading || hasSearched) return;

    const latN = Number(search.lat);
    const lonN = Number(search.lon);

    if (!search.cityLabel.trim()) return;
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) return;
    if (!isYMD(search.startDate) || !isYMD(search.endDate)) return;

    autoRanRef.current = true;
    runSearch();
  }, [
    autoSearchFlag,
    hasSearched,
    loading,
    runSearch,
    search.cityLabel,
    search.endDate,
    search.lat,
    search.lon,
    search.startDate,
  ]);

  const allEvents = resp?.events || [];

  const visibleSports = useMemo(
    () => collectAvailableGenresForFamily(allEvents, "sports"),
    [allEvents]
  );

  const visibleMusic = useMemo(
    () => collectAvailableGenresForFamily(allEvents, "music"),
    [allEvents]
  );

  const sportsGenres = useMemo(
    () => [...visibleGenresByBucket().sports].sort(sortGenresByPopularity),
    []
  );

  const concertGenres = useMemo(
    () => [...visibleGenresByBucket().music].sort(sortGenresByPopularity),
    []
  );

  const availableSportsSet = useMemo(
    () => new Set(visibleSports.map((label) => norm(label))),
    [visibleSports]
  );

  const availableConcertsSet = useMemo(
    () => new Set(visibleMusic.map((label) => norm(label))),
    [visibleMusic]
  );

  const filteredEvents = useMemo(() => {
    if (!activeGenre) return [];
    return allEvents.filter((event) => eventMatchesGenre(event, activeGenre));
  }, [allEvents, activeGenre]);

  const grouped = useMemo(() => groupByDate(filteredEvents), [filteredEvents]);

  function onToggle(event: NormEvent) {
    if (!tripId) return;

    toggleTripEvent(tripId, eventToStored(event));

    const stored = readSelected(tripId);
    setSelectedMap(Object.fromEntries(stored.map((e) => [e.id, true])));
  }

  function activateFamily(next: FilterFamily) {
    setActiveFamily(next);
    setActiveGenre(null);
  }

  return (
    <main className="app-shell">
      <div className="page-wrap py-4 pb-32 sm:py-6 sm:pb-24">
        <AreaSearchPanel
          cities={cities}
          search={search}
          loading={loading}
          err={err}
          onCityChange={setCityLabel}
          onCityPick={pickCity}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onSearch={runSearch}
        />

        <AreaGenreFilters
          show={hasSearched && !loading && !!resp}
          activeFamily={activeFamily}
          activeGenre={activeGenre}
          sportsGenres={sportsGenres}
          concertGenres={concertGenres}
          availableSportsSet={availableSportsSet}
          availableConcertsSet={availableConcertsSet}
          norm={norm}
          onActivateFamily={activateFamily}
          onSelectGenre={setActiveGenre}
        />

        <AreaResultsList
          hasSearched={hasSearched}
          loading={loading}
          resp={resp}
          activeGenre={activeGenre}
          grouped={grouped}
          selectedMap={selectedMap}
          onToggle={onToggle}
        />
      </div>

      <footer className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-5xl items-center justify-center px-4 py-3">
          <button
            type="button"
            onClick={() => router.push(`/build-trip?tripId=${encodeURIComponent(tripId)}`)}
            className="min-w-[220px] rounded-2xl bg-slate-900 px-6 py-3 text-sm font-extrabold text-white shadow-sm"
          >
            View Trip
          </button>
        </div>
      </footer>
    </main>
  );
}