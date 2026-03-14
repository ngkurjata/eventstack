"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "@/app/components/BrandLogo";
import { csvToList } from "@/lib/url";
import {
  BuildTripPayload,
  RowEvent,
  coerceTripContextResponse,
  encodeBuildTripDataParam,
  eventKey,
  fmtYMDPretty,
  groupByDate,
  isYMD,
} from "@/lib/trips/sharePayload";

type Favorite = {
  id: string;
  label: string;
  attractionId: string;
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
  anchor?: RowEvent | null;
  events: RowEvent[];
  selected: Record<string, boolean>;
  presentFavorites: string[];
  presentGenres: string[];
  requirementsMet: boolean;
};

const BUILD_TRIP_ROUTE = "/build-trip";
const MAX_PRELOAD_CONCURRENCY = 4;
const PRELOAD_ROOT_MARGIN = "300px 0px";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function makeFavorite(
  id: string,
  label: string,
  attractionId: string,
  defaultGenre: string
): Favorite {
  return { id, label, attractionId, defaultGenre };
}

function anchorToRowEvent(a: AnchorCard): RowEvent {
  return {
    date: a.localDate || null,
    name: a.name || "Anchor event",
    location: [a.city, a.region].filter(Boolean).join(", "),
    genre: (a.matched?.defaultGenres || [])[0] || null,
    url: a.url || null,
    lat: typeof a.lat === "number" ? a.lat : null,
    lon: typeof a.lon === "number" ? a.lon : null,
    localTime: a.localTime || null,
  };
}

function ensureAnchorIncluded(anchor: RowEvent | null | undefined, events: RowEvent[]) {
  const out = Array.isArray(events) ? [...events] : [];
  if (!anchor) return out;

  const ak = eventKey(anchor);
  const exists = out.some((e) => eventKey(e) === ak);
  if (!exists) out.unshift(anchor);

  return out;
}

function isRenderableRowEvent(e: RowEvent) {
  const name = String(e?.name || "").trim();
  const loc = String(e?.location || "").trim();

  if (!name) return false;
  if (name.toLowerCase().includes("untitled")) return false;
  if (!loc) return false;
  if (loc.toLowerCase().includes("location tbd")) return false;

  return true;
}

function normalizeToken(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function includesNormalized(list: string[] | null | undefined, value: string | null | undefined) {
  const needle = normalizeToken(value);
  if (!needle) return false;
  return (list || []).some((item) => normalizeToken(item) === needle);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const raw = String(value || "").trim();
    const key = raw.toLowerCase();
    if (!raw || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }

  return out;
}

function splitLocation(location: string | null | undefined) {
  const raw = String(location || "").trim();
  if (!raw) return { city: "", region: "" };

  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  return {
    city: parts[0] || "",
    region: parts[1] || "",
  };
}

function tripIncludesFavorite(card: AnchorCard, favorite: Favorite | null, ctx?: ContextState) {
  if (!favorite) return false;

  const presentFavorites = uniqueStrings([
    ...(card.matched?.favorites || []),
    ...(ctx?.presentFavorites || []),
  ]);

  return (
    includesNormalized(presentFavorites, favorite.id) ||
    includesNormalized(presentFavorites, favorite.label) ||
    includesNormalized(presentFavorites, favorite.attractionId)
  );
}

function getTripEvents(card: AnchorCard, ctx?: ContextState) {
  const anchor = ctx?.anchor || anchorToRowEvent(card);
  return ensureAnchorIncluded(anchor, ctx?.events || []).filter(isRenderableRowEvent);
}

function getTripLocationLabel(card: AnchorCard, ctx?: ContextState) {
  const events = getTripEvents(card, ctx);

  if (!events.length) {
    return [card.city, card.region].filter(Boolean).join(", ");
  }

  const counts = new Map<string, { label: string; count: number }>();

  for (const e of events) {
    const parts = splitLocation(e.location);
    const label = [parts.city, parts.region].filter(Boolean).join(", ");
    if (!label) continue;

    const key = normalizeToken(label);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { label, count: 1 });
    }
  }

  const ranked = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label)
  );

  return ranked[0]?.label || [card.city, card.region].filter(Boolean).join(", ");
}

