"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { allVisibleGenreLabels } from "@/lib/events/genres";
import { csvToList, listToCsv } from "@/lib/url";
import { fmtYMDPretty, isYMD } from "@/lib/trips/sharePayload";

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

type CombinedOption =
  | {
      key: string;
      label: string;
      optionType: "favorite";
      favorite: FavoriteOption;
    }
  | {
      key: string;
      label: string;
      optionType: "genre";
      genre: string;
    };

const MAX_PRELOAD_CONCURRENCY = 4;
const PRELOAD_ROOT_MARGIN = "120px 0px";
const AREA_RADIUS_MILES = 90;
const ANCHOR_DAY_WINDOW = 2;

const SS_FAVORITES_STATE = "eventstack_favorites_state_v1";

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

function makeFavorite(
  id: string,
  label: string,
  attractionId: string,
  defaultGenre: string
): Favorite {
  return { id, label, attractionId, defaultGenre };
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

function ymdFromLocalDate(dt: Date) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayYMD() {
  return ymdFromLocalDate(new Date());
}

function fmtDateChip(ymd: string) {
  if (!isYMD(ymd)) return "";
  try {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return ymd;
  }
}

function makeContextKey(
  cardId: string,
  favorite2AttractionId: string | null | undefined,
  selectedGenres: string[]
) {
  return `${cardId}__${normalizeToken(favorite2AttractionId)}__${selectedGenres
    .map(normalizeToken)
    .sort()
    .join("|")}`;
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

function favoritesStateKey(input: {
  countryCode: string;
  start: string;
  end: string;
  f1AttractionId: string;
  f2AttractionId: string;
  genres: string[];
}) {
  return [
    String(input.countryCode || "").trim(),
    String(input.start || "").trim(),
    String(input.end || "").trim(),
    String(input.f1AttractionId || "").trim(),
    String(input.f2AttractionId || "").trim(),
    [...input.genres].map((g) => normalizeToken(g)).sort().join(","),
  ].join("|");
}

function readFavoritesStateMap(): Record<string, any> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SS_FAVORITES_STATE);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeFavoritesStateMap(map: Record<string, any>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SS_FAVORITES_STATE, JSON.stringify(map));
  } catch {}
}

function readFavoritesState(key: string) {
  const map = readFavoritesStateMap();
  return map[key] || null;
}

function writeFavoritesState(key: string, value: any) {
  const map = readFavoritesStateMap();
  map[key] = value;
  writeFavoritesStateMap(map);
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

function DatePickerButton(props: {
  value: string;
  onChange: (next: string) => void;
  min?: string;
  placeholder: string;
}) {
  const { value, onChange, min, placeholder } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);

  function openPicker() {
    const el = inputRef.current;
    if (!el) return;

    const anyEl = el as HTMLInputElement & { showPicker?: () => void };
    if (typeof anyEl.showPicker === "function") {
      anyEl.showPicker();
      return;
    }

    el.click();
  }

  return (
    <span className="relative inline-flex align-middle">
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        tabIndex={-1}
        aria-hidden="true"
      />

      <button
        type="button"
        onClick={openPicker}
        className={cx(
          "inline-flex h-11 min-w-[154px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none",
          "hover:border-slate-300"
        )}
      >
        <span>{value ? fmtDateChip(value) : placeholder}</span>
        <span aria-hidden="true" className="text-base">
          📅
        </span>
      </button>
    </span>
  );
}

