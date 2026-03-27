"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { csvToList, listToCsv } from "@/lib/url";
import { fmtYMDPretty, isYMD } from "@/lib/trips/sharePayload";
import SharedEventCard from "@/app/components/events/SharedEventCard";
import SharedEventDateGroup from "@/app/components/events/SharedEventDateGroup";
import GroupedComboBox from "@/app/components/GroupedComboBox";
import { buildResultsFilterRows, filterComboRows } from "@/lib/filters/groupedCombobox";
import { type FavoriteOption as SavedFavoriteOption } from "@/lib/favorites/options";
import { RESOLVED_FAVORITE_OPTIONS } from "@/lib/favorites/resolvedOptions";
import { GROUPED_GENRES } from "@/lib/events/groupedGenres";

type FavoriteKind = "team" | "artist" | "series";

type Favorite = {
  id: string;
  label: string;
  kind: FavoriteKind;
  attractionId?: string;
  seriesKey?: string;
  defaultGenre: string;
};

type AnchorCard = {
  id: string;
  name: string;
  localDate: string;
  localTime: string | null;
  city: string;
  region: string | null;
  venueName: string | null;
  lat: number | null;
  lon: number | null;
  url: string | null;
  matched: {
    favorites: string[];
    defaultGenres: string[];
    genres?: string[];
  };
  isCrossover: boolean;
};

type NearbyEvent = {
  id: string;
  name: string;
  localDate: string;
  localTime: string | null;
  city: string;
  region: string | null;
  venueName: string | null;
  url: string | null;
  matched: {
    favorites: string[];
    defaultGenres: string[];
    genres?: string[];
  };
};

type ApiResp = {
  mode: "favorites";
  favorites: { id: string; label: string; defaultGenre: string }[];
  startDate: string | null;
  endDate: string | null;
  count: number;
  anchorCards: AnchorCard[];
  error?: string;
};

type ContextState = {
  loading: boolean;
  error: string;
  presentFavorites: string[];
  presentGenres: string[];
  requirementsMet: boolean;
  nearbyEvents: NearbyEvent[];
};

type PersistedFavoritesState = {
  comboInput: string;
  selectedF2: Favorite | null;
  selectedGenres: string[];
  resp: ApiResp | null;
  err: string | null;
  ctxCache: Record<string, ContextState>;
  displayedCards: AnchorCard[];
  filterPassActive: boolean;
  filterPassDone: boolean;
  checkedCount: number;
  yesCount: number;
  noCount: number;
  showOnlyMatching: boolean;
  expandedCardId: string | null;
  savedAt: number;
};

