"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GROUPED_GENRES } from "@/lib/events/groupedGenres";
import SharedEventCard from "@/app/components/events/SharedEventCard";
import SharedEventDateGroup from "@/app/components/events/SharedEventDateGroup";

type FavoriteKind = "team" | "artist" | "series";

type NormEvent = {
  id: string;
  name: string;
  pillLabel: string | null;
  localDate: string;
  localTime: string | null;
  city: string;
  region: string | null;
  venueName: string | null;
  url: string | null;
  matched?: {
    genres?: string[];
    favorites?: string[];
    attractionIds?: string[];
  };
};

type ApiResp = {
  mode: "area";
  city: { label: string; lat: number; lon: number };
  startDate: string;
  endDate: string;
  genres: string[];
  count: number;
  events: NormEvent[];
  error?: string;
};

type CarriedFavorite = {
  label: string;
  kind: FavoriteKind;
  attractionId?: string;
  seriesKey?: string;
  defaultGenre: string;
};

type FilterPanelMode = "hidden" | "sports" | "music";

const LS_SELECTED = "eventstack_selected_events_v1";
const LS_DELETED = "eventstack_deleted_events_v1";
const LS_LAST_AREA_QUERY = "eventstack_area_last_query_v1";

function readBooleanMap(key: string): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeBooleanMap(key: string, map: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}

function readSelectedMap(): Record<string, boolean> {
  return readBooleanMap(LS_SELECTED);
}

function writeSelectedMap(map: Record<string, boolean>) {
  writeBooleanMap(LS_SELECTED, map);
}

function clearSelected() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LS_SELECTED);
  } catch {}
}

function readDeletedMap(): Record<string, boolean> {
  return readBooleanMap(LS_DELETED);
}

function writeDeletedMap(map: Record<string, boolean>) {
  writeBooleanMap(LS_DELETED, map);
}

function countSelectedFromMap(map: Record<string, boolean>) {
  return Object.keys(map).filter((id) => !!map[id]).length;
}

function csvToList(value: string) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function favoriteIdentityKey(favorite: CarriedFavorite | null | undefined) {
  if (!favorite) return "";
  return String(favorite.attractionId || favorite.seriesKey || "").trim();
}

function areaQueryKey(input: {
  cityLabel: string;
  lat: number;
  lon: number;
  start: string;
  end: string;
  radiusMiles: number;
  countryCode: string;
  f1Key: string;
  f2Key: string;
  genresCsv: string;
}) {
  return [
    String(input.cityLabel || "").trim(),
    String(input.lat || ""),
    String(input.lon || ""),
    String(input.start || "").trim(),
    String(input.end || "").trim(),
    String(input.radiusMiles || ""),
    String(input.countryCode || "").trim(),
    String(input.f1Key || "").trim(),
    String(input.f2Key || "").trim(),
    String(input.genresCsv || "").trim().toLowerCase(),
  ].join("|");
}

function readLastAreaQueryKey() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(LS_LAST_AREA_QUERY) || "";
  } catch {
    return "";
  }
}

function writeLastAreaQueryKey(key: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_LAST_AREA_QUERY, key);
  } catch {}
}

