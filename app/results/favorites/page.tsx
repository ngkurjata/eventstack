"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "@/app/components/BrandLogo";
import { allGenreLabels, includesGenre, normalizeGenres } from "@/lib/events/genres";
import { csvToList, listToCsv } from "@/lib/url";
import {
  RowEvent,
  coerceTripContextResponse,
  fmtYMDPretty,
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
  presentFavorites: string[];
  presentGenres: string[];
  requirementsMet: boolean;
};

type FavoriteOption = {
  key: string;
  label: string;
  kind: "team" | "artist";
  attractionId?: string;
  defaultGenre?: string;
  rawName: string;
  league?: string;
};

type ResolveFavoriteResponse = {
  ok: boolean;
  q: string;
  items: FavoriteOption[];
  error?: string;
};

type GenreOption = {
  label: string;
};

const MAX_PRELOAD_CONCURRENCY = 4;
const PRELOAD_ROOT_MARGIN = "120px 0px";
const MAX_GENRES = 2;
const AREA_RADIUS_MILES = 90;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function norm(s: any) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeToken(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
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

  const exists = out.some((e) => {
    return (
      String(e?.name || "").trim().toLowerCase() === String(anchor?.name || "").trim().toLowerCase() &&
      String(e?.date || "").trim() === String(anchor?.date || "").trim() &&
      String(e?.location || "").trim().toLowerCase() ===
        String(anchor?.location || "").trim().toLowerCase()
    );
  });

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

function getTripWindow(card: AnchorCard, ctx?: ContextState) {
  const events = getTripEvents(card, ctx);
  const validDates = uniqueStrings(
    events
      .map((e) => (isYMD(String(e.date || "")) ? String(e.date) : ""))
      .filter(Boolean)
  ).sort();

  if (!validDates.length) {
    const fallback = card.localDate && isYMD(card.localDate) ? card.localDate : "";
    return {
      start: fallback,
      end: fallback,
    };
  }

  return {
    start: validDates[0],
    end: validDates[validDates.length - 1],
  };
}

function getCtxGenrePool(ctx?: ContextState) {
  return normalizeGenres([
    ...(ctx?.presentGenres || []),
    ...((ctx?.events || []).flatMap((e) => [e?.genre])),
  ]);
}

function getTripIncludesText({
  ctx,
  selectedGenres,
}: {
  card: AnchorCard;
  ctx?: ContextState;
  f2: Favorite | null;
  selectedGenres: string[];
}) {
  const parts: string[] = [];
  const genrePool = getCtxGenrePool(ctx);

  for (const genre of selectedGenres) {
    if (includesGenre(genrePool, genre)) {
      parts.push(genre.toUpperCase());
    }
  }

  if (!parts.length) return "";
  return `Trip includes ${parts.join(" - ")}`;
}

function makeContextKey(cardId: string, favorite2AttractionId: string | null | undefined) {
  return `${cardId}__${normalizeToken(favorite2AttractionId)}`;
}

function hasLoadedContext(ctx?: ContextState) {
  if (!ctx) return false;
  if (ctx.loading) return false;
  return true;
}

function allCardsChecked(
  cards: AnchorCard[],
  getCurrentCtx: (cardId: string) => ContextState | undefined,
  needsContext: boolean
) {
  if (!needsContext) return true;
  if (!cards.length) return true;

  return cards.every((card) => {
    const ctx = getCurrentCtx(card.id);
    return Boolean(ctx && !ctx.loading);
  });
}

function ComboBox<T extends { label: string }>(props: {
  label: string;
  value: string;
  placeholder?: string;
  options: T[];
  onChange: (next: string) => void;
  onPick: (opt: T) => void;
  disabled?: boolean;
  rightHint?: string;
}) {
  const { label, value, placeholder, options, onChange, onPick, disabled, rightHint } = props;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = norm(value);
    const base = options || [];
    if (!q) return base.slice(0, 12);
    const hits = base.filter((o) => norm(o.label).includes(q));
    return hits.slice(0, 12);
  }, [options, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [value]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-end justify-between">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        {rightHint ? <div className="text-[11px] text-slate-500">{rightHint}</div> : null}
      </div>

      <input
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) setOpen(true);
          if (!open) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((n) => Math.min(n + 1, Math.max(0, filtered.length - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((n) => Math.max(0, n - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const opt = filtered[active];
            if (opt) {
              onPick(opt);
              setOpen(false);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className={cx(
          "mt-1 h-11 w-full rounded-2xl border bg-white px-4 text-sm font-semibold text-slate-900 outline-none",
          "border-slate-200 focus:border-slate-400",
          disabled && "cursor-not-allowed bg-slate-100 text-slate-500"
        )}
      />

      {open && filtered.length > 0 && !disabled && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          {filtered.map((opt, idx) => (
            <button
              type="button"
              key={(opt as any).key || opt.label}
              onMouseEnter={() => setActive(idx)}
              onClick={() => {
                onPick(opt);
                setOpen(false);
              }}
              className={cx(
                "w-full px-4 py-2 text-left text-sm",
                idx === active ? "bg-slate-900 text-white" : "bg-white text-slate-900 hover:bg-slate-50"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectionChip({
  text,
  onRemove,
  disabled,
  title,
}: {
  text: string;
  onRemove: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <div
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-extrabold sm:text-xs",
        disabled
          ? "border-slate-200 bg-slate-100 text-slate-400"
          : "border-slate-300 bg-slate-100 text-slate-800"
      )}
      title={title}
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className={cx(
          "rounded-full px-1 leading-none",
          disabled ? "cursor-not-allowed text-slate-400" : "text-slate-700 hover:bg-slate-200"
        )}
        aria-label={`Remove ${text}`}
      >
        ×
      </button>
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
        if (!first || !first.isIntersecting || fired) return;
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

  const f1Label = sp.get("f1Label") || "";
  const f1AttractionId = sp.get("f1AttractionId") || "";
  const f1DefaultGenre = sp.get("f1DefaultGenre") || "Hockey";

  const initialF2 = useMemo(() => {
    const label = sp.get("f2Label") || "";
    const attractionId = sp.get("f2AttractionId") || "";
    const defaultGenre = sp.get("f2DefaultGenre") || "";
    if (!label || !attractionId) return null;
    return makeFavorite("F2", label, attractionId, defaultGenre || "Other");
  }, [sp]);

  const initialGenres = useMemo(() => {
    return csvToList(sp.get("genres") || "")
      .map((g) => String(g).trim())
      .filter(Boolean)
      .slice(0, MAX_GENRES);
  }, [sp]);

  const f1 = useMemo(() => {
    return makeFavorite("F1", f1Label, f1AttractionId, f1DefaultGenre);
  }, [f1Label, f1AttractionId, f1DefaultGenre]);

  const [selectedF2, setSelectedF2] = useState<Favorite | null>(initialF2);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(initialGenres);

  const [f2Input, setF2Input] = useState("");
  const [genreInput, setGenreInput] = useState("");

  const [favoriteOptions, setFavoriteOptions] = useState<FavoriteOption[]>([]);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [favoriteError, setFavoriteError] = useState("");

  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ctxCache, setCtxCache] = useState<Record<string, ContextState>>({});
  const [resolvedCards, setResolvedCards] = useState<AnchorCard[]>([]);

  const searchAbortRef = useRef<AbortController | null>(null);
  const ctxCacheRef = useRef<Record<string, ContextState>>({});
  const contextInflightRef = useRef<Partial<Record<string, Promise<void>>>>({});
  const queueRef = useRef<Array<{ card: AnchorCard; contextKey: string }>>([]);
  const activeCountRef = useRef(0);
  const cardsRef = useRef<AnchorCard[]>([]);
  const lastUrlRef = useRef("");
  const genreLabels = useMemo(() => allGenreLabels(), []);

  useEffect(() => {
    ctxCacheRef.current = ctxCache;
  }, [ctxCache]);

  useEffect(() => {
    const incomingF2 = initialF2;
    const sameF2 =
      normalizeToken(incomingF2?.label) === normalizeToken(selectedF2?.label) &&
      normalizeToken(incomingF2?.attractionId) === normalizeToken(selectedF2?.attractionId) &&
      normalizeToken(incomingF2?.defaultGenre) === normalizeToken(selectedF2?.defaultGenre);

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
  }, [initialF2, initialGenres]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = f2Input.trim();

    if (!q) {
      setFavoriteOptions([]);
      setFavoriteLoading(false);
      setFavoriteError("");
      return;
    }

    const controller = new AbortController();

    const t = window.setTimeout(async () => {
      try {
        setFavoriteLoading(true);
        setFavoriteError("");

        const res = await fetch(`/api/resolve/favorite?q=${encodeURIComponent(q)}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        const data: ResolveFavoriteResponse = await res.json();

        if (!res.ok || !data?.ok) {
          setFavoriteOptions([]);
          setFavoriteError(data?.error || "Could not load favorites.");
          return;
        }

        const nextItems = Array.isArray(data.items) ? data.items : [];
        setFavoriteOptions(
          nextItems.filter((opt) => normalizeToken(opt.rawName) !== normalizeToken(f1.label))
        );
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setFavoriteOptions([]);
        setFavoriteError("Could not load favorites.");
      } finally {
        setFavoriteLoading(false);
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [f2Input, f1.label]);

  const availableGenreOptions = useMemo<GenreOption[]>(() => {
    return genreLabels
      .filter((g) => !selectedGenres.some((picked) => normalizeToken(picked) === normalizeToken(g)))
      .map((label) => ({ label }));
  }, [genreLabels, selectedGenres]);

  const favoritesPayload = useMemo(() => {
    return [f1, ...(selectedF2 ? [selectedF2] : [])];
  }, [f1, selectedF2]);

  const searchRequestBody = useMemo(() => {
    return {
      favorite1: f1,
      favorite2: selectedF2,
      startDate: start || null,
      endDate: end || null,
      countryCode,
    };
  }, [f1, selectedF2, start, end, countryCode]);

  const filterSignature = useMemo(() => {
    return [
      normalizeToken(selectedF2?.attractionId),
      ...selectedGenres.map(normalizeToken).sort(),
    ].join("|");
  }, [selectedF2, selectedGenres]);

  const needsContextCheck = Boolean(selectedGenres.length > 0);

  const updateUrl = useCallback(
    (nextF2: Favorite | null, nextGenres: string[]) => {
      const params = new URLSearchParams();

      params.set("countryCode", countryCode);
      params.set("f1Label", f1.label);
      params.set("f1AttractionId", f1.attractionId);
      params.set("f1DefaultGenre", f1.defaultGenre);

      if (start) params.set("start", start);
      if (end) params.set("end", end);

      if (nextF2?.label && nextF2?.attractionId) {
        params.set("f2Label", nextF2.label);
        params.set("f2AttractionId", nextF2.attractionId);
        if (nextF2.defaultGenre) params.set("f2DefaultGenre", nextF2.defaultGenre);
      }

      const genreCsv = listToCsv(nextGenres);
      if (genreCsv) params.set("genres", genreCsv);

      const nextUrl = `/results/favorites?${params.toString()}`;
      if (lastUrlRef.current === nextUrl) return;

      lastUrlRef.current = nextUrl;
      router.replace(nextUrl, { scroll: false });
    },
    [countryCode, end, f1, router, start]
  );

  useEffect(() => {
    updateUrl(selectedF2, selectedGenres);
  }, [selectedF2, selectedGenres, updateUrl]);

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
      setCtxCache({});
      setResolvedCards([]);
      contextInflightRef.current = {};
      queueRef.current = [];
      activeCountRef.current = 0;

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
  }, [f1AttractionId, searchRequestBody]);

  const cards = resp?.anchorCards || [];

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    if (!needsContextCheck) {
      setResolvedCards(cards);
    }
  }, [cards, needsContextCheck]);

  const getCurrentCtx = useCallback(
    (cardId: string) => {
      return ctxCache[makeContextKey(cardId, selectedF2?.attractionId)];
    },
    [ctxCache, selectedF2]
  );

  const fetchContext = useCallback(
    async (card: AnchorCard, contextKey: string): Promise<void> => {
      const existing = ctxCacheRef.current[contextKey];
      if (existing?.loading) return;
      if (existing && hasLoadedContext(existing)) return;

      const inflight = contextInflightRef.current[contextKey];
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
          setCtxCache((prev) => ({
            ...prev,
            [contextKey]: {
              loading: false,
              error: "This anchor is missing valid localDate/lat/lon; cannot load nearby events.",
              events: prev[contextKey]?.events || [],
              anchor: prev[contextKey]?.anchor || anchorToRowEvent(card),
              presentFavorites: prev[contextKey]?.presentFavorites || [],
              presentGenres: prev[contextKey]?.presentGenres || [],
              requirementsMet: false,
            },
          }));
          return;
        }

        setCtxCache((prev) => ({
          ...prev,
          [contextKey]: {
            loading: true,
            error: "",
            anchor: prev[contextKey]?.anchor ?? null,
            events: prev[contextKey]?.events ?? [],
            presentFavorites: prev[contextKey]?.presentFavorites ?? [],
            presentGenres: prev[contextKey]?.presentGenres ?? [],
            requirementsMet: prev[contextKey]?.requirementsMet ?? false,
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
            genres: [],
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

          setCtxCache((prev) => ({
            ...prev,
            [contextKey]: {
              loading: false,
              error: "",
              anchor: resolvedAnchor,
              events: withAnchor,
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
          setCtxCache((prev) => ({
            ...prev,
            [contextKey]: {
              loading: false,
              error: e?.message || "Failed to load nearby events",
              anchor: prev[contextKey]?.anchor ?? anchorToRowEvent(card),
              events: prev[contextKey]?.events ?? [],
              presentFavorites: prev[contextKey]?.presentFavorites ?? [],
              presentGenres: prev[contextKey]?.presentGenres ?? [],
              requirementsMet: false,
            },
          }));
        }
      })();

      contextInflightRef.current[contextKey] = promise;

      try {
        await promise;
      } finally {
        delete contextInflightRef.current[contextKey];
      }
    },
    [countryCode, favoritesPayload]
  );

  const pumpQueue = useCallback(() => {
    while (activeCountRef.current < MAX_PRELOAD_CONCURRENCY && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) return;

      const existing = ctxCacheRef.current[next.contextKey];
      if (existing?.loading || hasLoadedContext(existing)) continue;

      const inflight = contextInflightRef.current[next.contextKey];
      if (inflight) continue;

      activeCountRef.current += 1;

      fetchContext(next.card, next.contextKey).finally(() => {
        activeCountRef.current -= 1;
        pumpQueue();
      });
    }
  }, [fetchContext]);

  const enqueueCardContext = useCallback(
    (cardId: string) => {
      const card = cardsRef.current.find((c) => c.id === cardId);
      if (!card) return;

      const contextKey = makeContextKey(card.id, selectedF2?.attractionId);
      const existing = ctxCacheRef.current[contextKey];
      if (existing?.loading || hasLoadedContext(existing)) return;

      const inflight = contextInflightRef.current[contextKey];
      if (inflight) return;

      queueRef.current = queueRef.current.filter((item) => item.contextKey !== contextKey);
      queueRef.current.push({ card, contextKey });
      pumpQueue();
    },
    [pumpQueue, selectedF2]
  );

  useEffect(() => {
    if (!cards.length) return;
    if (!selectedGenres.length) return;

    cards.forEach((card) => {
      enqueueCardContext(card.id);
    });
  }, [cards, enqueueCardContext, filterSignature, selectedGenres.length]);

  function openAreaResultsForCard(card: AnchorCard) {
    const ctx = getCurrentCtx(card.id);

    const cityLabel = [card.city, card.region].filter(Boolean).join(", ");
    const lat = typeof card.lat === "number" ? card.lat : null;
    const lon = typeof card.lon === "number" ? card.lon : null;
    const { start, end } = getTripWindow(card, ctx);

    if (!cityLabel || typeof lat !== "number" || typeof lon !== "number" || !start || !end) {
      return;
    }

    const params = new URLSearchParams({
      cityLabel,
      lat: String(lat),
      lon: String(lon),
      start,
      end,
      radiusMiles: String(AREA_RADIUS_MILES),
      countryCode,
    });

    router.push(`/results/area?${params.toString()}`);
  }

  function handlePickF2(opt: FavoriteOption) {
    const nextLabel = opt.rawName;
    const nextGenre = opt.defaultGenre || "Other";
    const id = String(opt.attractionId || "").trim();

    if (!id) return;

    setSelectedF2(makeFavorite("F2", nextLabel, id, nextGenre));
    setF2Input("");
    setFavoriteOptions([]);
    setFavoriteError("");
  }

  function addGenre(genre: string) {
    const raw = String(genre || "").trim();
    if (!raw) return;
    if (selectedGenres.length >= MAX_GENRES) return;
    if (selectedGenres.some((g) => normalizeToken(g) === normalizeToken(raw))) return;

    setSelectedGenres((prev) => [...prev, raw].slice(0, MAX_GENRES));
    setGenreInput("");
  }

  function removeGenreAtIndex(index: number) {
    if (index < 0 || index >= selectedGenres.length) return;
    if (index === 0 && selectedGenres.length > 1) return;
    setSelectedGenres((prev) => prev.filter((_, i) => i !== index));
  }

  const cardsStillChecking = useMemo(() => {
    return !allCardsChecked(cards, getCurrentCtx, needsContextCheck);
  }, [cards, getCurrentCtx, needsContextCheck]);

  const computedFilteredCards = useMemo(() => {
    if (!selectedGenres.length) return cards;

    return cards.filter((card) => {
      const ctx = getCurrentCtx(card.id);

      if (!ctx || ctx.loading) return true;
      if (ctx.error) return false;

      const genrePool = getCtxGenrePool(ctx);
      return selectedGenres.every((genre) => includesGenre(genrePool, genre));
    });
  }, [cards, getCurrentCtx, selectedGenres]);

  useEffect(() => {
    if (!needsContextCheck) {
      setResolvedCards(cards);
      return;
    }

    const done = allCardsChecked(cards, getCurrentCtx, true);
    if (!done) return;

    setResolvedCards(computedFilteredCards);
  }, [cards, computedFilteredCards, getCurrentCtx, needsContextCheck]);

  const displayedCards = useMemo(() => {
    if (!needsContextCheck) return cards;
    return cardsStillChecking ? resolvedCards : computedFilteredCards;
  }, [cards, cardsStillChecking, computedFilteredCards, needsContextCheck, resolvedCards]);

  const headerText = useMemo(() => {
    if (selectedF2 && selectedGenres.length) {
      return `Showing ${f1.label} / ${selectedF2.label} trips. Genre filters apply after verification completes.`;
    }

    if (selectedF2) {
      return `Showing only ${f1.label} / ${selectedF2.label} crossover trips.`;
    }

    if (selectedGenres.length) {
      return `Showing ${f1.label} trips. Genre filters apply after verification completes.`;
    }

    return `All trips include ${f1.label}.`;
  }, [f1.label, selectedF2, selectedGenres]);

  const favoriteHint = favoriteLoading
    ? "Searching..."
    : favoriteError
    ? favoriteError
    : f2Input.trim()
    ? `${favoriteOptions.length} match${favoriteOptions.length === 1 ? "" : "es"}`
    : "optional";

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
                <div className="mt-0.5 truncate text-[11px] text-slate-600 sm:text-xs">
                  {f1.label || "Favorites"}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => router.push("/")}
              className="shrink-0 rounded-2xl bg-slate-900 px-3.5 py-2 text-[11px] font-extrabold text-white hover:bg-slate-800 sm:px-4 sm:py-2.5 sm:text-xs"
              title="Search again"
            >
              Search Again
            </button>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 lg:max-w-4xl lg:px-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-700 sm:text-xs">{headerText}</div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ComboBox<FavoriteOption>
                label="Add Favorite 2"
                value={f2Input}
                placeholder={selectedF2 ? "Replace Favorite 2…" : "Type a team or artist…"}
                options={favoriteOptions}
                onChange={(v) => {
                  setF2Input(v);
                  if (!v.trim()) {
                    setSelectedF2(null);
                    setFavoriteOptions([]);
                    setFavoriteError("");
                  }
                }}
                onPick={handlePickF2}
                disabled={false}
                rightHint={favoriteHint}
              />

              <ComboBox<GenreOption>
                label="Add Genre"
                value={genreInput}
                placeholder={selectedGenres.length >= MAX_GENRES ? "Maximum reached" : "Type a genre…"}
                options={availableGenreOptions}
                onChange={setGenreInput}
                onPick={(opt) => addGenre(opt.label)}
                disabled={selectedGenres.length >= MAX_GENRES}
                rightHint={`up to ${MAX_GENRES}`}
              />
            </div>

            {(selectedF2 || selectedGenres.length > 0) && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {selectedF2 ? (
                  <SelectionChip text={`F2: ${selectedF2.label}`} onRemove={() => setSelectedF2(null)} />
                ) : null}

                {selectedGenres.map((genre, index) => (
                  <SelectionChip
                    key={`${genre}-${index}`}
                    text={`G${index + 1}: ${genre}`}
                    onRemove={() => removeGenreAtIndex(index)}
                    disabled={index === 0 && selectedGenres.length > 1}
                    title={index === 0 && selectedGenres.length > 1 ? "Remove Genre 2 first" : undefined}
                  />
                ))}

                {selectedGenres.length > 1 ? (
                  <div className="text-[11px] font-semibold text-slate-500">
                    Remove Genre 2 before removing Genre 1.
                  </div>
                ) : null}
              </div>
            )}

            {cardsStillChecking && (
              <div className="mt-4 inline-flex items-center gap-2 text-[11px] font-semibold text-slate-500 sm:text-xs">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                Updating trip matches…
              </div>
            )}
          </div>
        </div>
      </div>

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
            <div className="space-y-3">
              {displayedCards.map((c) => {
                const ctx = getCurrentCtx(c.id);
                const tripLocation = getTripLocationLabel(c, ctx);
                const tripDateRange = getTripDateRange(c, ctx);
                const includesText = getTripIncludesText({
                  card: c,
                  ctx,
                  f2: selectedF2,
                  selectedGenres,
                });

                return (
                  <CardVisibilityTrigger key={c.id} cardId={c.id} onVisible={enqueueCardContext}>
                    <section
                      className="cursor-pointer overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                      onClick={() => openAreaResultsForCard(c)}
                    >
                      <div className="min-w-0">
                        <div className="inline-block border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-slate-600 sm:text-xs">
                          {c.localDate && isYMD(c.localDate) ? fmtYMDPretty(c.localDate) : "Date TBD"}
                        </div>

                        <div className="px-2 py-1.5 sm:px-3 sm:py-2">
                          <div className="truncate text-base font-black leading-tight text-slate-900 sm:text-lg">
                            {c.name || "Event"}
                          </div>

                          <div className="mt-1 text-sm font-semibold leading-tight text-slate-600">
                            {[c.city, c.region].filter(Boolean).join(", ") || tripLocation || "Location TBD"}
                          </div>

                          <div className="mt-1 text-[11px] font-semibold text-slate-700 sm:text-xs">
                            {tripDateRange}
                          </div>

                          {includesText ? (
                            <div className="mt-1 text-[11px] font-extrabold uppercase tracking-wide text-slate-800 sm:text-xs">
                              {includesText}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  </CardVisibilityTrigger>
                );
              })}
            </div>

            {!cardsStillChecking && displayedCards.length === 0 && (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
                {cards.length === 0
                  ? selectedF2
                    ? "No F1 / F2 crossover trips found."
                    : "No trips found."
                  : "No trips match the selected favorite / genre filters."}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}