const AREA_RADIUS_MILES = 90;
const ANCHOR_DAY_WINDOW = 2;
const STORAGE_TTL_MS = 1000 * 60 * 60 * 8;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function normLoose(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findExactSportsAliasGenre(input: string) {
  const q = normLoose(input);
  if (!q) return null;

  const sportsGenres = GROUPED_GENRES.filter((g) => g.family === "sports");

  for (const genre of sportsGenres) {
    const candidates = [genre.label, ...(genre.aliases || [])].map(normLoose);
    if (candidates.includes(q)) {
      return genre.label;
    }
  }

  return null;
}

function normalizeToken(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function makeFavorite(args: {
  id: string;
  label: string;
  kind?: FavoriteKind;
  attractionId?: string;
  seriesKey?: string;
  defaultGenre?: string;
}): Favorite {
  return {
    id: args.id,
    label: args.label,
    kind: args.kind || "team",
    attractionId: args.attractionId,
    seriesKey: args.seriesKey,
    defaultGenre: args.defaultGenre || "",
  };
}

function favoriteIdentityKey(fav: Favorite | null | undefined) {
  if (!fav) return "";
  return String(fav.attractionId || fav.seriesKey || "").trim();
}

function addDaysLocalYMD(ymd: string, days: number) {
  if (!isYMD(ymd)) return "";
  const [yy, mm, dd] = ymd.split("-").map(Number);
  const dt = new Date(yy, mm - 1, dd);
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fmtTimeDisplay(localTime: string | null | undefined) {
  const raw = String(localTime || "").trim();
  if (!raw) return "Time TBD";

  const m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return raw;

  const hh = Number(m[1]);
  const mm = m[2];
  if (!Number.isFinite(hh)) return raw;

  const suffix = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${mm} ${suffix}`;
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asNullableString(value: unknown) {
  const s = asString(value);
  return s || null;
}

function asNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function uniqStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((v) => asString(v))
        .filter(Boolean)
    )
  );
}

function normalizeNearbyEvent(raw: any, fallbackIndex: number): NearbyEvent | null {
  if (!raw || typeof raw !== "object") return null;

  const id =
    asString(raw.id) ||
    asString(raw.eventId) ||
    asString(raw.tmId) ||
    asString(raw._id) ||
    `nearby-${fallbackIndex}`;

  const name =
    asString(raw.name) ||
    asString(raw.title) ||
    asString(raw.eventName) ||
    asString(raw.label);

  if (!name) return null;

  const city =
    asString(raw.city) ||
    asString(raw.market) ||
    asString(raw.locationCity) ||
    asString(raw.venue?.city) ||
    asString(raw._embedded?.venues?.[0]?.city?.name);

  const region =
    asNullableString(raw.region) ||
    asNullableString(raw.state) ||
    asNullableString(raw.province) ||
    asNullableString(raw.venue?.region) ||
    asNullableString(raw._embedded?.venues?.[0]?.state?.stateCode) ||
    asNullableString(raw._embedded?.venues?.[0]?.state?.name);

  const venueName =
    asNullableString(raw.venueName) ||
    asNullableString(raw.venue) ||
    asNullableString(raw.venue?.name) ||
    asNullableString(raw._embedded?.venues?.[0]?.name);

  const localDate =
    asString(raw.localDate) ||
    asString(raw.date) ||
    asString(raw.startDate) ||
    asString(raw.dates?.start?.localDate);

  const localTime =
    asNullableString(raw.localTime) ||
    asNullableString(raw.time) ||
    asNullableString(raw.startTime) ||
    asNullableString(raw.dates?.start?.localTime);

  const matchedFavorites = uniqStrings([
    ...asArray(raw.matched?.favorites),
    ...asArray(raw.presentFavorites),
    ...asArray(raw.favorites),
  ]);

  const matchedDefaultGenres = uniqStrings([
    ...asArray(raw.matched?.defaultGenres),
    ...asArray(raw.defaultGenres),
  ]);

  const matchedGenres = uniqStrings([
    ...asArray(raw.matched?.genres),
    ...asArray(raw.genres),
    ...asArray(raw.presentGenres),
  ]);

  return {
    id,
    name,
    localDate,
    localTime,
    city: city || "Location TBD",
    region,
    venueName,
    url:
      asNullableString(raw.url) ||
      asNullableString(raw.ticketUrl) ||
      asNullableString(raw.href),
    matched: {
      favorites: matchedFavorites,
      defaultGenres: matchedDefaultGenres,
      genres: matchedGenres,
    },
  };
}

function collectNearbyCandidates(json: any): any[] {
  const topLevelCandidates = [
    json?.nearbyEvents,
    json?.events,
    json?.matches,
    json?.items,
    json?.results,
    json?.context?.nearbyEvents,
    json?.context?.events,
    json?.data?.nearbyEvents,
    json?.data?.events,
  ];

  for (const candidate of topLevelCandidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

export default function FavoritesResultsPage() {
  const sp = useSearchParams();
  const router = useRouter();

  const countryCode = sp.get("countryCode") || "US,CA";

  const f1Label = sp.get("f1Label") || "";
  const f1AttractionId = sp.get("f1AttractionId") || "";
  const f1SeriesKey = sp.get("f1SeriesKey") || "";
  const f1Kind = (sp.get("f1Kind") || "team") as FavoriteKind;
  const f1DefaultGenre = sp.get("f1DefaultGenre") || "Hockey";

  const initialF2 = useMemo(() => {
    const label = sp.get("f2Label") || "";
    const attractionId = sp.get("f2AttractionId") || "";
    const seriesKey = sp.get("f2SeriesKey") || "";
    const kind = (sp.get("f2Kind") || "team") as FavoriteKind;
    const defaultGenre = sp.get("f2DefaultGenre") || "";

    if (!label) return null;
    if (!attractionId && !seriesKey) return null;

    return makeFavorite({
      id: "F2",
      label,
      kind,
      attractionId: attractionId || undefined,
      seriesKey: seriesKey || undefined,
      defaultGenre: defaultGenre || "",
    });
  }, [sp]);

  const initialGenres = useMemo(() => {
    return csvToList(sp.get("genres") || "")
      .map((g) => String(g).trim())
      .filter(Boolean)
      .slice(0, 1);
  }, [sp]);

  const f1 = useMemo(() => {
    return makeFavorite({
      id: "F1",
      label: f1Label,
      kind: f1Kind,
      attractionId: f1AttractionId || undefined,
      seriesKey: f1SeriesKey || undefined,
      defaultGenre: f1DefaultGenre,
    });
  }, [f1Label, f1Kind, f1AttractionId, f1SeriesKey, f1DefaultGenre]);

  const f1DisplayLabel = useMemo(() => {
    return (f1.label || "Favorite 1").toUpperCase();
  }, [f1.label]);

  const [selectedF2, setSelectedF2] = useState<Favorite | null>(initialF2);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(initialGenres);
  const [comboInput, setComboInput] = useState("");

  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [ctxCache, setCtxCache] = useState<Record<string, ContextState>>({});
  const [displayedCards, setDisplayedCards] = useState<AnchorCard[]>([]);
  const [filterPassActive, setFilterPassActive] = useState(false);
  const [filterPassDone, setFilterPassDone] = useState(false);
  const [checkedCount, setCheckedCount] = useState(0);
  const [yesCount, setYesCount] = useState(0);
  const [noCount, setNoCount] = useState(0);
  const [currentlyCheckingId, setCurrentlyCheckingId] = useState<string | null>(null);
  const [showOnlyMatching, setShowOnlyMatching] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [hydratedFromStorage, setHydratedFromStorage] = useState(false);

  const searchAbortRef = useRef<AbortController | null>(null);
  const filterRunIdRef = useRef(0);
  const ctxCacheRef = useRef<Record<string, ContextState>>({});

  const storageKey = useMemo(() => {
    const f1Identity = favoriteIdentityKey(f1) || f1.label || "unknown";
    return [
      "favorites-results-v2",
      countryCode,
      normalizeToken(f1.label),
      normalizeToken(f1Identity),
    ].join("__");
  }, [countryCode, f1]);

  useEffect(() => {
    ctxCacheRef.current = ctxCache;
  }, [ctxCache]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) {
        setHydratedFromStorage(true);
        return;
      }

      const saved = JSON.parse(raw) as PersistedFavoritesState;
      const age = Date.now() - Number(saved?.savedAt || 0);

      if (!saved || age > STORAGE_TTL_MS) {
        sessionStorage.removeItem(storageKey);
        setHydratedFromStorage(true);
        return;
      }

      setComboInput(saved.comboInput || "");
      setSelectedF2(saved.selectedF2 || null);
      setSelectedGenres(Array.isArray(saved.selectedGenres) ? saved.selectedGenres.slice(0, 1) : []);
      setResp(saved.resp || null);
      setErr(saved.err || null);
      setCtxCache(saved.ctxCache || {});
      setDisplayedCards(Array.isArray(saved.displayedCards) ? saved.displayedCards : []);
      setFilterPassActive(Boolean(saved.filterPassActive));
      setFilterPassDone(Boolean(saved.filterPassDone));
      setCheckedCount(Number(saved.checkedCount || 0));
      setYesCount(Number(saved.yesCount || 0));
      setNoCount(Number(saved.noCount || 0));
      setShowOnlyMatching(Boolean(saved.showOnlyMatching));
      setExpandedCardId(saved.expandedCardId || null);
    } catch {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
    } finally {
      setHydratedFromStorage(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydratedFromStorage) return;

    try {
      const nextState: PersistedFavoritesState = {
        comboInput,
        selectedF2,
        selectedGenres,
        resp,
        err,
        ctxCache,
        displayedCards,
        filterPassActive,
        filterPassDone,
        checkedCount,
        yesCount,
        noCount,
        showOnlyMatching,
        expandedCardId,
        savedAt: Date.now(),
      };

      sessionStorage.setItem(storageKey, JSON.stringify(nextState));
    } catch {}
  }, [
    hydratedFromStorage,
    storageKey,
    comboInput,
    selectedF2,
    selectedGenres,
    resp,
    err,
    ctxCache,
    displayedCards,
    filterPassActive,
    filterPassDone,
    checkedCount,
    yesCount,
    noCount,
    showOnlyMatching,
    expandedCardId,
  ]);

  useEffect(() => {
    if (!hydratedFromStorage) return;

    const incomingF2 = initialF2;
    const sameF2 =
      normalizeToken(incomingF2?.label) === normalizeToken(selectedF2?.label) &&
      normalizeToken(favoriteIdentityKey(incomingF2)) ===
        normalizeToken(favoriteIdentityKey(selectedF2)) &&
      normalizeToken(incomingF2?.defaultGenre) === normalizeToken(selectedF2?.defaultGenre) &&
      normalizeToken(incomingF2?.kind) === normalizeToken(selectedF2?.kind);

    if (!sameF2) {
      setSelectedF2(incomingF2);
    }

    const nextGenres = initialGenres;
    const sameGenres =
      nextGenres.length === selectedGenres.length &&
      nextGenres.every((g, i) => normalizeToken(g) === normalizeToken(selectedGenres[i]));

    if (!sameGenres) {
      setSelectedGenres(nextGenres);
    }
  }, [hydratedFromStorage, initialF2, initialGenres]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableFavorites = useMemo(() => {
    const f1Identity = favoriteIdentityKey(f1);

    return RESOLVED_FAVORITE_OPTIONS.filter((opt) => {
      const sameLabel = normalizeToken(opt.label) === normalizeToken(f1.label);
      const sameIdentity =
        normalizeToken(String(opt.attractionId || opt.seriesKey || "")) ===
        normalizeToken(f1Identity);

      return !sameLabel && !sameIdentity;
    });
  }, [f1]);

  const filterRows = useMemo(() => {
    if (selectedF2 || selectedGenres.length > 0) return [];
    return buildResultsFilterRows(GROUPED_GENRES, availableFavorites);
  }, [availableFavorites, selectedF2, selectedGenres]);

  const filteredOptionCount = useMemo(() => {
    if (selectedF2 || selectedGenres.length > 0 || !comboInput.trim()) return 0;
    return filterComboRows(filterRows, comboInput, 100).filter((row) => row.type === "option").length;
  }, [filterRows, comboInput, selectedF2, selectedGenres]);

  const searchRequestBody = useMemo(() => {
    return {
      favorite1: f1,
      favorite2: null,
      startDate: null,
      endDate: null,
      countryCode,
    };
  }, [f1, countryCode]);

  const selectedFilterLabel = selectedF2
    ? selectedF2.label
    : selectedGenres[0]
    ? selectedGenres[0]
    : "";

  const selectedFilterIdentity = useMemo(() => {
    if (selectedF2) return favoriteIdentityKey(selectedF2) || selectedF2.label;
    if (selectedGenres[0]) return selectedGenres[0];
    return "";
  }, [selectedF2, selectedGenres]);

  const needsContextCheck = Boolean(selectedFilterLabel);
  const cards = useMemo(() => resp?.anchorCards ?? [], [resp?.anchorCards]);

  const updateUrl = useCallback(
    (nextF2: Favorite | null, nextGenres: string[]) => {
      const params = new URLSearchParams();

      params.set("countryCode", countryCode);
      params.set("f1Label", f1.label);
      params.set("f1Kind", f1.kind);
      if (f1.attractionId) params.set("f1AttractionId", f1.attractionId);
      if (f1.seriesKey) params.set("f1SeriesKey", f1.seriesKey);
      params.set("f1DefaultGenre", f1.defaultGenre);

      if (nextF2?.label && (nextF2?.attractionId || nextF2?.seriesKey)) {
        params.set("f2Label", nextF2.label);
        params.set("f2Kind", nextF2.kind);
        if (nextF2.attractionId) params.set("f2AttractionId", nextF2.attractionId);
        if (nextF2.seriesKey) params.set("f2SeriesKey", nextF2.seriesKey);
        if (nextF2.defaultGenre) params.set("f2DefaultGenre", nextF2.defaultGenre);
      }

      const genreCsv = listToCsv(nextGenres.slice(0, 1));
      if (genreCsv) params.set("genres", genreCsv);

      router.replace(`/results/favorites?${params.toString()}`, { scroll: false });
    },
    [countryCode, f1, router]
  );

  useEffect(() => {
    if (!hydratedFromStorage) return;

    const f1Identity = favoriteIdentityKey(f1);

    if (!f1Identity) {
      searchAbortRef.current?.abort();
      setResp(null);
      setErr("Favorite 1 is required.");
      setLoading(false);
      return;
    }

    const hasUsableSavedResp =
      resp &&
      Array.isArray(resp.anchorCards) &&
      resp.anchorCards.length > 0 &&
      !err;

    if (hasUsableSavedResp) {
      setLoading(false);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);
      setResp(null);
      setDisplayedCards([]);
      setFilterPassActive(false);
      setFilterPassDone(false);
      setCheckedCount(0);
      setYesCount(0);
      setNoCount(0);
      setCurrentlyCheckingId(null);
      setShowOnlyMatching(false);
      setExpandedCardId(null);
      setCtxCache({});
      filterRunIdRef.current += 1;

      try {
        const r = await fetch("/api/search/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify(searchRequestBody),
        });

        const j = (await r.json().catch(() => ({}))) as ApiResp & { error?: string };
        if (!r.ok) throw new Error(j?.error || "Failed");

        if (!cancelled) {
          setResp(j);
          setDisplayedCards(Array.isArray(j.anchorCards) ? j.anchorCards : []);
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;

        if (!cancelled) {
          setResp(null);
          setErr(e?.message || "Failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [hydratedFromStorage, f1, searchRequestBody]); // intentionally not depending on resp/err

  const fetchCardContext = useCallback(
    async (card: AnchorCard): Promise<ContextState> => {
      const contextKey = `${card.id}__${normalizeToken(selectedFilterIdentity)}`;
      const cached = ctxCacheRef.current[contextKey];
      if (cached && !cached.loading) return cached;

      if (
        !card.localDate ||
        !isYMD(card.localDate) ||
        typeof card.lat !== "number" ||
        typeof card.lon !== "number"
      ) {
        const badCtx: ContextState = {
          loading: false,
          error: "Missing anchor location/date",
          presentFavorites: [],
          presentGenres: [],
          requirementsMet: false,
          nearbyEvents: [],
        };

        setCtxCache((prev) => ({ ...prev, [contextKey]: badCtx }));
        return badCtx;
      }

      setCtxCache((prev) => ({
        ...prev,
        [contextKey]: {
          loading: true,
          error: "",
          presentFavorites: prev[contextKey]?.presentFavorites ?? [],
          presentGenres: prev[contextKey]?.presentGenres ?? [],
          requirementsMet: prev[contextKey]?.requirementsMet ?? false,
          nearbyEvents: prev[contextKey]?.nearbyEvents ?? [],
        },
      }));

      try {
        const contextFavorites = [f1, ...(selectedF2 ? [selectedF2] : [])];

        const body = {
          anchorLocalDate: card.localDate,
          anchorLat: card.lat,
          anchorLon: card.lon,
          localDate: card.localDate,
          lat: card.lat,
          lon: card.lon,
          favorites: contextFavorites,
          genres: selectedGenres.slice(0, 1),
          countryCode,
          radiusMiles: AREA_RADIUS_MILES,
          dayWindow: ANCHOR_DAY_WINDOW,
        };

        const r = await fetch("/api/trip/context", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(body),
        });

        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((json as any)?.error || `Context failed (${r.status})`);

        const nearbyEvents = collectNearbyCandidates(json)
          .map((item, idx) => normalizeNearbyEvent(item, idx))
          .filter(Boolean) as NearbyEvent[];

        const nextCtx: ContextState = {
          loading: false,
          error: "",
          presentFavorites: Array.isArray((json as any)?.present?.favorites)
            ? (json as any).present.favorites
            : [],
          presentGenres: Array.isArray((json as any)?.present?.genres)
            ? (json as any).present.genres
            : [],
          requirementsMet: Boolean((json as any)?.requirementsMet),
          nearbyEvents,
        };

        setCtxCache((prev) => ({ ...prev, [contextKey]: nextCtx }));
        return nextCtx;
      } catch (e: any) {
        const failedCtx: ContextState = {
          loading: false,
          error: e?.message || "Failed to validate anchor",
          presentFavorites: [],
          presentGenres: [],
          requirementsMet: false,
          nearbyEvents: [],
        };

        setCtxCache((prev) => ({ ...prev, [contextKey]: failedCtx }));
        return failedCtx;
      }
    },
    [countryCode, f1, selectedF2, selectedGenres, selectedFilterIdentity]
  );

  useEffect(() => {
    if (!hydratedFromStorage) return;

    const runId = ++filterRunIdRef.current;

    setCurrentlyCheckingId(null);

    if (!needsContextCheck) {
      setDisplayedCards(cards);
      setFilterPassActive(false);
      setFilterPassDone(false);
      setCheckedCount(0);
      setYesCount(0);
      setNoCount(0);
      setExpandedCardId(null);
      return;
    }

    setDisplayedCards(cards);

    const sourceCards = [...cards];

    let checked = 0;
    let yes = 0;
    let no = 0;

    for (const card of sourceCards) {
      const key = `${card.id}__${normalizeToken(selectedFilterIdentity)}`;
      const ctx = ctxCacheRef.current[key];

      if (ctx && !ctx.loading) {
        checked += 1;
        if (ctx.requirementsMet) yes += 1;
        else no += 1;
      }
    }

    setCheckedCount(checked);
    setYesCount(yes);
    setNoCount(no);

    if (sourceCards.length === 0) {
      setFilterPassActive(false);
      setFilterPassDone(false);
      return;
    }

    if (checked >= sourceCards.length) {
      setFilterPassActive(false);
      setFilterPassDone(true);
      return;
    }

    setFilterPassActive(true);
    setFilterPassDone(false);

    let cancelled = false;

    async function runPass() {
      let nextChecked = checked;
      let nextYes = yes;
      let nextNo = no;

      for (const card of sourceCards) {
        if (cancelled) return;
        if (filterRunIdRef.current !== runId) return;

        const key = `${card.id}__${normalizeToken(selectedFilterIdentity)}`;
        const existing = ctxCacheRef.current[key];

        if (existing && !existing.loading) continue;

        setCurrentlyCheckingId(card.id);

        const ctx = await fetchCardContext(card);

        if (cancelled) return;
        if (filterRunIdRef.current !== runId) return;

        nextChecked += 1;
        setCheckedCount(nextChecked);

        if (ctx.requirementsMet) {
          nextYes += 1;
          setYesCount(nextYes);
        } else {
          nextNo += 1;
          setNoCount(nextNo);
        }

        await new Promise((resolve) => window.setTimeout(resolve, 30));
      }

      if (cancelled) return;
      if (filterRunIdRef.current !== runId) return;

      setCurrentlyCheckingId(null);
      setFilterPassActive(false);
      setFilterPassDone(true);
    }

    runPass();

    return () => {
      cancelled = true;
    };
  }, [hydratedFromStorage, cards, needsContextCheck, fetchCardContext, selectedFilterIdentity]);

  function openAreaResultsForCard(card: AnchorCard) {
    const cityLabel = [card.city, card.region].filter(Boolean).join(", ");
    const lat = typeof card.lat === "number" ? card.lat : null;
    const lon = typeof card.lon === "number" ? card.lon : null;
    const anchorDate = isYMD(card.localDate) ? card.localDate : "";

    if (!cityLabel || typeof lat !== "number" || typeof lon !== "number" || !anchorDate) {
      return;
    }

    const start = addDaysLocalYMD(anchorDate, -ANCHOR_DAY_WINDOW);
    const end = addDaysLocalYMD(anchorDate, ANCHOR_DAY_WINDOW);

    const params = new URLSearchParams({
      cityLabel,
      lat: String(lat),
      lon: String(lon),
      start,
      end,
      radiusMiles: String(AREA_RADIUS_MILES),
      countryCode,
      f1Label: f1.label,
      f1Kind: f1.kind,
      f1DefaultGenre: f1.defaultGenre,
    });

    if (f1.attractionId) params.set("f1AttractionId", f1.attractionId);
    if (f1.seriesKey) params.set("f1SeriesKey", f1.seriesKey);

    if (selectedF2?.label && (selectedF2?.attractionId || selectedF2?.seriesKey)) {
      params.set("f2Label", selectedF2.label);
      params.set("f2Kind", selectedF2.kind);
      if (selectedF2.attractionId) params.set("f2AttractionId", selectedF2.attractionId);
      if (selectedF2.seriesKey) params.set("f2SeriesKey", selectedF2.seriesKey);
      if (selectedF2.defaultGenre) params.set("f2DefaultGenre", selectedF2.defaultGenre);
    }

    const genreCsv = listToCsv(selectedGenres.slice(0, 1));
    if (genreCsv) params.set("genres", genreCsv);

    if (card.id) params.set("selectedEventId", card.id);

    router.push(`/results/area?${params.toString()}`);
  }

  async function handleAnchorCardClick(card: AnchorCard) {
    const result = getCardResult(card.id);

    if (!needsContextCheck || result !== "yes") {
      openAreaResultsForCard(card);
      return;
    }

    const isOpen = expandedCardId === card.id;
    if (isOpen) {
      setExpandedCardId(null);
      return;
    }

    setExpandedCardId(card.id);
    await fetchCardContext(card);
  }

  function handlePickF2(opt: SavedFavoriteOption) {
    if (selectedF2 || selectedGenres.length > 0) return;

    const nextLabel = opt.label;
    const nextGenre = opt.defaultGenre || "";
    const attractionId = String(opt.attractionId || "").trim();
    const seriesKey = String(opt.seriesKey || "").trim();

    if (!attractionId && !seriesKey) return;

    const nextFavorite = makeFavorite({
      id: "F2",
      label: nextLabel,
      kind: opt.kind,
      attractionId: attractionId || undefined,
      seriesKey: seriesKey || undefined,
      defaultGenre: nextGenre,
    });

    setSelectedF2(nextFavorite);
    setSelectedGenres([]);
    setComboInput(nextLabel);
    setErr(null);
    setShowOnlyMatching(false);
    setExpandedCardId(null);
    setCtxCache({});
    setCheckedCount(0);
    setYesCount(0);
    setNoCount(0);
    setFilterPassActive(false);
    setFilterPassDone(false);
    updateUrl(nextFavorite, []);
  }

  function addGenre(genre: string) {
    if (selectedF2 || selectedGenres.length > 0) return;

    const raw = String(genre || "").trim();
    if (!raw) return;

    const nextGenres = [raw];
    setSelectedF2(null);
    setSelectedGenres(nextGenres);
    setComboInput(raw);
    setErr(null);
    setShowOnlyMatching(false);
    setExpandedCardId(null);
    setCtxCache({});
    setCheckedCount(0);
    setYesCount(0);
    setNoCount(0);
    setFilterPassActive(false);
    setFilterPassDone(false);
    updateUrl(null, nextGenres);
  }

  function handleComboInputChange(v: string) {
    if (otherFilterLocked) return;
    setComboInput(v);
  }

  function commitComboInputIfExactSportsAlias() {
    if (otherFilterLocked) return;
    if (selectedF2 || selectedGenres.length > 0) return;

    const exactSportsGenre = findExactSportsAliasGenre(comboInput);
    if (!exactSportsGenre) return;

    addGenre(exactSportsGenre);
  }

  function clearOtherEventFilter() {
    setSelectedF2(null);
    setSelectedGenres([]);
    setComboInput("");
    setErr(null);
    setShowOnlyMatching(false);
    setExpandedCardId(null);
    setCtxCache({});
    setCheckedCount(0);
    setYesCount(0);
    setNoCount(0);
    setFilterPassActive(false);
    setFilterPassDone(false);
    setCurrentlyCheckingId(null);
    updateUrl(null, []);
  }

  function getCardResult(cardId: string) {
    if (!selectedFilterIdentity) return "idle";

    const key = `${cardId}__${normalizeToken(selectedFilterIdentity)}`;
    const ctx = ctxCache[key];

    if (!ctx) return "idle";
    if (ctx.loading) return "checking";
    if (ctx.requirementsMet) return "yes";
    return "no";
  }

  function getCardContext(cardId: string) {
    if (!selectedFilterIdentity) return null;
    const key = `${cardId}__${normalizeToken(selectedFilterIdentity)}`;
    return ctxCache[key] || null;
  }

  const visibleCards = useMemo(() => {
    if (!showOnlyMatching || !filterPassDone || !needsContextCheck) return displayedCards;
    return displayedCards.filter((card) => getCardResult(card.id) === "yes");
  }, [
    displayedCards,
    showOnlyMatching,
    filterPassDone,
    needsContextCheck,
    ctxCache,
    selectedFilterIdentity,
  ]);

  const otherFilterLocked = Boolean(selectedFilterLabel);

  const comboHint =
    !otherFilterLocked && comboInput.trim() && filteredOptionCount > 0
      ? `${filteredOptionCount} option${filteredOptionCount === 1 ? "" : "s"}`
      : "";

  const totalCards = cards.length;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-20 overflow-visible border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md overflow-visible px-4 py-3 lg:max-w-4xl lg:px-6">
          <div className="mt-2 overflow-visible rounded-3xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-col items-center justify-center gap-3 text-center text-sm font-semibold text-slate-700 sm:text-base">
              <div>Only include {f1DisplayLabel} events that include ...</div>

              <div className="relative z-30 w-full max-w-[420px] overflow-visible [&_input]:text-center [&_input]:placeholder:text-center">
                <GroupedComboBox
                  label=""
                  value={selectedFilterLabel || comboInput}
                  placeholder="Music Genre / Sport / Team / Artist"
                  rows={otherFilterLocked ? [] : filterRows}
                  onChange={handleComboInputChange}
                  onBlurCommit={commitComboInputIfExactSportsAlias}
                  onPick={(row) => {
                    if (otherFilterLocked) return;

                    if (row.optionType === "favorite" && row.favorite) {
                      handlePickF2(row.favorite);
                      return;
                    }

                    if (row.optionType === "genre" && row.genre) {
                      addGenre(row.genre.label);
                    }
                  }}
                  onClear={otherFilterLocked ? clearOtherEventFilter : undefined}
                />

                {!otherFilterLocked && comboHint ? (
                  <div className="mt-1 text-[11px] text-slate-500">{comboHint}</div>
                ) : null}
              </div>

              <div>... event(s) nearby</div>
            </div>

            {needsContextCheck ? (
              <div className="mt-3 space-y-3">
                {filterPassDone ? (
                  <button
                    type="button"
                    onClick={() => setShowOnlyMatching((prev) => !prev)}
                    aria-pressed={showOnlyMatching}
                    className={cx(
                      "block w-full rounded-3xl border px-4 py-3 text-left text-sm font-semibold shadow-sm transition",
                      "border-emerald-300 bg-emerald-50 text-emerald-900",
                      "hover:bg-emerald-100/70",
                      showOnlyMatching && "ring-2 ring-emerald-300"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        <strong>{yesCount}</strong> <strong>{f1.label}</strong> event
                        {yesCount === 1 ? "" : "s"} have a <strong>{selectedFilterLabel}</strong>{" "}
                        event nearby.
                      </span>
                      <span className="shrink-0 text-[11px] font-black uppercase tracking-wide text-emerald-700">
                        {showOnlyMatching ? "Show all" : "Show only these"}
                      </span>
                    </div>
                  </button>
                ) : (
                  <div className="rounded-3xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 shadow-sm">
                    <div className="flex items-center gap-2">
                      {filterPassActive ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-700" />
                      ) : null}
                      <span>
                        <strong>{yesCount}</strong> <strong>{f1.label}</strong> event
                        {yesCount === 1 ? "" : "s"} have a <strong>{selectedFilterLabel}</strong>{" "}
                        event nearby.
                      </span>
                    </div>
                  </div>
                )}

                <div className="rounded-3xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900 shadow-sm">
                  <div className="flex items-center gap-2">
                    {filterPassActive ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-rose-300 border-t-rose-700" />
                    ) : null}
                    <span>
                      <strong>{noCount}</strong> <strong>{f1.label}</strong> event
                      {noCount === 1 ? "" : "s"} do <strong>NOT</strong> have a{" "}
                      <strong>{selectedFilterLabel}</strong> event nearby.
                    </span>
                  </div>
                </div>

                {filterPassActive ? (
                  <div className="px-1 text-[11px] font-semibold text-slate-500">
                    {checkedCount}/{totalCards} checked
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 py-4 lg:max-w-4xl lg:px-6 lg:py-8">
        {loading && !resp && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              <div className="text-sm font-semibold text-slate-700">Loading favorites…</div>
            </div>
          </section>
        )}

        {err && (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
            <div className="text-sm font-black">Error</div>
            <div className="mt-2 text-sm font-semibold text-rose-700">{err}</div>
          </section>
        )}

        {!err && (
          <>
            <div className="space-y-3">
              {visibleCards.map((c) => {
                const isChecking = currentlyCheckingId === c.id;
                const result = getCardResult(c.id);
                const isExpanded = expandedCardId === c.id;
                const ctx = getCardContext(c.id);

                const cardToneClasses =
                  result === "yes"
                    ? "border-emerald-300 bg-emerald-50"
                    : result === "no"
                    ? "border-rose-300 bg-rose-50"
                    : result === "checking"
                    ? "border-slate-200 bg-slate-100"
                    : "border-transparent bg-white";

                const nearbyEvents = ctx?.nearbyEvents || [];

                return (
                  <div key={c.id} className="rounded-3xl transition-all duration-200">
                    <SharedEventDateGroup
                      title={c.localDate && isYMD(c.localDate) ? fmtYMDPretty(c.localDate) : "Date TBD"}
                      className="mb-4"
                    >
                      <div
                        className={cx(
                          "relative overflow-hidden rounded-3xl border p-0 transition-all duration-200",
                          cardToneClasses
                        )}
                      >
                        {isChecking ? (
                          <div className="pointer-events-none absolute inset-x-3 top-3 z-20 inline-flex w-fit items-center gap-2 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-slate-600 shadow-sm ring-1 ring-slate-200">
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                            Checking nearby {selectedFilterLabel}…
                          </div>
                        ) : null}

                        <div className="relative z-0">
                          <div className="relative">
                            <SharedEventCard
                              className={cx(
                                result === "yes" && "bg-emerald-50",
                                result === "no" && "bg-rose-50"
                              )}
                              title={c.name || "Event"}
                              subtitle={`${[c.city, c.region].filter(Boolean).join(", ") || "Location TBD"}${
                                c.localTime ? ` • ${fmtTimeDisplay(c.localTime)}` : ""
                              }`}
                              primaryPill={c.matched?.defaultGenres?.[0] || f1.defaultGenre || "Event"}
                              secondaryPill={c.isCrossover ? "Crossover" : null}
                              ticketHref={c.url || null}
                              showTickets={!!c.url}
                              onCardClick={() => handleAnchorCardClick(c)}
                            />

                            {needsContextCheck && result === "yes" ? (
                              <div className="pointer-events-none absolute bottom-3 right-4 inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-emerald-700 shadow-sm ring-1 ring-emerald-200">
                                <span>{isExpanded ? "Hide nearby" : "Show nearby"}</span>
                                <span
                                  className={cx(
                                    "transition-transform duration-200",
                                    isExpanded ? "rotate-180" : "rotate-0"
                                  )}
                                >
                                  ▾
                                </span>
                              </div>
                            ) : null}
                          </div>

                          {isExpanded ? (
                            <div className="border-t border-emerald-200 bg-white/70 px-3 pb-3 pt-3">
                              {ctx?.loading ? (
                                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm">
                                  <div className="flex items-center gap-2">
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                                    Loading nearby {selectedFilterLabel} events…
                                  </div>
                                </div>
                              ) : ctx?.error ? (
                                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 shadow-sm">
                                  {ctx.error}
                                </div>
                              ) : nearbyEvents.length > 0 ? (
                                <div className="space-y-2">
                                  <div className="px-1 text-[11px] font-black uppercase tracking-wide text-emerald-700">
                                    Nearby {selectedFilterLabel} events
                                  </div>

                                  {nearbyEvents.map((evt) => {
                                    const pill =
                                      evt.matched?.genres?.[0] ||
                                      evt.matched?.defaultGenres?.[0] ||
                                      evt.matched?.favorites?.[0] ||
                                      selectedFilterLabel ||
                                      "Nearby";

                                    return (
                                      <div key={evt.id} className="pl-2">
                                        <SharedEventCard
                                          className="bg-white"
                                          title={evt.name || "Nearby event"}
                                          subtitle={`${[evt.city, evt.region].filter(Boolean).join(", ") || "Location TBD"}${
                                            evt.localDate && isYMD(evt.localDate)
                                              ? ` • ${fmtYMDPretty(evt.localDate)}`
                                              : ""
                                          }${evt.localTime ? ` • ${fmtTimeDisplay(evt.localTime)}` : ""}`}
                                          primaryPill={pill}
                                          secondaryPill={evt.venueName || null}
                                          ticketHref={evt.url || null}
                                          showTickets={!!evt.url}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm">
                                  No nearby {selectedFilterLabel} events to show.
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </SharedEventDateGroup>
                  </div>
                );
              })}
            </div>

            {!filterPassActive && visibleCards.length === 0 && !loading && !showOnlyMatching && (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <div className="text-lg font-black text-slate-900">{f1DisplayLabel}</div>

                <div className="mt-2 text-4xl">🙁</div>

                <div className="mt-2 text-sm font-semibold text-slate-700">
                  No Events Scheduled
                </div>

                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => router.push("/")}
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}

            {!filterPassActive && visibleCards.length === 0 && !loading && showOnlyMatching && (
              <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-sm font-semibold text-emerald-900 shadow-sm">
                No {f1.label} events with a nearby {selectedFilterLabel} match were found.
              </div>
            )}

            {filterPassDone && needsContextCheck && displayedCards.length > 0 && (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-700 shadow-sm">
                Finished checking {checkedCount} {f1.label} event{checkedCount === 1 ? "" : "s"} for a
                nearby {selectedFilterLabel}.
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}