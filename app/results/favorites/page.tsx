"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

function getIncludedFavoritePills(
  card: AnchorCard,
  f1: Favorite,
  f2: Favorite | null,
  ctx?: ContextState
) {
  const pills: string[] = [];

  if (tripIncludesFavorite(card, f1, ctx) && f1.label) pills.push(f1.label);
  if (tripIncludesFavorite(card, f2, ctx) && f2?.label) pills.push(f2.label);

  if (!pills.length && tripIncludesFavorite(card, f1, ctx) && f1.label) {
    pills.push(f1.label);
  }

  return uniqueStrings(pills);
}

function getIncludedGenrePills(
  card: AnchorCard,
  f1: Favorite,
  f2: Favorite | null,
  userGenres: string[],
  ctx?: ContextState
) {
  const out: string[] = [];
  const selectedGenreMap = new Map(userGenres.map((g) => [normalizeToken(g), g]));

  if (tripIncludesFavorite(card, f1, ctx) && f1.defaultGenre) {
    out.push(f1.defaultGenre);
  }

  if (tripIncludesFavorite(card, f2, ctx) && f2?.defaultGenre) {
    out.push(f2.defaultGenre);
  }

  const cardGenres = (card.matched?.genres || []) as string[];
  for (const g of [...cardGenres, ...(ctx?.presentGenres || [])]) {
    const normalized = normalizeToken(g);
    if (!normalized) continue;

    if (selectedGenreMap.has(normalized)) {
      out.push(selectedGenreMap.get(normalized)!);
    } else {
      out.push(g);
    }
  }

  return uniqueStrings(out);
}

function isBlackCard(card: AnchorCard, f1: Favorite, f2: Favorite | null, ctx?: ContextState) {
  if (!f2) return false;
  return tripIncludesFavorite(card, f1, ctx) && tripIncludesFavorite(card, f2, ctx);
}

function cardSurfaceClass(isBlack: boolean) {
  return isBlack ? "border-black bg-black" : "border-slate-200 bg-white";
}

function expandedSurfaceClass(isBlack: boolean) {
  return isBlack ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50/70";
}

function titleTextClass(isBlack: boolean) {
  return isBlack ? "text-white" : "text-slate-900";
}

function bodyTextClass(isBlack: boolean) {
  return isBlack ? "text-slate-200" : "text-slate-700";
}

function mutedTextClass(isBlack: boolean) {
  return isBlack ? "text-slate-300" : "text-slate-500";
}

function dividerTextClass(isBlack: boolean) {
  return isBlack ? "text-slate-500" : "text-slate-300";
}

function linkClass(isBlack: boolean) {
  return isBlack
    ? "text-xs font-extrabold text-white underline decoration-slate-500 hover:decoration-white"
    : "text-xs font-extrabold text-slate-900 underline decoration-slate-300 hover:decoration-slate-800";
}