function getTripDateRange(card: AnchorCard, ctx?: ContextState) {
  const events = getTripEvents(card, ctx);
  const validDates = uniqueStrings(
    events
      .map((e) => (isYMD(String(e.date || "")) ? String(e.date) : ""))
      .filter(Boolean)
  ).sort();

  if (!validDates.length) {
    return card.localDate ? fmtYMDPretty(card.localDate) : "Date TBD";
  }

  const first = validDates[0];
  const last = validDates[validDates.length - 1];

  if (first === last) return fmtYMDPretty(first);
  return `${fmtYMDPretty(first)} → ${fmtYMDPretty(last)}`;
}

function isGreenCard(card: AnchorCard, f1: Favorite, f2: Favorite | null, ctx?: ContextState) {
  if (!f2) return false;
  return tripIncludesFavorite(card, f1, ctx) && tripIncludesFavorite(card, f2, ctx);
}

function cardSurfaceClass(isGreen: boolean) {
  return isGreen ? "border-emerald-300 bg-emerald-50/90" : "border-slate-200 bg-white";
}

function expandedSurfaceClass(isGreen: boolean) {
  return isGreen ? "border-emerald-200 bg-white/80" : "border-slate-200 bg-slate-50/70";
}

function titleTextClass(isGreen: boolean) {
  return isGreen ? "text-emerald-950" : "text-slate-900";
}

function bodyTextClass(isGreen: boolean) {
  return isGreen ? "text-emerald-900" : "text-slate-700";
}

function mutedTextClass(isGreen: boolean) {
  return isGreen ? "text-emerald-800/80" : "text-slate-500";
}

function dividerTextClass(isGreen: boolean) {
  return isGreen ? "text-emerald-300" : "text-slate-300";
}

function linkClass(isGreen: boolean) {
  return isGreen
    ? "text-[11px] font-extrabold text-emerald-900 underline decoration-emerald-300 hover:decoration-emerald-700"
    : "text-[11px] font-extrabold text-slate-900 underline decoration-slate-300 hover:decoration-slate-800";
}

function hasLoadedContext(ctx?: ContextState) {
  if (!ctx) return false;
  if (ctx.loading) return false;
  if (ctx.error) return true;
  if (ctx.events.length > 0) return true;
  if (ctx.presentFavorites.length > 0) return true;
  if (ctx.presentGenres.length > 0) return true;
  return false;
}

function getGenreMatchState(
  genre: string | null | undefined,
  ctx?: ContextState
): "loading" | "yes" | "no" {
  const raw = String(genre || "").trim();
  if (!raw) return "no";
  if (!ctx || ctx.loading || !hasLoadedContext(ctx)) return "loading";
  if (includesNormalized(ctx.presentGenres, raw)) return "yes";
  return "no";
}

function statusButtonClass(state: "loading" | "yes" | "no", isGreen: boolean) {
  if (state === "yes") {
    return isGreen
      ? "border-emerald-300 bg-emerald-100 text-emerald-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (state === "no") {
    return isGreen
      ? "border-slate-300 bg-white text-slate-700"
      : "border-slate-200 bg-slate-50 text-slate-700";
  }

  return isGreen
    ? "border-emerald-200 bg-white text-emerald-900"
    : "border-slate-200 bg-white text-slate-700";
}

function GenreStatusButton({
  label,
  state,
  isGreen,
}: {
  label: string;
  state: "loading" | "yes" | "no";
  isGreen: boolean;
}) {
  return (
    <div
      className={cx(
        "inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-extrabold",
        statusButtonClass(state, isGreen)
      )}
    >
      <span className="truncate">{label}</span>

      {state === "loading" ? (
        <span
          className={cx(
            "h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2",
            isGreen ? "border-emerald-300 border-t-emerald-700" : "border-slate-300 border-t-slate-700"
          )}
        />
      ) : state === "yes" ? (
        <span className="shrink-0" aria-hidden="true">
          ✓
        </span>
      ) : (
        <span className="shrink-0" aria-hidden="true">
          ✕
        </span>
      )}
    </div>
  );
}

function CardVisibilityTrigger({
  cardId,
  onVisible,
  children,
}: {
  cardId: string;
  onVisible: (cardId: string) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let fired = false;

    const io = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first) return;
        if (!first.isIntersecting) return;
        if (fired) return;

        fired = true;
        onVisible(cardId);
        io.disconnect();
      },
      {
        root: null,
        rootMargin: PRELOAD_ROOT_MARGIN,
        threshold: 0.01,
      }
    );

    io.observe(node);
    return () => io.disconnect();
  }, [cardId, onVisible]);

  return <div ref={ref}>{children}</div>;
}