function ComboBox<T extends { label: string }>(props: {
  label: string;
  value: string;
  placeholder?: string;
  options: T[];
  onChange: (next: string) => void;
  onPick: (opt: T) => void;
  disabled?: boolean;
  renderOption?: (opt: T, active: boolean) => React.ReactNode;
}) {
  const { label, value, placeholder, options, onChange, onPick, disabled, renderOption } = props;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = norm(value);
    const base = options || [];

    if (!q) return base.slice(0, 20);

    const starts = base.filter((o) => norm(o.label).startsWith(q));
    const contains = base.filter((o) => !norm(o.label).startsWith(q) && norm(o.label).includes(q));

    return [...starts, ...contains].slice(0, 20);
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

  useEffect(() => {
    if (!open || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(`[data-option-idx="${active}"]`);
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const showList = open && !disabled && value.trim().length > 0;

  return (
    <div ref={wrapRef} className="relative inline-block min-w-[240px] max-w-full overflow-visible align-middle sm:min-w-[280px]">
      <div className="sr-only">{label}</div>

      <input
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (disabled) return;

          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
            setOpen(true);
            return;
          }

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
          "h-11 w-full rounded-2xl border bg-white px-4 text-sm font-semibold text-slate-900 outline-none",
          "border-slate-200 focus:border-slate-400",
          disabled && "cursor-default bg-white text-slate-900"
        )}
      />

      {showList && (
        <div className="absolute left-0 top-full z-50 mt-2 w-full min-w-[320px] max-w-[min(92vw,38rem)] rounded-2xl border border-slate-200 bg-white shadow-lg ring-1 ring-black/5">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <div className="text-[11px] font-semibold text-slate-500">
              {filtered.length > 0
                ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}`
                : "No matches"}
            </div>
            {filtered.length > 0 ? (
              <div className="text-[11px] text-slate-400">Use ↑ ↓ and Enter</div>
            ) : null}
          </div>

          {filtered.length > 0 ? (
            <div ref={listRef} className="max-h-96 overflow-y-auto overscroll-contain py-1">
              {filtered.map((opt, idx) => {
                const isActive = idx === active;
                return (
                  <button
                    type="button"
                    key={(opt as any).key || opt.label}
                    data-option-idx={idx}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => {
                      onPick(opt);
                      setOpen(false);
                    }}
                    className={cx(
                      "w-full border-b border-slate-100 px-4 py-3 text-left text-sm last:border-b-0",
                      isActive ? "bg-slate-900 text-white" : "bg-white text-slate-900 hover:bg-slate-50"
                    )}
                  >
                    {renderOption ? renderOption(opt, isActive) : opt.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-3 text-sm text-slate-500">
              Keep typing to narrow it down.
            </div>
          )}
        </div>
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
  const appliedStartParam = sp.get("start") || "";
  const appliedEndParam = sp.get("end") || "";

  const f1Label = sp.get("f1Label") || "";
  const f1AttractionId = sp.get("f1AttractionId") || "";
  const f1DefaultGenre = sp.get("f1DefaultGenre") || "Hockey";

  const initialF2 = useMemo(() => {
    const label = sp.get("f2Label") || "";
    const attractionId = sp.get("f2AttractionId") || "";
    const defaultGenre = sp.get("f2DefaultGenre") || "";
    if (!label || !attractionId) return null;
    return makeFavorite("F2", label, attractionId, defaultGenre || "");
  }, [sp]);

  const initialGenres = useMemo(() => {
    return csvToList(sp.get("genres") || "")
      .map((g) => String(g).trim())
      .filter(Boolean)
      .slice(0, 1);
  }, [sp]);

  const f1 = useMemo(() => {
    return makeFavorite("F1", f1Label, f1AttractionId, f1DefaultGenre);
  }, [f1Label, f1AttractionId, f1DefaultGenre]);

  const [selectedF2, setSelectedF2] = useState<Favorite | null>(initialF2);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(initialGenres);

  const [startDateInput, setStartDateInput] = useState<string>(() => {
    return isYMD(appliedStartParam) ? appliedStartParam : "";
  });

  const [endDateInput, setEndDateInput] = useState<string>(() => {
    return isYMD(appliedEndParam) ? appliedEndParam : "";
  });

  const [appliedStartDate, setAppliedStartDate] = useState<string>(() => {
    return isYMD(appliedStartParam) ? appliedStartParam : "";
  });

  const [appliedEndDate, setAppliedEndDate] = useState<string>(() => {
    return isYMD(appliedEndParam) ? appliedEndParam : "";
  });

  const [comboInput, setComboInput] = useState("");

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
  const genreLabels = useMemo(() => allVisibleGenreLabels(), []);

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
    const nextAppliedStart = isYMD(appliedStartParam) ? appliedStartParam : "";
    const nextAppliedEnd = isYMD(appliedEndParam) ? appliedEndParam : "";

    setAppliedStartDate((prev) => (prev === nextAppliedStart ? prev : nextAppliedStart));
    setAppliedEndDate((prev) => (prev === nextAppliedEnd ? prev : nextAppliedEnd));

    setStartDateInput((prev) => (prev === nextAppliedStart ? prev : nextAppliedStart));
    setEndDateInput((prev) => (prev === nextAppliedEnd ? prev : nextAppliedEnd));
  }, [appliedStartParam, appliedEndParam]);

  useEffect(() => {
    const q = comboInput.trim();

    if (!q || selectedF2 || selectedGenres.length > 0) {
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
  }, [comboInput, f1.label, selectedF2, selectedGenres]);

  const availableGenreOptions = useMemo<GenreOption[]>(() => {
    if (selectedF2 || selectedGenres.length > 0) return [];
    return genreLabels.map((label) => ({ label }));
  }, [genreLabels, selectedF2, selectedGenres]);

  const combinedOptions = useMemo<CombinedOption[]>(() => {
    const canAddFilter = !selectedF2 && selectedGenres.length === 0;

    const favoriteItems: CombinedOption[] = canAddFilter
      ? favoriteOptions.map((opt) => ({
          key: `favorite-${String(opt.attractionId || opt.key || opt.label)}`,
          label: opt.label,
          optionType: "favorite",
          favorite: opt,
        }))
      : [];

    const genreItems: CombinedOption[] = canAddFilter
      ? availableGenreOptions.map((opt) => ({
          key: `genre-${opt.label}`,
          label: opt.label,
          optionType: "genre",
          genre: opt.label,
        }))
      : [];

    return [...favoriteItems, ...genreItems];
  }, [favoriteOptions, availableGenreOptions, selectedF2, selectedGenres]);

  const favoritesPayload = useMemo(() => {
    return [f1, ...(selectedF2 ? [selectedF2] : [])];
  }, [f1, selectedF2]);

  const searchRequestBody = useMemo(() => {
    return {
      favorite1: f1,
      favorite2: selectedF2,
      startDate: isYMD(appliedStartDate) ? appliedStartDate : null,
      endDate: isYMD(appliedEndDate) ? appliedEndDate : null,
      countryCode,
    };
  }, [f1, selectedF2, appliedStartDate, appliedEndDate, countryCode]);

  const filterSignature = useMemo(() => {
    return [
      normalizeToken(selectedF2?.attractionId),
      ...selectedGenres.map(normalizeToken).sort(),
    ].join("|");
  }, [selectedF2, selectedGenres]);

  const needsContextCheck = Boolean(selectedF2 || selectedGenres.length > 0);

  const pageStateKey = useMemo(() => {
    return favoritesStateKey({
      countryCode,
      start: appliedStartDate,
      end: appliedEndDate,
      f1AttractionId: f1.attractionId,
      f2AttractionId: selectedF2?.attractionId || "",
      genres: selectedGenres,
    });
  }, [countryCode, appliedStartDate, appliedEndDate, f1.attractionId, selectedF2, selectedGenres]);

  const updateUrl = useCallback(
    (nextF2: Favorite | null, nextGenres: string[], nextStartDate: string, nextEndDate: string) => {
      const params = new URLSearchParams();

      params.set("countryCode", countryCode);
      params.set("f1Label", f1.label);
      params.set("f1AttractionId", f1.attractionId);
      params.set("f1DefaultGenre", f1.defaultGenre);

      if (isYMD(nextStartDate)) params.set("start", nextStartDate);
      if (isYMD(nextEndDate)) params.set("end", nextEndDate);

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
    [countryCode, f1, router]
  );

  useEffect(() => {
    const cached = readFavoritesState(pageStateKey);
    if (!cached) return;

    if (cached.resp) setResp(cached.resp);
    if (cached.ctxCache) setCtxCache(cached.ctxCache);
    if (cached.resolvedCards) setResolvedCards(cached.resolvedCards);
    setErr(null);
    setLoading(false);
  }, [pageStateKey]);

  useEffect(() => {
    if (!resp) return;

    writeFavoritesState(pageStateKey, {
      resp,
      ctxCache,
      resolvedCards,
      savedAt: Date.now(),
    });
  }, [pageStateKey, resp, ctxCache, resolvedCards]);

  useEffect(() => {
    if (!f1AttractionId) {
      searchAbortRef.current?.abort();
      setResp(null);
      setErr("Favorite 1 is required.");
      setLoading(false);
      return;
    }

    if (appliedStartDate && !isYMD(appliedStartDate)) {
      searchAbortRef.current?.abort();
      setResp(null);
      setErr("Start date must be blank or a valid date.");
      setLoading(false);
      return;
    }

    if (appliedEndDate && !isYMD(appliedEndDate)) {
      searchAbortRef.current?.abort();
      setResp(null);
      setErr("End date must be blank or a valid date.");
      setLoading(false);
      return;
    }

    if (appliedStartDate && appliedStartDate < todayYMD()) {
      searchAbortRef.current?.abort();
      setResp(null);
      setErr("Start date cannot be earlier than today.");
      setLoading(false);
      return;
    }

    if (appliedStartDate && appliedEndDate && appliedEndDate < appliedStartDate) {
      searchAbortRef.current?.abort();
      setResp(null);
      setErr("End date cannot be earlier than start date.");
      setLoading(false);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    let cancelled = false;

    async function run() {
      const cached = readFavoritesState(pageStateKey);

      setLoading(true);
      setErr(null);

      if (!cached) {
        setCtxCache({});
        setResolvedCards([]);
      }

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
  }, [f1AttractionId, appliedStartDate, appliedEndDate, searchRequestBody, pageStateKey]);

  const cards = useMemo(() => resp?.anchorCards ?? [], [resp?.anchorCards]);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  const getCurrentCtx = useCallback(
    (cardId: string) => {
      return ctxCache[makeContextKey(cardId, selectedF2?.attractionId, selectedGenres)];
    },
    [ctxCache, selectedF2, selectedGenres]
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
              error: "This anchor is missing valid localDate/lat/lon.",
              presentFavorites: [],
              presentGenres: [],
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
            genres: selectedGenres,
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

          setCtxCache((prev) => ({
            ...prev,
            [contextKey]: {
              loading: false,
              error: "",
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
              error: e?.message || "Failed to validate anchor",
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
    [countryCode, favoritesPayload, selectedGenres]
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

      const contextKey = makeContextKey(card.id, selectedF2?.attractionId, selectedGenres);
      const existing = ctxCacheRef.current[contextKey];
      if (existing?.loading || hasLoadedContext(existing)) return;

      const inflight = contextInflightRef.current[contextKey];
      if (inflight) return;

      queueRef.current = queueRef.current.filter((item) => item.contextKey !== contextKey);
      queueRef.current.push({ card, contextKey });
      pumpQueue();
    },
    [pumpQueue, selectedF2, selectedGenres]
  );

  useEffect(() => {
    if (!cards.length) return;
    if (!needsContextCheck) return;

    cards.forEach((card) => {
      enqueueCardContext(card.id);
    });
  }, [cards, enqueueCardContext, filterSignature, needsContextCheck]);

  const applyDateFilters = useCallback(
    (nextStartDate: string, nextEndDate: string) => {
      const today = todayYMD();

      if (nextStartDate && !isYMD(nextStartDate)) {
        setErr("Start date must be blank or a valid date.");
        return;
      }

      if (nextEndDate && !isYMD(nextEndDate)) {
        setErr("End date must be blank or a valid date.");
        return;
      }

      if (nextStartDate && nextStartDate < today) {
        setErr("Start date cannot be earlier than today.");
        return;
      }

      if (nextStartDate && nextEndDate && nextEndDate < nextStartDate) {
        setErr("End date cannot be earlier than start date.");
        return;
      }

      setErr(null);
      setStartDateInput(nextStartDate);
      setEndDateInput(nextEndDate);
      setAppliedStartDate(nextStartDate);
      setAppliedEndDate(nextEndDate);
      updateUrl(selectedF2, selectedGenres, nextStartDate, nextEndDate);
    },
    [selectedF2, selectedGenres, updateUrl]
  );

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
      f1AttractionId: f1.attractionId,
      f1DefaultGenre: f1.defaultGenre,
    });

    if (selectedF2?.label && selectedF2?.attractionId) {
      params.set("f2Label", selectedF2.label);
      params.set("f2AttractionId", selectedF2.attractionId);
      if (selectedF2.defaultGenre) params.set("f2DefaultGenre", selectedF2.defaultGenre);
    }

    const genreCsv = listToCsv(selectedGenres);
    if (genreCsv) params.set("genres", genreCsv);

    router.push(`/results/area?${params.toString()}`);
  }

  function handlePickF2(opt: FavoriteOption) {
    if (selectedF2 || selectedGenres.length > 0) return;

    const nextLabel = opt.rawName;
    const nextGenre = opt.defaultGenre || "";
    const id = String(opt.attractionId || "").trim();

    if (!id) return;

    const nextFavorite = makeFavorite("F2", nextLabel, id, nextGenre);
    setSelectedF2(nextFavorite);
    setSelectedGenres([]);
    setComboInput(nextLabel);
    setFavoriteOptions([]);
    setFavoriteError("");
    setErr(null);
    updateUrl(nextFavorite, [], appliedStartDate, appliedEndDate);
  }

  function addGenre(genre: string) {
    if (selectedF2 || selectedGenres.length > 0) return;

    const raw = String(genre || "").trim();
    if (!raw) return;

    const nextGenres = [raw];
    setSelectedF2(null);
    setSelectedGenres(nextGenres);
    setComboInput(raw);
    setFavoriteOptions([]);
    setFavoriteError("");
    setErr(null);
    updateUrl(null, nextGenres, appliedStartDate, appliedEndDate);
  }

  function handlePickCombined(opt: CombinedOption) {
    if (selectedF2 || selectedGenres.length > 0) return;

    if (opt.optionType === "favorite") {
      handlePickF2(opt.favorite);
      return;
    }

    addGenre(opt.genre);
  }

  function clearOtherEventFilter() {
    setSelectedF2(null);
    setSelectedGenres([]);
    setComboInput("");
    setFavoriteOptions([]);
    setFavoriteError("");
    setErr(null);
    updateUrl(null, [], appliedStartDate, appliedEndDate);
  }

  function handleClearDates() {
    setStartDateInput("");
    setEndDateInput("");
    setErr(null);
    setAppliedStartDate("");
    setAppliedEndDate("");
    updateUrl(selectedF2, selectedGenres, "", "");
  }

  const cardsStillChecking = useMemo(() => {
    return !allCardsChecked(cards, getCurrentCtx, needsContextCheck);
  }, [cards, getCurrentCtx, needsContextCheck]);

  const computedFilteredCards = useMemo(() => {
    if (!needsContextCheck) return cards;

    return cards.filter((card) => {
      const ctx = getCurrentCtx(card.id);
      if (!ctx || ctx.loading) return true;
      if (ctx.error) return false;
      return Boolean(ctx.requirementsMet);
    });
  }, [cards, getCurrentCtx, needsContextCheck]);

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

  function getMatchSummary(card: AnchorCard, ctx?: ContextState) {
    if (!selectedF2 && !selectedGenres.length) return "";

    const parts: string[] = [];

    if (selectedF2) {
      const present = (ctx?.presentFavorites || []).some(
        (v) => normalizeToken(v) === normalizeToken(selectedF2.label)
      );
      if (present) parts.push(`Includes ${selectedF2.label}`);
    }

    if (selectedGenres[0]) {
      const genre = selectedGenres[0];
      const present = (ctx?.presentGenres || []).some(
        (v) => normalizeToken(v) === normalizeToken(genre)
      );
      if (present) parts.push(genre.toUpperCase());
    }

    return parts.join(" • ");
  }

  function favoriteSubLabel(opt: FavoriteOption) {
    const parts =
      opt.kind === "team"
        ? [String(opt.defaultGenre || "").trim(), String(opt.league || "").trim()]
        : [String(opt.defaultGenre || "").trim()];

    return parts.filter(Boolean).join(" • ");
  }

  const selectedOtherFilterLabel = selectedF2
    ? selectedF2.label
    : selectedGenres[0]
    ? selectedGenres[0]
    : "";

  const hasAppliedDateFilter = Boolean(appliedStartDate || appliedEndDate);
  const otherFilterLocked = Boolean(selectedOtherFilterLabel);

  const comboHint =
    !otherFilterLocked && comboInput.trim()
      ? favoriteLoading
        ? "Searching..."
        : favoriteError
        ? favoriteError
        : combinedOptions.length
        ? `${combinedOptions.length} option${combinedOptions.length === 1 ? "" : "s"}`
        : ""
      : "";

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 lg:max-w-4xl lg:px-6">
          <div className="mt-2 rounded-3xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-700">
              Optional Filters
            </div>

            <div className="mt-3 text-[10px] font-black uppercase tracking-wide text-slate-500">
              By Date
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs font-semibold leading-tight text-slate-700 sm:text-sm">
              <span>Only include events after</span>

              <DatePickerButton
                value={startDateInput}
                min={todayYMD()}
                placeholder="Select date"
                onChange={(next) => applyDateFilters(next, endDateInput)}
              />

              <span>and/or before</span>

              <DatePickerButton
                value={endDateInput}
                placeholder="Select date"
                onChange={(next) => applyDateFilters(startDateInput, next)}
              />

              {hasAppliedDateFilter ? (
                <button
                  type="button"
                  onClick={handleClearDates}
                  className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-[11px] font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div className="mt-3 text-[10px] font-black uppercase tracking-wide text-slate-500">
              By Other Events
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs font-semibold leading-tight text-slate-700 sm:text-sm">
              <span>Only include {f1.label || "Favorite 1"} events that also include</span>

              <div className="inline-flex flex-col">
                <ComboBox<CombinedOption>
                  label="Nearby Event / Team / Artist / Genre"
                  value={selectedOtherFilterLabel || comboInput}
                  placeholder="Type an event, team, artist, or genre…"
                  options={otherFilterLocked ? [] : combinedOptions}
                  onChange={(v) => {
                    if (otherFilterLocked) return;
                    setComboInput(v);
                    if (!v.trim()) {
                      setFavoriteOptions([]);
                      setFavoriteError("");
                    }
                  }}
                  onPick={handlePickCombined}
                  disabled={false}
                  renderOption={(opt, active) => {
                    if (opt.optionType === "favorite") {
                      const sub = favoriteSubLabel(opt.favorite);
                      return (
                        <div className="flex flex-col">
                          <span className="font-semibold">{opt.label}</span>
                          {sub ? (
                            <span className={cx("text-xs", active ? "text-slate-300" : "text-slate-500")}>
                              {sub}
                            </span>
                          ) : null}
                        </div>
                      );
                    }

                    return (
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold">{opt.label}</span>
                        <span
                          className={cx(
                            "text-[10px] font-black uppercase tracking-wide",
                            active ? "text-slate-300" : "text-slate-400"
                          )}
                        >
                          Genre
                        </span>
                      </div>
                    );
                  }}
                />

                {!otherFilterLocked && comboHint ? (
                  <div className="mt-1 text-[11px] text-slate-500">{comboHint}</div>
                ) : null}
              </div>

              <span>nearby</span>

              {otherFilterLocked ? (
                <button
                  type="button"
                  onClick={clearOtherEventFilter}
                  className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-[11px] font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              ) : null}
            </div>

            {cardsStillChecking && needsContextCheck && (
              <div className="mt-2 inline-flex items-center gap-2 text-[11px] font-semibold text-slate-500 sm:text-xs">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                Verifying anchor candidates…
              </div>
            )}
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
              {displayedCards.map((c) => {
                const ctx = getCurrentCtx(c.id);
                const matchSummary = getMatchSummary(c, ctx);

                return (
                  <CardVisibilityTrigger key={c.id} cardId={c.id} onVisible={enqueueCardContext}>
                    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
                      <button
                        type="button"
                        onClick={() => openAreaResultsForCard(c)}
                        className="block w-full text-left"
                      >
                        <div className="border-b border-slate-200 bg-slate-100 px-4 py-2 sm:px-5">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <div className="text-[11px] font-black uppercase tracking-wide text-slate-600 sm:text-xs">
                              {c.localDate && isYMD(c.localDate) ? fmtYMDPretty(c.localDate) : "Date TBD"}
                            </div>
                            <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500 sm:text-xs">
                              {fmtTimeDisplay(c.localTime)}
                            </div>
                            {c.isCrossover ? (
                              <div className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white sm:text-[11px]">
                                Crossover
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="px-4 py-3 sm:px-5 sm:py-4">
                          <div className="text-base font-black leading-tight text-slate-900 sm:text-lg">
                            {c.name || "Event"}
                          </div>

                          <div className="mt-1 text-sm font-semibold leading-tight text-slate-600">
                            {[c.city, c.region].filter(Boolean).join(", ") || "Location TBD"}
                          </div>

                          {c.venueName ? (
                            <div className="mt-1 text-sm font-semibold leading-tight text-slate-500">
                              {c.venueName}
                            </div>
                          ) : null}

                          {matchSummary ? (
                            <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-slate-800 sm:text-xs">
                              {matchSummary}
                            </div>
                          ) : null}
                        </div>
                      </button>
                    </section>
                  </CardVisibilityTrigger>
                );
              })}
            </div>

            {!cardsStillChecking && displayedCards.length === 0 && !loading && (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
                {cards.length === 0
                  ? "No Favorite 1 anchor events found."
                  : "No anchor events match the selected filter."}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}