function pillClass(kind: "favorite" | "genre", isBlack: boolean) {
  if (kind === "favorite") {
    return isBlack
      ? "border border-emerald-400/30 bg-emerald-500/20 text-emerald-100"
      : "border border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  return isBlack
    ? "border border-sky-400/30 bg-sky-500/20 text-sky-100"
    : "border border-sky-200 bg-sky-50 text-sky-800";
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
  const favoritesPayload = useMemo(() => [f1, ...(f2 ? [f2] : [])], [f1, f2]);

  const header = useMemo(() => {
    const favs = [f1.label, f2?.label].filter(Boolean).join(" + ");
    const datePart = start && end ? `${start} → ${end}` : "All upcoming";
    const genresPart = userGenres.length ? ` • +${userGenres.join(", ")}` : "";
    return `${favs} • ${datePart}${genresPart}`;
  }, [f1.label, f2?.label, start, end, userGenres]);

  async function fetchContext(card: AnchorCard) {
    const existing = ctxByAnchor[card.id];
    if (existing?.loading) return;
    if (existing && (existing.events.length > 0 || existing.error)) return;

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
  }

  function toggleOpen(card: AnchorCard) {
    setOpenId((prev) => (prev === card.id ? null : card.id));
  }

  useEffect(() => {
    if (!openId) return;
    const card = cards.find((c) => c.id === openId);
    if (!card) return;
    fetchContext(card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, cards]);

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

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-5 lg:max-w-4xl">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <BrandLogo />
              <div className="min-w-0">
                <div className="text-lg font-black tracking-tight text-slate-900">Favorites Results</div>
                <div className="mt-0.5 truncate text-xs text-slate-600">{header}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => router.push("/")}
              className="shrink-0 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-slate-800"
              title="Search again"
            >
              Search
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-4xl lg:py-10">
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
            <div className="mb-3 text-xs text-slate-600">
              Trip cards: <span className="font-extrabold text-slate-900">{cards.length}</span>
              <span className="mx-2 text-slate-300">•</span>
              Black cards include both <span className="font-extrabold">F1</span> and{" "}
              <span className="font-extrabold">F2</span>
              <span className="mx-2 text-slate-300">•</span>
              Green pills are favorites, blue pills are genres
            </div>

            <div className="space-y-3">
              {cards.map((c) => {
                const ctx = ctxByAnchor[c.id];
                const isOpen = openId === c.id;
                const isPreloading = Boolean(ctx?.loading);
                const black = isBlackCard(c, f1, f2, ctx);

                const nearbyEvents = ctx?.events || [];
                const grouped = groupByDate(nearbyEvents);
                const selectedCount = Object.values(ctx?.selected || {}).filter(Boolean).length;

                const tripLocation = getTripLocationLabel(c, ctx);
                const tripDateRange = getTripDateRange(c, ctx);
                const favoritePills = getIncludedFavoritePills(c, f1, f2, ctx);
                const genrePills = getIncludedGenrePills(c, f1, f2, userGenres, ctx);

                return (
                  <section
                    key={c.id}
                    className={cx(
                      "overflow-hidden rounded-3xl border shadow-sm transition cursor-pointer",
                      cardSurfaceClass(black)
                    )}
                    onClick={() => toggleOpen(c)}
                  >
                    <div className="p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className={cx("text-lg font-black tracking-tight", titleTextClass(black))}>
                            {tripLocation || "Trip"}
                          </div>

                          <div className={cx("mt-1 text-sm font-semibold", bodyTextClass(black))}>
                            {tripDateRange}
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {favoritePills.map((pill) => (
                              <span
                                key={`fav-${pill}`}
                                className={cx(
                                  "rounded-full px-2.5 py-1 text-[11px] font-extrabold",
                                  pillClass("favorite", black)
                                )}
                              >
                                {pill}
                              </span>
                            ))}

                            {genrePills.map((pill) => (
                              <span
                                key={`genre-${pill}`}
                                className={cx(
                                  "rounded-full px-2.5 py-1 text-[11px] font-extrabold",
                                  pillClass("genre", black)
                                )}
                              >
                                {pill}
                              </span>
                            ))}

                            {isPreloading && (
                              <span
                                className={cx(
                                  "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-extrabold",
                                  black
                                    ? "border border-white/10 bg-white/10 text-slate-200"
                                    : "border border-slate-200 bg-slate-100 text-slate-600"
                                )}
                              >
                                <span
                                  className={cx(
                                    "h-3 w-3 animate-spin rounded-full border-2",
                                    black
                                      ? "border-slate-400 border-t-white"
                                      : "border-slate-300 border-t-slate-700"
                                  )}
                                />
                                Loading trip details
                              </span>
                            )}
                          </div>

                          <div className={cx("mt-3 text-xs", mutedTextClass(black))}>
                            {isOpen
                              ? "Click card to hide nearby events"
                              : isPreloading
                              ? "Loading included trip details…"
                              : "Click card to show nearby events"}
                          </div>
                        </div>

                        {c.url ? (
                          <div className="shrink-0">
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className={linkClass(black)}
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              Tickets
                            </a>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {isOpen && (
                      <div
                        className={cx("border-t", expandedSurfaceClass(black))}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <div className="p-5 sm:p-6">
                          {ctx?.loading && nearbyEvents.length === 0 ? (
                            <div className="flex items-center gap-3">
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                              <div className={cx("text-sm font-semibold", bodyTextClass(black))}>
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
                                "rounded-2xl border p-4 text-sm",
                                black
                                  ? "border-white/10 bg-white/5 text-slate-200"
                                  : "border-slate-200 bg-white text-slate-700"
                              )}
                            >
                              No included events returned for this anchor window.
                            </div>
                          ) : (
                            <div className="space-y-5">
                              {grouped
                                .map((g) => ({ ...g, events: g.events.filter(isRenderableRowEvent) }))
                                .filter((g) => g.events.length > 0)
                                .map((g) => (
                                  <div key={g.date} className="space-y-2">
                                    <div className={cx("text-sm font-black", titleTextClass(black))}>
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
                                              "flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3",
                                              black
                                                ? "border-white/10 bg-white/5 hover:bg-white/10"
                                                : "border-slate-200 bg-white hover:bg-slate-50"
                                            )}
                                          >
                                            <input
                                              type="checkbox"
                                              className="mt-1 h-4 w-4"
                                              checked={checked}
                                              onChange={(ev) => setChecked(c.id, e, ev.target.checked)}
                                            />

                                            <div className="min-w-0 flex-1">
                                              <div className={cx("text-xs font-semibold", bodyTextClass(black))}>
                                                {where}
                                                {e.genre ? (
                                                  <span className={cx("mx-2", dividerTextClass(black))}>•</span>
                                                ) : null}
                                                {e.genre ? (
                                                  <span className={black ? "text-slate-300" : "text-slate-600"}>
                                                    {e.genre}
                                                  </span>
                                                ) : null}
                                              </div>

                                              <div className={cx("mt-1 text-sm font-black", titleTextClass(black))}>
                                                {e.name}
                                              </div>

                                              {e.url ? (
                                                <div className="mt-2">
                                                  <a
                                                    href={e.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className={linkClass(black)}
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

                              <div className="pt-2">
                                <button
                                  type="button"
                                  onClick={() => buildTripForCard(c)}
                                  className={cx(
                                    "h-11 w-full rounded-2xl px-4 text-sm font-extrabold",
                                    black
                                      ? "bg-white text-slate-900 hover:bg-slate-100"
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