function isYMD(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatSectionDate(dateStr: string) {
  if (!isYMD(dateStr)) return dateStr;
  const d = new Date(`${dateStr}T12:00:00`);
  return d
    .toLocaleDateString("en-CA", {
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
    })
    .toUpperCase();
}

function formatTime12h(time: string | null) {
  if (!time) return "";

  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return time;

  const date = new Date();
  date.setHours(h);
  date.setMinutes(m || 0);

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function sortEventsChronologically(events: NormEvent[]) {
  return [...events].sort((a, b) => {
    const diff = eventSortValue(a) - eventSortValue(b);
    if (diff !== 0) return diff;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function eventSortValue(event: NormEvent) {
  const date = String(event.localDate || "").trim();
  const rawTime = String(event.localTime || "").trim();

  if (!isYMD(date)) return Number.MAX_SAFE_INTEGER;

  const hhmm = rawTime.match(/^(\d{2}:\d{2})/)?.[1] || "23:59";
  const ts = Date.parse(`${date}T${hhmm}:00`);

  return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
}

function groupByDate(events: NormEvent[]) {
  const sorted = [...events].sort((a, b) => {
    const dateDiff = String(a.localDate || "").localeCompare(String(b.localDate || ""));
    if (dateDiff !== 0) return dateDiff;

    const timeDiff = eventSortValue(a) - eventSortValue(b);
    if (timeDiff !== 0) return timeDiff;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const map = new Map<string, NormEvent[]>();
  for (const event of sorted) {
    const key = event.localDate || "Unknown Date";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(event);
  }

  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function normalizeGenreKey(value: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeToken(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function eventStorageKey(e: NormEvent) {
  return [
    String(e.localDate || "").trim(),
    [String(e.city || "").trim(), String(e.region || "").trim()]
      .filter(Boolean)
      .join(", "),
    String(e.name || "").trim(),
    String(e.localTime || "").trim(),
    String(e.url || "").trim(),
  ].join("|");
}

function getEventFilterLabels(e: NormEvent): string[] {
  const raw = Array.isArray(e?.matched?.genres) ? e.matched!.genres! : [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of raw) {
    const val = String(item || "").trim();
    if (!val) continue;

    const key = normalizeGenreKey(val);
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(val);
  }

  if (out.length > 0) return out;

  const fallback = String(e.pillLabel || "").trim();
  return fallback ? [fallback] : [];
}

function pickDisplayPill(
  e: NormEvent,
  activeGenreKeys: Set<string>,
  carriedGenreKeys: Set<string>
): string | null {
  const labels = getEventFilterLabels(e);

  for (const label of labels) {
    if (activeGenreKeys.has(normalizeGenreKey(label))) {
      return label;
    }
  }

  for (const label of labels) {
    if (carriedGenreKeys.has(normalizeGenreKey(label))) {
      return label;
    }
  }

  return labels[0] || null;
}

function sortAlpha(filters: string[]) {
  return [...filters].sort((a, b) => a.localeCompare(b));
}

function readCarriedFavorite(
  sp: URLSearchParams,
  prefix: "f1" | "f2"
): CarriedFavorite | null {
  const label = String(sp.get(`${prefix}Label`) || "").trim();
  const kind = (String(sp.get(`${prefix}Kind`) || "team").trim().toLowerCase() ||
    "team") as FavoriteKind;
  const attractionId = String(sp.get(`${prefix}AttractionId`) || "").trim();
  const seriesKey = String(sp.get(`${prefix}SeriesKey`) || "").trim();
  const defaultGenre = String(sp.get(`${prefix}DefaultGenre`) || "").trim();

  if (!label) return null;
  if (!attractionId && !seriesKey) return null;

  return {
    label,
    kind,
    attractionId: attractionId || undefined,
    seriesKey: seriesKey || undefined,
    defaultGenre,
  };
}

function eventMatchesFavorite(e: NormEvent, favorite: CarriedFavorite | null) {
  if (!favorite) return false;

  const favoriteLabelKey = normalizeToken(favorite.label);
  const favoriteAttractionIdKey = normalizeToken(favorite.attractionId);

  const matchedFavorites = Array.isArray(e?.matched?.favorites)
    ? e.matched!.favorites!
    : [];
  const matchedAttractionIds = Array.isArray(e?.matched?.attractionIds)
    ? e.matched!.attractionIds!
    : [];

  const hasFavoriteLabel = matchedFavorites.some(
    (v) => normalizeToken(v) === favoriteLabelKey
  );

  const hasAttractionId =
    !!favoriteAttractionIdKey &&
    matchedAttractionIds.some(
      (v) => normalizeToken(v) === favoriteAttractionIdKey
    );

  if (favoriteAttractionIdKey) {
    return hasAttractionId;
  }

  return hasFavoriteLabel;
}

export default function AreaResultsPage() {
  const sp = useSearchParams();
  const router = useRouter();

  const cityLabel = sp.get("cityLabel") || "";
  const lat = Number(sp.get("lat") || "");
  const lon = Number(sp.get("lon") || "");
  const start = (sp.get("start") || "").trim();
  const end = (sp.get("end") || "").trim();
  const radiusMiles = Number(sp.get("radiusMiles") || "90");
  const countryCode = sp.get("countryCode") || "US,CA";
  const selectedEventIdFromQuery = (sp.get("selectedEventId") || "").trim();

  const tripDestIata = (sp.get("airportIata") || sp.get("destIata") || "")
    .trim()
    .toUpperCase();

  const carriedF1 = useMemo(() => readCarriedFavorite(sp, "f1"), [sp]);
  const carriedF2 = useMemo(() => readCarriedFavorite(sp, "f2"), [sp]);

  const carriedGenres = useMemo(() => {
    return csvToList(sp.get("genres") || "");
  }, [sp]);

  const carriedGenreKeys = useMemo(
    () => new Set(carriedGenres.map((g) => normalizeGenreKey(g))),
    [carriedGenres]
  );

  const hasCarriedFavorites = !!carriedF1 || !!carriedF2;
  const hasCarriedGenres = carriedGenres.length > 0;

  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});
  const [deletedMap, setDeletedMap] = useState<Record<string, boolean>>({});
  const [selectedCount, setSelectedCount] = useState(0);

  const [activeGenres, setActiveGenres] = useState<string[]>([]);
  const [lastDismissed, setLastDismissed] = useState<NormEvent | null>(null);
  const [filterPanelMode, setFilterPanelMode] = useState<FilterPanelMode>("hidden");

  const [selectedEventsOpen, setSelectedEventsOpen] = useState(true);

  function syncFromStorage() {
    const nextDeletedMap = readDeletedMap();
    const nextSelectedMap = readSelectedMap();

    setDeletedMap(nextDeletedMap);
    setSelectedMap(nextSelectedMap);
    setSelectedCount(countSelectedFromMap(nextSelectedMap));
  }

  useEffect(() => {
    const key = areaQueryKey({
      cityLabel,
      lat,
      lon,
      start,
      end,
      radiusMiles,
      countryCode,
      f1Key: favoriteIdentityKey(carriedF1),
      f2Key: favoriteIdentityKey(carriedF2),
      genresCsv: carriedGenres.join(","),
    });

    const last = readLastAreaQueryKey();

    if (last && last !== key) {
      clearSelected();
    }

    writeLastAreaQueryKey(key);

    syncFromStorage();

    setLastDismissed(null);
    setActiveGenres(carriedGenres.length > 0 ? carriedGenres : []);
    setFilterPanelMode("hidden");
  }, [
    cityLabel,
    lat,
    lon,
    start,
    end,
    radiusMiles,
    countryCode,
    carriedF1,
    carriedF2,
    carriedGenres,
  ]);

  useEffect(() => {
    function handleSync() {
      syncFromStorage();
    }

    window.addEventListener("focus", handleSync);
    window.addEventListener("pageshow", handleSync);
    document.addEventListener("visibilitychange", handleSync);

    return () => {
      window.removeEventListener("focus", handleSync);
      window.removeEventListener("pageshow", handleSync);
      document.removeEventListener("visibilitychange", handleSync);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);

      try {
        const r = await fetch("/api/search/area", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            city: { label: cityLabel, lat, lon },
            startDate: start,
            endDate: end,
            radiusMiles,
            countryCode,
            favorites: [carriedF1, carriedF2].filter(Boolean),
            genres: [],
          }),
        });

        const j = (await r.json()) as ApiResp;
        if (!r.ok) throw new Error((j as any)?.error || "Failed");

        if (!cancelled) setResp(j);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [
    cityLabel,
    lat,
    lon,
    start,
    end,
    radiusMiles,
    countryCode,
    carriedF1,
    carriedF2,
  ]);

  useEffect(() => {
    if (!lastDismissed) return;

    const t = window.setTimeout(() => {
      setLastDismissed(null);
    }, 5000);

    return () => window.clearTimeout(t);
  }, [lastDismissed]);

  const allEvents = resp?.events || [];

  useEffect(() => {
    if (!allEvents.length) return;

    setSelectedMap((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const e of allEvents) {
        if (!next[e.id]) continue;
        if (!deletedMap[eventStorageKey(e)]) continue;

        delete next[e.id];
        changed = true;
      }

      if (!changed) return prev;

      writeSelectedMap(next);
      setSelectedCount(countSelectedFromMap(next));
      return next;
    });
  }, [allEvents, deletedMap]);

  useEffect(() => {
    if (!selectedEventIdFromQuery) return;
    if (loading || err) return;
    if (!allEvents.length) return;

    const matchingEvent = allEvents.find((e) => e.id === selectedEventIdFromQuery);
    if (!matchingEvent) return;

    const deleteKey = eventStorageKey(matchingEvent);
    if (deletedMap[deleteKey]) return;

    setSelectedMap((prev) => {
      if (prev[selectedEventIdFromQuery]) return prev;

      const next = {
        [selectedEventIdFromQuery]: true,
        ...prev,
      };

      writeSelectedMap(next);
      setSelectedCount(countSelectedFromMap(next));
      return next;
    });
  }, [selectedEventIdFromQuery, loading, err, allEvents, deletedMap]);

  useEffect(() => {
    if (loading || err) return;
    if (!allEvents.length) return;
    if (!hasCarriedFavorites || hasCarriedGenres) return;

    const idsToSeed = allEvents
      .filter((e) => eventMatchesFavorite(e, carriedF1) || eventMatchesFavorite(e, carriedF2))
      .filter((e) => !deletedMap[eventStorageKey(e)])
      .map((e) => e.id);

    if (idsToSeed.length === 0) return;

    setSelectedMap((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const id of idsToSeed) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }

      if (!changed) return prev;

      writeSelectedMap(next);
      setSelectedCount(countSelectedFromMap(next));
      return next;
    });
  }, [
    loading,
    err,
    allEvents,
    carriedF1,
    carriedF2,
    hasCarriedFavorites,
    hasCarriedGenres,
    deletedMap,
  ]);

  const visibleBucketDefs = useMemo(() => {
    return {
      sports: GROUPED_GENRES.filter((g) => g.family === "sports").map((g) => g.label),
      music: GROUPED_GENRES.filter((g) => g.family === "music").map((g) => g.label),
    };
  }, []);

  const visibleGenreSet = useMemo(() => {
    return new Set(
      [...visibleBucketDefs.sports, ...visibleBucketDefs.music].map((g) =>
        normalizeGenreKey(g)
      )
    );
  }, [visibleBucketDefs]);

  const sportsGenreKeys = useMemo(
    () => new Set(visibleBucketDefs.sports.map((g) => normalizeGenreKey(g))),
    [visibleBucketDefs]
  );

  const musicGenreKeys = useMemo(
    () => new Set(visibleBucketDefs.music.map((g) => normalizeGenreKey(g))),
    [visibleBucketDefs]
  );

  const availableGenres = useMemo(() => {
    const raw = Array.isArray(resp?.genres) ? resp.genres : [];
    return sortAlpha(raw.filter((g) => visibleGenreSet.has(normalizeGenreKey(g))));
  }, [resp, visibleGenreSet]);

  const availableGenreKeys = useMemo(
    () => new Set(availableGenres.map((g) => normalizeGenreKey(g))),
    [availableGenres]
  );

  useEffect(() => {
    if (loading || err) return;

    setActiveGenres((prev) => {
      const kept = prev.filter((g) => availableGenreKeys.has(normalizeGenreKey(g)));

      const merged: string[] = [];
      const seen = new Set<string>();

      for (const g of kept) {
        const key = normalizeGenreKey(g);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(g);
      }

      return merged;
    });
  }, [loading, err, availableGenreKeys]);

  const activeGenreKeys = useMemo(
    () => new Set(activeGenres.map((g) => normalizeGenreKey(g))),
    [activeGenres]
  );

  useEffect(() => {
    if (activeGenres.length === 0) return;

    const first = normalizeGenreKey(activeGenres[0]);

    if (sportsGenreKeys.has(first)) {
      setFilterPanelMode("sports");
      return;
    }

    if (musicGenreKeys.has(first)) {
      setFilterPanelMode("music");
      return;
    }
  }, [activeGenres, sportsGenreKeys, musicGenreKeys]);

  const deletedEventKeySet = useMemo(() => {
    return new Set(Object.keys(deletedMap).filter((id) => !!deletedMap[id]));
  }, [deletedMap]);

  const selectedEventIdSet = useMemo(() => {
    return new Set(Object.keys(selectedMap).filter((id) => !!selectedMap[id]));
  }, [selectedMap]);

  const bucketedGenres = useMemo(() => {
    return {
      sports: visibleBucketDefs.sports.filter((g) =>
        availableGenreKeys.has(normalizeGenreKey(g))
      ),
      music: visibleBucketDefs.music.filter((g) =>
        availableGenreKeys.has(normalizeGenreKey(g))
      ),
    };
  }, [visibleBucketDefs, availableGenreKeys]);

  const visibleEvents = useMemo(() => {
    return allEvents.filter((e) => {
      const deleteKey = eventStorageKey(e);

      if (deletedEventKeySet.has(deleteKey)) return false;
      if (selectedEventIdSet.has(e.id)) return true;
      if (!e.url) return false;

      const labels = getEventFilterLabels(e).filter((label) =>
        visibleGenreSet.has(normalizeGenreKey(label))
      );
      if (labels.length === 0) return false;
      if (activeGenreKeys.size === 0) return false;

      return labels.some((label) => activeGenreKeys.has(normalizeGenreKey(label)));
    });
  }, [
    allEvents,
    deletedEventKeySet,
    selectedEventIdSet,
    activeGenreKeys,
    visibleGenreSet,
  ]);

  const selectedVisibleEvents = useMemo(() => {
    return sortEventsChronologically(
      visibleEvents.filter((e) => selectedEventIdSet.has(e.id))
    );
  }, [visibleEvents, selectedEventIdSet]);

  const unselectedVisibleEvents = useMemo(() => {
    return visibleEvents.filter((e) => !selectedEventIdSet.has(e.id));
  }, [visibleEvents, selectedEventIdSet]);

  const groupedSelectedEvents = useMemo(
    () => groupByDate(selectedVisibleEvents),
    [selectedVisibleEvents]
  );

  const groupedEvents = useMemo(
    () => groupByDate(unselectedVisibleEvents),
    [unselectedVisibleEvents]
  );

  const noUnselectedEventsForActiveFilters =
    filterPanelMode !== "hidden" &&
    activeGenreKeys.size > 0 &&
    visibleEvents.length > 0 &&
    unselectedVisibleEvents.length === 0;

  const carriedFilterSummary = useMemo(() => {
    const parts: string[] = [];

    if (carriedF1?.label) parts.push(`F1: ${carriedF1.label}`);
    if (carriedF2?.label) parts.push(`F2: ${carriedF2.label}`);
    carriedGenres.forEach((g, i) => parts.push(`G${i + 1}: ${g}`));

    return parts;
  }, [carriedF1, carriedF2, carriedGenres]);

  function toggleSelectedEventsOpen() {
    setSelectedEventsOpen((prev) => !prev);
  }

  function onToggleEvent(e: NormEvent) {
    const deleteKey = eventStorageKey(e);
    if (deletedMap[deleteKey]) return;

    setSelectedMap((prev) => {
      const next = { ...prev };

      if (next[e.id]) {
        delete next[e.id];
      } else {
        next[e.id] = true;
      }

      writeSelectedMap(next);
      setSelectedCount(countSelectedFromMap(next));
      return next;
    });
  }

  function onRemoveSelectedEvent(eventIdToRemove: string) {
    setSelectedMap((prev) => {
      if (!prev[eventIdToRemove]) return prev;

      const next = { ...prev };
      delete next[eventIdToRemove];
      writeSelectedMap(next);
      setSelectedCount(countSelectedFromMap(next));
      return next;
    });
  }

  function onToggleGenre(genre: string) {
    const key = normalizeGenreKey(genre);
    if (!availableGenreKeys.has(key)) return;

    setActiveGenres((prev) => {
      const exists = prev.some((g) => normalizeGenreKey(g) === key);
      if (exists) return [];
      return [genre];
    });
  }

  function onDismissEvent(event: NormEvent) {
    const deleteKey = eventStorageKey(event);

    setDeletedMap((prevDeleted) => {
      const nextDeleted = { ...prevDeleted, [deleteKey]: true };
      writeDeletedMap(nextDeleted);
      return nextDeleted;
    });

    setSelectedMap((prevSelected) => {
      if (!prevSelected[event.id]) return prevSelected;

      const nextSelected = { ...prevSelected };
      delete nextSelected[event.id];
      writeSelectedMap(nextSelected);
      setSelectedCount(countSelectedFromMap(nextSelected));
      return nextSelected;
    });

    setLastDismissed(event);
  }

  function onUndoDismiss() {
    if (!lastDismissed) return;

    const deleteKey = eventStorageKey(lastDismissed);

    setDeletedMap((prevDeleted) => {
      const nextDeleted = { ...prevDeleted };
      delete nextDeleted[deleteKey];
      writeDeletedMap(nextDeleted);
      return nextDeleted;
    });

    setLastDismissed(null);
  }

  function onBuildTrip() {
    if (!canBuild) return;

    const q = new URLSearchParams();
    q.set("tripStyle", "A");
    q.set("start", start);
    q.set("end", end);
    q.set("radiusMiles", String(radiusMiles));
    q.set("countryCode", countryCode);
    q.set("resetSel", "1");

    if (cityLabel) q.set("cityLabel", cityLabel);
    if (Number.isFinite(lat)) q.set("lat", String(lat));
    if (Number.isFinite(lon)) q.set("lon", String(lon));

    if (tripDestIata) {
      q.set("destIata", tripDestIata);
    }

    if (carriedF1?.label) {
      q.set("f1Label", carriedF1.label);
      q.set("f1Kind", carriedF1.kind);
      if (carriedF1.attractionId) q.set("f1AttractionId", carriedF1.attractionId);
      if (carriedF1.seriesKey) q.set("f1SeriesKey", carriedF1.seriesKey);
      if (carriedF1.defaultGenre) q.set("f1DefaultGenre", carriedF1.defaultGenre);
    }

    if (carriedF2?.label) {
      q.set("f2Label", carriedF2.label);
      q.set("f2Kind", carriedF2.kind);
      if (carriedF2.attractionId) q.set("f2AttractionId", carriedF2.attractionId);
      if (carriedF2.seriesKey) q.set("f2SeriesKey", carriedF2.seriesKey);
      if (carriedF2.defaultGenre) q.set("f2DefaultGenre", carriedF2.defaultGenre);
    }

    if (carriedGenres.length) {
      q.set("genres", carriedGenres.join(","));
    }

    router.push(`/build-trip?${q.toString()}`);
  }

  const canBuild =
    selectedCount > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(start) &&
    /^\d{4}-\d{2}-\d{2}$/.test(end);

  function toggleFilterPanelMode(nextMode: Exclude<FilterPanelMode, "hidden">) {
    setFilterPanelMode((prev) => {
      if (prev === nextMode) {
        setActiveGenres([]);
        return "hidden";
      }

      setActiveGenres([]);
      return nextMode;
    });
  }

  function renderTopLevelBucketButtons() {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={() => toggleFilterPanelMode("sports")}
          style={{
            minHeight: 42,
            padding: "0 14px",
            borderRadius: 12,
            border: "1px solid #d9e0ea",
            background: filterPanelMode === "sports" ? "#17315f" : "#fff",
            color: filterPanelMode === "sports" ? "#fff" : "#17315f",
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          Sports
        </button>

        <button
          type="button"
          onClick={() => toggleFilterPanelMode("music")}
          style={{
            minHeight: 42,
            padding: "0 14px",
            borderRadius: 12,
            border: "1px solid #d9e0ea",
            background: filterPanelMode === "music" ? "#17315f" : "#fff",
            color: filterPanelMode === "music" ? "#fff" : "#17315f",
            fontSize: 14,
            fontWeight: 800,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          Music
        </button>
      </div>
    );
  }

  function renderGenreButtons(filters: string[]) {
    if (filters.length === 0) {
      return <div style={{ fontSize: 13, color: "#8a94a6", fontWeight: 600 }}>None</div>;
    }

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 8,
        }}
      >
        {filters.map((genre) => {
          const key = normalizeGenreKey(genre);
          const on = activeGenreKeys.has(key);

          return (
            <button
              key={genre}
              type="button"
              onClick={() => onToggleGenre(genre)}
              style={{
                minHeight: 38,
                padding: "0 12px",
                borderRadius: 10,
                border: on ? "1px solid #111" : "1px solid #d9e0ea",
                background: on ? "#111" : "#fff",
                color: on ? "#fff" : "#17315f",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                lineHeight: 1.1,
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
              }}
            >
              {genre}
            </button>
          );
        })}
      </div>
    );
  }

  function renderEventCard(e: NormEvent) {
    const selected = !!selectedMap[e.id];
    const pill = pickDisplayPill(e, activeGenreKeys, carriedGenreKeys);

    return (
      <SharedEventCard
        title={e.name}
        subtitle={`${e.city}${e.region ? `, ${e.region}` : ""}${
          e.localTime ? ` • ${formatTime12h(e.localTime)}` : ""
        }`}
        primaryPill={pill}
        ticketHref={e.url}
        showTickets={!!e.url}
        selected={selected}
        onCardClick={
          selected
            ? undefined
            : () => {
                onToggleEvent(e);
              }
        }
        onRemove={
          selected
            ? () => {
                onRemoveSelectedEvent(e.id);
              }
            : undefined
        }
        removeAriaLabel="Remove from selected events"
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fb", fontFamily: "system-ui" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "14px 10px 96px" }}>
        {loading && <div>Loading…</div>}
        {err && <div style={{ color: "crimson" }}>{err}</div>}

        {!loading && !err && (
          <div
            style={{
              marginBottom: 16,
              background: "#eef4ff",
              border: "1px solid #c9d8f2",
              borderRadius: 20,
              padding: 14,
              boxShadow: "0 10px 24px rgba(23,49,95,0.08)",
            }}
          >
            <button
              type="button"
              onClick={toggleSelectedEventsOpen}
              aria-expanded={selectedEventsOpen}
              aria-label={selectedEventsOpen ? "Hide selected events" : "Show selected events"}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                padding: 0,
                marginBottom: selectedEventsOpen ? 14 : 0,
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  margin: "6px 0 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  width: "100%",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: "linear-gradient(to right, transparent, #17315f)",
                    borderRadius: 2,
                  }}
                />

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 999,
                    background: "#17315f",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                    boxShadow: "0 4px 12px rgba(23,49,95,0.25)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      transform: selectedEventsOpen ? "rotate(0deg)" : "rotate(-90deg)",
                      transition: "transform 120ms ease",
                    }}
                  >
                    ↓
                  </span>
                  EVENTS YOU ARE INTERESTED IN
                  <span
                    style={{
                      fontSize: 14,
                      transform: selectedEventsOpen ? "rotate(0deg)" : "rotate(-90deg)",
                      transition: "transform 120ms ease",
                    }}
                  >
                    ↓
                  </span>
                </div>

                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: "linear-gradient(to left, transparent, #17315f)",
                    borderRadius: 2,
                  }}
                />
              </div>
            </button>

            {selectedEventsOpen && (
              <>
                {groupedSelectedEvents.length > 0 ? (
                  groupedSelectedEvents.map(([date, items]) => (
                    <SharedEventDateGroup
                      key={`selected-${date}`}
                      title={formatSectionDate(date)}
                      className="mb-[14px]"
                    >
                      {items.map((e) => (
                        <React.Fragment key={e.id}>
                          {renderEventCard(e)}
                        </React.Fragment>
                      ))}
                    </SharedEventDateGroup>
                  ))
                ) : (
                  <div
  style={{
    background: "#fff",
    border: "1px solid #d9e0ea",
    borderRadius: 16,
    padding: "16px 14px",
    color: "#536b8f",
    fontWeight: 700,
    textAlign: "center",
  }}
>
  <div style={{ color: "#dc2626", fontWeight: 800 }}>
    ADD EVENTS BELOW
  </div>

  <div style={{ marginTop: 4, fontWeight: 600 }}>
    Selected events will appear here.
  </div>
</div>
                )}

                <div style={{ marginTop: 14 }}>
                  <button
                    onClick={onBuildTrip}
                    disabled={!canBuild}
                    style={{
                      width: "100%",
                      height: 44,
                      borderRadius: 16,
                      border: "none",
                      background: "#07173a",
                      color: "#fff",
                      fontSize: 16,
                      fontWeight: 800,
                      opacity: canBuild ? 1 : 0.45,
                      cursor: canBuild ? "pointer" : "default",
                    }}
                  >
                    Save / Share Trip
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!loading && !err && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 12px 10px",
              background: "#ffffff",
              border: "1px solid #d9e0ea",
              borderRadius: 18,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: "#536b8f",
                marginBottom: 10,
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              <div
                style={{
                  margin: "6px 0 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: "linear-gradient(to right, transparent, #17315f)",
                    borderRadius: 2,
                  }}
                />

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 999,
                    background: "#17315f",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                    boxShadow: "0 4px 12px rgba(23,49,95,0.25)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ fontSize: 14 }}>↓</span>
                  ADD EVENTS USING THESE FILTERS
                  <span style={{ fontSize: 14 }}>↓</span>
                </div>

                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: "linear-gradient(to left, transparent, #17315f)",
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>

            {renderTopLevelBucketButtons()}

            {filterPanelMode !== "hidden" && (
              <div style={{ marginTop: 12 }}>
                {renderGenreButtons(
                  filterPanelMode === "sports"
                    ? bucketedGenres.sports
                    : bucketedGenres.music
                )}
              </div>
            )}

            {noUnselectedEventsForActiveFilters && (
              <div
                style={{
                  marginTop: 12,
                  background: "#f8fbff",
                  border: "1px solid #d9e0ea",
                  borderRadius: 14,
                  padding: "12px 14px",
                  color: "#536b8f",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                All matching events are already in your selected list.
              </div>
            )}
          </div>
        )}

        {!loading &&
          !err &&
          groupedEvents.length === 0 &&
          selectedVisibleEvents.length === 0 &&
          (carriedFilterSummary.length > 0 || activeGenreKeys.size > 0) && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #d9e0ea",
                borderRadius: 18,
                padding: "16px 14px",
                color: "#536b8f",
                fontWeight: 700,
              }}
            >
              {carriedFilterSummary.length > 0
                ? "No events match the carried Favorites / genre filters."
                : "No events match the current filters."}
            </div>
          )}

        {!loading && !err && groupedEvents.length > 0 && (
          <div>
            {groupedEvents.map(([date, items]) => (
              <SharedEventDateGroup
                key={date}
                title={formatSectionDate(date)}
                className="mb-[14px]"
              >
                {items.map((e) => (
                  <React.Fragment key={e.id}>
                    {renderEventCard(e)}
                  </React.Fragment>
                ))}
              </SharedEventDateGroup>
            ))}
          </div>
        )}
      </div>

      {lastDismissed && (
        <div
          style={{
            position: "sticky",
            bottom: 68,
            zIndex: 20,
            padding: "0 12px 10px",
          }}
        >
          <div
            style={{
              maxWidth: 860,
              margin: "0 auto",
              background: "#071b3b",
              color: "#fff",
              borderRadius: 14,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              boxShadow: "0 8px 22px rgba(7,27,59,0.22)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Event hidden: {lastDismissed.name}
            </div>

            <button
              type="button"
              onClick={onUndoDismiss}
              style={{
                flexShrink: 0,
                height: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.35)",
                background: "#fff",
                color: "#071b3b",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}