export default function FavoritesResultsPage() {
  const sp = useSearchParams();
  const router = useRouter();

  const countryCode = sp.get("countryCode") || "US,CA";
  const start = sp.get("start");
  const end = sp.get("end");
  const genresParam = sp.get("genres") || "";

  const f1Label = sp.get("f1Label") || "";
  const f1AttractionId = sp.get("f1AttractionId") || "";
  const f1DefaultGenre = sp.get("f1DefaultGenre") || "Hockey";

  const f2Label = sp.get("f2Label") || "";
  const f2AttractionId = sp.get("f2AttractionId") || "";
  const f2DefaultGenre = sp.get("f2DefaultGenre") || "Country";

  const userGenres = useMemo(() => csvToList(genresParam), [genresParam]);

  const g1 = userGenres[0] || "";
  const g2 = userGenres[1] || "";

  const f1 = useMemo(() => {
    return makeFavorite("F1", f1Label, f1AttractionId, f1DefaultGenre);
  }, [f1Label, f1AttractionId, f1DefaultGenre]);

  const f2 = useMemo(() => {
    if (!f2AttractionId) return null;
    return makeFavorite("F2", f2Label, f2AttractionId, f2DefaultGenre);
  }, [f2Label, f2AttractionId, f2DefaultGenre]);

  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ctxByAnchor, setCtxByAnchor] = useState<Record<string, ContextState>>({});

  const searchAbortRef = useRef<AbortController | null>(null);
  const ctxByAnchorRef = useRef<Record<string, ContextState>>({});
  const contextInflightRef = useRef<Record<string, Promise<void>>>({});
  const queueRef = useRef<AnchorCard[]>([]);
  const activeCountRef = useRef(0);
  const cardsRef = useRef<AnchorCard[]>([]);

  useEffect(() => {
    ctxByAnchorRef.current = ctxByAnchor;
  }, [ctxByAnchor]);

  const requestBody = useMemo(() => {
    return {
      favorite1: f1,
      favorite2: f2,
      startDate: start || null,
      endDate: end || null,
      countryCode,
      genres: userGenres,
    };
  }, [f1, f2, start, end, countryCode, userGenres]);

  useEffect(() => {
    if (!f1AttractionId) {
      searchAbortRef.current?.abort();
      setResp(null);
      setErr("Favorite 1 is required.");
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
      setOpenId(null);
      setCtxByAnchor({});
      contextInflightRef.current = {};
      queueRef.current = [];
      activeCountRef.current = 0;

      try {
        const r = await fetch("/api/search/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify(requestBody),
        });

        const j = (await r.json().catch(() => ({}))) as ApiResp & { error?: string };
        if (!r.ok) throw new Error(j?.error || "Failed");

        if (!cancelled) {
          setResp(j);
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
  }, [f1AttractionId, requestBody]);

  const cards = resp?.anchorCards || [];

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  const favoritesPayload = useMemo(() => [f1, ...(f2 ? [f2] : [])], [f1, f2]);

  const header = useMemo(() => {
    const favs = [f1.label, f2?.label].filter(Boolean).join(" + ");
    const datePart = start && end ? `${start} → ${end}` : "All upcoming";
    const genresPart = userGenres.length ? ` • +${userGenres.join(", ")}` : "";
    return `${favs} • ${datePart}${genresPart}`;
  }, [f1.label, f2?.label, start, end, userGenres]);

  const fetchContext = useCallback(
    async (card: AnchorCard): Promise<void> => {
      const existing = ctxByAnchorRef.current[card.id];
      if (existing?.loading) return;
      if (existing && (existing.events.length > 0 || existing.error || hasLoadedContext(existing))) {
        return;
      }

      const inflight = contextInflightRef.current[card.id];
      if (inflight) {
        await inflight;
        return;
      }

      const promise: Promise<void> = (async () => {
        if (
          !card.localDate ||
          !isYMD(card.localDate) ||
          typeof card.lat !== "number" ||
          typeof card.lon !== "number"
        ) {
          setCtxByAnchor((prev) => ({
            ...prev,
            [card.id]: {
              loading: false,
              error: "This anchor is missing valid localDate/lat/lon; cannot load nearby events.",
              events: prev[card.id]?.events || [],
              anchor: prev[card.id]?.anchor || anchorToRowEvent(card),
              selected: prev[card.id]?.selected || {},
              presentFavorites: prev[card.id]?.presentFavorites || [],
              presentGenres: prev[card.id]?.presentGenres || [],
              requirementsMet: false,
            },
          }));
          return;
        }

        setCtxByAnchor((prev) => ({
          ...prev,
          [card.id]: {
            loading: true,
            error: "",
            anchor: prev[card.id]?.anchor ?? null,
            events: prev[card.id]?.events ?? [],
            selected: prev[card.id]?.selected ?? {},
            presentFavorites: prev[card.id]?.presentFavorites ?? [],
            presentGenres: prev[card.id]?.presentGenres ?? [],
            requirementsMet: prev[card.id]?.requirementsMet ?? false,
          },
        }));

        try {
          const body = {
            anchorLocalDate: card.localDate,
            anchorLat: card.lat,
            anchorLon: card.lon,
            localDate: card.localDate,
            lat: card.lat,
            lon: card.lon,
            favorites: favoritesPayload,
            genres: userGenres,
            countryCode,
          };

          const r = await fetch("/api/trip/context", {
            method: "POST",
            headers: { "content-type": "application/json" },
            cache: "no-store",
            body: JSON.stringify(body),
          });

          const json = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error((json as any)?.error || `Context failed (${r.status})`);

          const { anchor, events } = coerceTripContextResponse(json);
          const resolvedAnchor = anchor || anchorToRowEvent(card);
          const withAnchor = ensureAnchorIncluded(resolvedAnchor, events);

          setCtxByAnchor((prev) => ({
            ...prev,
            [card.id]: {
              loading: false,
              error: "",
              anchor: resolvedAnchor,
              events: withAnchor,
              selected: prev[card.id]?.selected ?? {},
              presentFavorites: Array.isArray((json as any)?.present?.favorites)
                ? (json as any).present.favorites
                : [],
              presentGenres: Array.isArray((json as any)?.present?.genres)
                ? (json as any).present.genres
                : [],
              requirementsMet: Boolean((json as any)?.requirementsMet),
            },
          }));
        } catch (e: any) {
          setCtxByAnchor((prev) => ({
            ...prev,
            [card.id]: {
              loading: false,
              error: e?.message || "Failed to load nearby events",
              anchor: prev[card.id]?.anchor ?? anchorToRowEvent(card),
              events: prev[card.id]?.events ?? [],
              selected: prev[card.id]?.selected ?? {},
              presentFavorites: prev[card.id]?.presentFavorites ?? [],
              presentGenres: prev[card.id]?.presentGenres ?? [],
              requirementsMet: false,
            },
          }));
        }
      })();

      contextInflightRef.current[card.id] = promise;

      try {
        await promise;
      } finally {
        delete contextInflightRef.current[card.id];
      }
    },
    [countryCode, favoritesPayload, userGenres]
  );

  const pumpQueue = useCallback(() => {
    while (activeCountRef.current < MAX_PRELOAD_CONCURRENCY && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) return;

      const existing = ctxByAnchorRef.current[next.id];
      if (existing?.loading || hasLoadedContext(existing) || existing?.error) continue;
      if (contextInflightRef.current[next.id]) continue;

      activeCountRef.current += 1;

      fetchContext(next).finally(() => {
        activeCountRef.current -= 1;
        pumpQueue();
      });
    }
  }, [fetchContext]);

  const enqueueCardContext = useCallback(
    (cardId: string) => {
      const card = cardsRef.current.find((c) => c.id === cardId);
      if (!card) return;

      const existing = ctxByAnchorRef.current[card.id];
      if (existing?.loading || hasLoadedContext(existing) || existing?.error) return;
      if (contextInflightRef.current[card.id]) return;
      if (queueRef.current.some((c) => c.id === card.id)) return;

      queueRef.current.push(card);
      pumpQueue();
    },
    [pumpQueue]
  );

  function toggleOpen(card: AnchorCard) {
    setOpenId((prev) => (prev === card.id ? null : card.id));
  }

  useEffect(() => {
    if (!openId) return;
    const card = cards.find((c) => c.id === openId);
    if (!card) return;
    enqueueCardContext(card.id);
  }, [openId, cards, enqueueCardContext]);

  function setChecked(anchorId: string, e: RowEvent, checked: boolean) {
    const k = eventKey(e);

    setCtxByAnchor((prev) => {
      const cur = prev[anchorId] || {
        loading: false,
        error: "",
        events: [],
        selected: {},
        presentFavorites: [],
        presentGenres: [],
        requirementsMet: false,
      };

      return {
        ...prev,
        [anchorId]: {
          ...cur,
          selected: {
            ...cur.selected,
            [k]: checked,
          },
        },
      };
    });
  }

  function buildTripForCard(card: AnchorCard) {
    const ctx = ctxByAnchor[card.id];
    const fallbackAnchor = anchorToRowEvent(card);
    const anchor = ctx?.anchor || fallbackAnchor;

    const allEvents = ensureAnchorIncluded(anchor, ctx?.events || []);
    const selectedMap = ctx?.selected || {};
    const selectedEvents = allEvents.filter((e) => selectedMap[eventKey(e)]);
    const finalEvents = ensureAnchorIncluded(anchor, selectedEvents);

    const validDates = finalEvents
      .map((e) => (isYMD(String(e.date || "")) ? String(e.date) : ""))
      .filter(Boolean)
      .sort();

    const payload: BuildTripPayload = {
      tripStyle: "B",
      countryCode,
      anchor,
      events: finalEvents,
      startYMD: validDates[0] || anchor?.date || null,
      endYMD: validDates[validDates.length - 1] || anchor?.date || null,
    };

    const data = encodeBuildTripDataParam(payload);
    router.push(`${BUILD_TRIP_ROUTE}?data=${data}`);
  }

  const hasAnyF2Crossovers = useMemo(() => {
    if (!f2) return false;
    return cards.some((card) => tripIncludesFavorite(card, f2, ctxByAnchor[card.id]));
  }, [cards, f2, ctxByAnchor]);

  const stickyMessage = useMemo(() => {
    if (f2 && !hasAnyF2Crossovers) {
      return `All trips include F1 (${f1.label}). Unfortunately F1 and F2 don't cross paths in their current schedules.`;
    }

    if (f2) {
      return `All trips include F1 (${f1.label}). Green shaded cards also include an F2 event (${f2.label}).`;
    }

    return `All trips include F1 (${f1.label}).`;
  }, [f1.label, f2, hasAnyF2Crossovers]);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-4 lg:max-w-4xl lg:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <BrandLogo />
              <div className="min-w-0">
                <div className="text-base font-black tracking-tight text-slate-900 sm:text-lg">
                  Favorites Results
                </div>
                <div className="mt-0.5 truncate text-[11px] text-slate-600 sm:text-xs">{header}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => router.push("/")}
              className="shrink-0 rounded-2xl bg-slate-900 px-3.5 py-2 text-[11px] font-extrabold text-white hover:bg-slate-800 sm:px-4 sm:py-2.5 sm:text-xs"
              title="Search again"
            >
              Search
            </button>
          </div>
        </div>
      </div>

      {!loading && !err && (
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto w-full max-w-md px-4 py-3 lg:max-w-4xl lg:px-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[11px] font-semibold text-slate-700 sm:text-xs">
              {stickyMessage}
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-md px-4 py-4 lg:max-w-4xl lg:px-6 lg:py-8">
        {loading && (
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

        {!loading && !err && (
          <>
            <div className="mb-3 text-[11px] text-slate-600 sm:text-xs">
              Trip cards: <span className="font-extrabold text-slate-900">{cards.length}</span>
            </div>

            <div className="space-y-3">
              {cards.map((c) => {
                const ctx = ctxByAnchor[c.id];
                const isOpen = openId === c.id;
                const isPreloading = Boolean(ctx?.loading);
                const green = isGreenCard(c, f1, f2, ctx);

                const nearbyEvents = ctx?.events || [];
                const grouped = groupByDate(nearbyEvents);
                const selectedCount = Object.values(ctx?.selected || {}).filter(Boolean).length;

                const tripLocation = getTripLocationLabel(c, ctx);
                const tripDateRange = getTripDateRange(c, ctx);

                const g1State = g1 ? getGenreMatchState(g1, ctx) : "no";
                const g2State = g2 ? getGenreMatchState(g2, ctx) : "no";

                return (
                  <CardVisibilityTrigger key={c.id} cardId={c.id} onVisible={enqueueCardContext}>
                    <section
                      className={cx(
                        "overflow-hidden rounded-3xl border shadow-sm transition cursor-pointer",
                        cardSurfaceClass(green)
                      )}
                      onClick={() => toggleOpen(c)}
                    >
                      <div className="p-4 sm:p-5">
                        <div className="min-w-0">
                          <div className={cx("text-base font-black tracking-tight sm:text-lg", titleTextClass(green))}>
                            {tripLocation || "Trip"}
                          </div>

                          <div className={cx("mt-1 text-sm font-semibold", bodyTextClass(green))}>
                            {tripDateRange}
                          </div>

                          {(g1 || g2) && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {g1 ? <GenreStatusButton label={g1} state={g1State} isGreen={green} /> : null}
                              {g2 ? <GenreStatusButton label={g2} state={g2State} isGreen={green} /> : null}
                            </div>
                          )}

                          <div className={cx("mt-3 text-[11px] sm:text-xs", mutedTextClass(green))}>
                            {isOpen
                              ? "Tap card to hide nearby events"
                              : isPreloading
                              ? "Checking trip details…"
                              : "Tap card to show nearby events"}
                          </div>
                        </div>
                      </div>

                      {isOpen && (
                        <div
                          className={cx("border-t", expandedSurfaceClass(green))}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <div className="p-3 sm:p-4">
                            {ctx?.loading && nearbyEvents.length === 0 ? (
                              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                                <div className={cx("text-sm font-semibold", bodyTextClass(green))}>
                                  Loading nearby events…
                                </div>
                              </div>
                            ) : ctx?.error ? (
                              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                                <div className="font-black">Couldn’t load nearby events.</div>
                                <div className="mt-1 font-semibold">{ctx.error}</div>
                              </div>
                            ) : nearbyEvents.length === 0 ? (
                              <div
                                className={cx(
                                  "rounded-2xl border px-4 py-4 text-sm",
                                  green
                                    ? "border-emerald-200 bg-white text-emerald-900"
                                    : "border-slate-200 bg-white text-slate-700"
                                )}
                              >
                                No included events returned for this anchor window.
                              </div>
                            ) : (
                              <div className="space-y-4">
                                {grouped
                                  .map((g) => ({ ...g, events: g.events.filter(isRenderableRowEvent) }))
                                  .filter((g) => g.events.length > 0)
                                  .map((g) => (
                                    <div key={g.date} className="space-y-2">
                                      <div
                                        className={cx(
                                          "px-1 text-[11px] font-black uppercase tracking-wide sm:text-xs",
                                          mutedTextClass(green)
                                        )}
                                      >
                                        {g.date === "TBD" ? "Date TBD" : fmtYMDPretty(g.date)}
                                      </div>

                                      <div className="space-y-2">
                                        {g.events.map((e) => {
                                          const k = eventKey(e);
                                          const checked = Boolean(ctx?.selected?.[k]);
                                          const where = String(e.location || "").trim();

                                          return (
                                            <label
                                              key={k}
                                              className={cx(
                                                "flex items-start gap-3 rounded-2xl border px-3 py-3",
                                                green
                                                  ? "border-emerald-200 bg-white hover:bg-emerald-50/40"
                                                  : "border-slate-200 bg-white hover:bg-slate-50"
                                              )}
                                            >
                                              <input
                                                type="checkbox"
                                                className="mt-0.5 h-4 w-4 shrink-0"
                                                checked={checked}
                                                onChange={(ev) => setChecked(c.id, e, ev.target.checked)}
                                              />

                                              <div className="min-w-0 flex-1">
                                                <div className={cx("text-sm font-black leading-5", titleTextClass(green))}>
                                                  {e.name}
                                                </div>

                                                {(where || e.genre) && (
                                                  <div
                                                    className={cx(
                                                      "mt-1 text-[11px] font-semibold leading-4 sm:text-xs",
                                                      mutedTextClass(green)
                                                    )}
                                                  >
                                                    {where}
                                                    {where && e.genre ? (
                                                      <span className={cx("mx-2", dividerTextClass(green))}>•</span>
                                                    ) : null}
                                                    {e.genre ? <span>{e.genre}</span> : null}
                                                  </div>
                                                )}

                                                {e.url ? (
                                                  <div className="mt-2">
                                                    <a
                                                      href={e.url}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      className={linkClass(green)}
                                                      onClick={(ev) => ev.stopPropagation()}
                                                    >
                                                      Tickets
                                                    </a>
                                                  </div>
                                                ) : null}
                                              </div>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}

                                <div className="pt-1">
                                  <button
                                    type="button"
                                    onClick={() => buildTripForCard(c)}
                                    className={cx(
                                      "h-11 w-full rounded-2xl px-4 text-sm font-extrabold",
                                      green
                                        ? "bg-emerald-900 text-white hover:bg-emerald-800"
                                        : "bg-slate-900 text-white hover:bg-slate-800"
                                    )}
                                    title="Open Trip Hub with your selected events"
                                  >
                                    Build trip{selectedCount ? ` (${selectedCount})` : ""}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </section>
                  </CardVisibilityTrigger>
                );
              })}
            </div>

            {cards.length === 0 && (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
                No trips found.
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}