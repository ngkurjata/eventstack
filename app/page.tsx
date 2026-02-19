// FILE: app/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_NAME, TAGLINE, LOGO_VERSION } from "../lib/brand";

type CombinedOption = {
  id: string;
  label: string;
  group: string; // NHL/NBA/MLB/NFL/MLS/CFL/Artists
  kind: "team" | "artist";
  league?: string;

  attractionId?: string; // Ticketmaster attractionId
  tmAttractionId?: string; // alternate name
};

type MenuItem =
  | { type: "group"; group: string }
  | { type: "item"; group: string; option: CombinedOption };

type AvailabilityRecord = {
  hasUpcomingEvents: boolean;
  nextEventDate: string | null;
  checkedAt?: string;
  warning?: string;
};

const LS_KEY = "eventstack_search_v3_primary_secondary_genres";

/* Trip-length presets */
const TRIP_DAYS_OPTIONS: Array<3 | 5 | 7> = [3, 5, 7];

/* Genre lists (UI buttons) */
const MUSIC_GENRES = [
  "Country",
  "Rock",
  "Pop",
  "Comedy",
  "Hip-Hop / Rap",
  "R&B",
  "Dance / Electronic",
  "Alternative",
  "Latin",
  "Metal",
  "Jazz",
  "Folk",
  "Classical",
  "Blues",
  "Reggae",
  "World",
  "Religious",
  "Holiday",
  "Children’s Music",
  "New Age",
] as const;

const SPORTS_GENRES = [
  "Football",
  "Baseball",
  "Hockey",
  "Basketball",
  "Curling",
  "Soccer",
  "Golf",
  "Tennis",
  "Motorsports",
  "Wrestling",
  "Lacrosse",
  "Martial Arts",
  "Volleyball",
  "Boxing",
  "Rodeo",
  "Cricket",
  "Equestrian",
] as const;

function sanitizeGenreList(input: string[], allowed: readonly string[]) {
  const allowedSet = new Set(allowed.map((x) => String(x)));
  return Array.from(
    new Set(
      (Array.isArray(input) ? input : [])
        .map((s) => String(s || "").trim())
        .map((s) => {
          if (allowedSet.has(s)) return s;
          const hit = Array.from(allowedSet).find((a) =>
            s.toLowerCase().includes(a.toLowerCase())
          );
          return hit || "";
        })
        .filter(Boolean)
    )
  );
}

function clampTotalGenres(music: string[], sports: string[], maxTotal: number) {
  const m = Array.isArray(music) ? music : [];
  const s = Array.isArray(sports) ? sports : [];

  if (m.length + s.length <= maxTotal) return { music: m, sports: s };

  // Keep earlier items; prioritize music first (stable + predictable)
  const musicKeep = m.slice(0, Math.min(m.length, maxTotal));
  const remaining = maxTotal - musicKeep.length;
  const sportsKeep = remaining > 0 ? s.slice(0, remaining) : [];

  return { music: musicKeep, sports: sportsKeep };
}

function safeParseInt(v: string | null, fallback: number) {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function normalizeDateRange(start: string, end: string) {
  const s = (start || "").trim();
  const e = (end || "").trim();
  if (!isYMD(s) || !isYMD(e)) return { start: s, end: e };
  return s <= e ? { start: s, end: e } : { start: e, end: s };
}

function labelForId(id: string, options: CombinedOption[]) {
  if (!id) return "";
  return options.find((o) => o.id === id)?.label || "";
}

function groupOptions(options: CombinedOption[]) {
  const map = new Map<string, CombinedOption[]>();
  for (const o of options) {
    const g = o.group || "Other";
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(o);
  }
  const groups = Array.from(map.keys());
  return { map, groups };
}

function normalizeQuery(q: string) {
  return q.trim().toLowerCase();
}

function buildGroupedListForQuery(
  query: string,
  grouped: Map<string, CombinedOption[]>,
  groups: string[]
): MenuItem[] {
  const q = normalizeQuery(query);
  const items: MenuItem[] = [];
  if (!q) return items;

  for (const group of groups) {
    const opts = grouped.get(group) || [];
    const matches = opts
      .filter((o) => o.label.toLowerCase().includes(q))
      .slice(0, 25);

    if (matches.length) {
      items.push({ type: "group", group });
      for (const option of matches) items.push({ type: "item", group, option });
    }
  }
  return items;
}

function cleanupLegacyLocalStorage() {
  // keep as a no-op
}

function useOutsideClick<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onOutside: () => void
) {
  useEffect(() => {
    function handler(e: MouseEvent) {
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside]);
}

/* -------------------- BRAND -------------------- */
function LogoMark({ className = "" }: { className?: string }) {
  return (
    <img
      src={`/brand/logo.svg?v=${encodeURIComponent(LOGO_VERSION)}`}
      alt={`${APP_NAME} logo`}
      className={["h-12 w-12", className].join(" ")}
      loading="eager"
      decoding="async"
    />
  );
}

/* -------------------- UI components -------------------- */

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 text-center">
        <h2 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
          {title}
        </h2>
        {subtitle ? (
          <div className="mt-2 text-xs text-slate-500 sm:text-sm">{subtitle}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Combobox({
  label,
  optionsAll,
  grouped,
  groups,
  valueId,
  setValueId,
  help,
  disabled,
}: {
  label: string;
  optionsAll: CombinedOption[];
  grouped: Map<string, CombinedOption[]>;
  groups: string[];
  valueId: string;
  setValueId: (v: string) => void;
  help?: string;
  disabled?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  const selectedLabel = useMemo(
    () => labelForId(valueId, optionsAll),
    [valueId, optionsAll]
  );

  const menuItems = useMemo(
    () => buildGroupedListForQuery(query, grouped, groups),
    [query, grouped, groups]
  );

  useEffect(() => {
    if (!open) {
      setInputValue(selectedLabel);
      setQuery("");
      setActiveIdx(-1);
    }
  }, [selectedLabel, open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQuery("");
      setActiveIdx(-1);
    }
  }, [disabled]);

  useOutsideClick(wrapRef, () => setOpen(false));

  function choose(id: string) {
    if (disabled) return;
    setValueId(id);
    const lbl = labelForId(id, optionsAll);
    setInputValue(lbl);
    setQuery("");
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.blur();
  }

  function clear() {
    if (disabled) return;
    setValueId("");
    setInputValue("");
    setQuery("");
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      if (inputValue.trim().length > 0) {
        setQuery(inputValue);
        setOpen(true);
      }
      return;
    }
    if (!open) return;

    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (e.key === "Tab") {
      const it = menuItems[activeIdx];
      if (it && it.type === "item") {
        setValueId(it.option.id);
        setInputValue(it.option.label);
      }
      setQuery("");
      setOpen(false);
      setActiveIdx(-1);
      return;
    }

    const selectableIndexes = menuItems
      .map((it, idx) => ({ it, idx }))
      .filter((x) => x.it.type === "item")
      .map((x) => x.idx);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (selectableIndexes.length === 0) return;
      const pos = selectableIndexes.indexOf(activeIdx);
      const next =
        pos === -1
          ? selectableIndexes[0]
          : selectableIndexes[Math.min(pos + 1, selectableIndexes.length - 1)];
      setActiveIdx(next);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (selectableIndexes.length === 0) return;
      const pos = selectableIndexes.indexOf(activeIdx);
      const prev =
        pos <= 0
          ? selectableIndexes[selectableIndexes.length - 1]
          : selectableIndexes[pos - 1];
      setActiveIdx(prev);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const it = menuItems[activeIdx];
      if (it && it.type === "item") choose(it.option.id);
      return;
    }
  }

  const showLoading = !!disabled;

  return (
    <div ref={wrapRef} className="w-full">
      <div className="mb-2">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        {help ? <div className="mt-1 text-xs text-slate-500">{help}</div> : null}
      </div>

      <div className="relative">
        <input
          ref={inputRef}
          disabled={showLoading}
          className={[
            "w-full rounded-2xl border px-4 py-3 text-[15px] shadow-sm outline-none",
            "transition-all duration-200",
            showLoading
              ? "bg-slate-50 text-slate-500 border-slate-200"
              : "bg-white text-slate-900 border-slate-200 placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100",
          ].join(" ")}
          value={showLoading ? "Loading ..." : inputValue}
          placeholder={showLoading ? "Loading ..." : "Type to search…"}
          onFocus={() => {
            if (showLoading) return;
            setActiveIdx(-1);
            requestAnimationFrame(() => inputRef.current?.select());
          }}
          onChange={(e) => {
            if (showLoading) return;

            const next = e.target.value;
            setInputValue(next);

            if (next.trim().length === 0) {
              setValueId("");
              setQuery("");
              setOpen(false);
              setActiveIdx(-1);
              return;
            }

            setQuery(next);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onKeyDown={onKeyDown}
          aria-expanded={open}
          aria-label={label}
        />

        {showLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
          </div>
        )}

        {!showLoading && (valueId || inputValue) && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Clear selection"
          >
            ✕
          </button>
        )}

        {open && !showLoading && query.trim().length > 0 && (
          <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="max-h-[320px] overflow-auto p-1">
              {menuItems.length === 0 ? (
                <div className="px-3 py-3 text-sm text-slate-500">No matches.</div>
              ) : (
                menuItems.map((it, idx) => {
                  if (it.type === "group") return null;

                  const isActive = idx === activeIdx;

                  return (
                    <div
                      key={it.option.id}
                      className={[
                        "mt-1 flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5",
                        isActive
                          ? "bg-slate-900 text-white"
                          : "bg-white text-slate-900 hover:bg-slate-50",
                      ].join(" ")}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(it.option.id);
                      }}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-extrabold leading-tight">
                          {it.option.label}
                        </div>
                      </div>

                      <div
                        className={[
                          "shrink-0 text-xs font-bold",
                          isActive ? "text-slate-200" : "text-slate-600",
                        ].join(" ")}
                      >
                        {it.group}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full rounded-2xl px-3 py-2 text-xs font-extrabold transition border text-center",
        selected
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/* -------------------- Ticketmaster attractionId extraction -------------------- */

function attractionIdFromOption(opt: CombinedOption | undefined | null): string {
  if (!opt) return "";

  const direct = String(opt.attractionId || opt.tmAttractionId || "").trim();
  if (direct) return direct;

  const raw = String(opt.id || "").trim();

  // team:<LEAGUE>:<ATTRACTION_ID>:<NAME...>
  if (raw.startsWith("team:")) {
    const parts = raw.split(":");
    return String(parts[2] || "").trim();
  }

  // artist:<ATTRACTION_ID>:<NAME...>
  if (raw.startsWith("artist:")) {
    const parts = raw.split(":");
    return String(parts[1] || "").trim();
  }

  return "";
}

function radiusMilesForTripDays(tripDays: 3 | 5 | 7) {
  if (tripDays <= 3) return 60;
  if (tripDays <= 5) return 120;
  return 180;
}

export default function Page() {
  const router = useRouter();
  const sp = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [combined, setCombined] = useState<CombinedOption[]>([]);

  const [primaryId, setPrimaryId] = useState("");
  const [secondaryId, setSecondaryId] = useState("");

  const [tripDays, setTripDays] = useState<3 | 5 | 7>(3);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const [musicGenres, setMusicGenres] = useState<string[]>([]);
  const [sportsGenres, setSportsGenres] = useState<string[]>([]);

  const MAX_GENRES_TOTAL = 4; // hard cap across Music+Sports
  const TOP_GENRE_COUNT = 5; // show before “Show more”

  const [showAllSports, setShowAllSports] = useState(false);
  const [showAllMusic, setShowAllMusic] = useState(false);

  const didInitRef = useRef(false);
  const [searchPulse, setSearchPulse] = useState(false);

  // Availability cache: key = attractionId
  const availabilityCacheRef = useRef<Map<string, AvailabilityRecord>>(new Map());
  const availabilityAbortRef = useRef<{ primary: AbortController | null; secondary: AbortController | null }>({
    primary: null,
    secondary: null,
  });
  const availabilityDebounceRef = useRef<{ primary: number | null; secondary: number | null }>({
    primary: null,
    secondary: null,
  });

  const [availabilityByKey, setAvailabilityByKey] = useState<Record<string, AvailabilityRecord>>({});
  const [primaryNoEvents, setPrimaryNoEvents] = useState(false);
  const [secondaryNoEvents, setSecondaryNoEvents] = useState(false);

  /* -------------------- Load options (dropdown data) -------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError("");

      try {
        const res = await fetch("/api/options", { cache: "no-store" });
        const data = await res.json();

        if (cancelled) return;

        setCombined(Array.isArray(data?.combined) ? data.combined : []);
        if (data?.error) setLoadError(String(data.error));
      } catch (err: any) {
        if (cancelled) return;
        setLoadError(err?.message || "Failed to load options");
        setCombined([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const { map: grouped, groups } = useMemo(() => groupOptions(combined), [combined]);
  const optionById = (id: string) => combined.find((o) => o.id === id);

  function clearSlotNoEvents(slot: "primary" | "secondary") {
    if (slot === "primary") setPrimaryNoEvents(false);
    else setSecondaryNoEvents(false);
  }

  function setSlotNoEvents(slot: "primary" | "secondary", noEvents: boolean) {
    if (slot === "primary") setPrimaryNoEvents(noEvents);
    else setSecondaryNoEvents(noEvents);
  }

  function abortAvailability(slot: "primary" | "secondary") {
    const cur = availabilityAbortRef.current[slot];
    cur?.abort();
    availabilityAbortRef.current[slot] = null;
  }

  function clearAvailabilityDebounce(slot: "primary" | "secondary") {
    const t = availabilityDebounceRef.current[slot];
    if (t) window.clearTimeout(t);
    availabilityDebounceRef.current[slot] = null;
  }

  async function fetchAvailability(attractionId: string, slot: "primary" | "secondary") {
    // in-memory cache first
    const cached = availabilityCacheRef.current.get(attractionId);
    if (cached) {
      setAvailabilityByKey((prev) => ({ ...prev, [attractionId]: cached }));
      setSlotNoEvents(slot, !cached.hasUpcomingEvents);
      return;
    }

    // state cache (for your existing UI)
    const cachedState = availabilityByKey[attractionId];
    if (cachedState) {
      availabilityCacheRef.current.set(attractionId, cachedState);
      setSlotNoEvents(slot, !cachedState.hasUpcomingEvents);
      return;
    }

    abortAvailability(slot);
    const ac = new AbortController();
    availabilityAbortRef.current[slot] = ac;

    try {
      const res = await fetch(`/api/availability?id=${encodeURIComponent(attractionId)}`, {
        cache: "no-store",
        signal: ac.signal,
      });

      const data = await res.json().catch(() => ({}));
      if (ac.signal.aborted) return;

      const rec = (data && data[attractionId]) as AvailabilityRecord | undefined;

      if (!rec) {
        // don’t show a scary warning if response shape is unexpected
        setSlotNoEvents(slot, false);
        return;
      }

      const normalized: AvailabilityRecord = {
        hasUpcomingEvents: !!rec.hasUpcomingEvents,
        nextEventDate: rec.nextEventDate ?? null,
        checkedAt: rec.checkedAt ?? new Date().toISOString(),
        warning: rec.warning,
      };

      availabilityCacheRef.current.set(attractionId, normalized);
      setAvailabilityByKey((prev) => ({ ...prev, [attractionId]: normalized }));
      setSlotNoEvents(slot, !normalized.hasUpcomingEvents);
    } catch {
      if (ac.signal.aborted) return;
      setSlotNoEvents(slot, false);
    } finally {
      if (availabilityAbortRef.current[slot] === ac) availabilityAbortRef.current[slot] = null;
    }
  }

  function ensureAvailability(optionId: string, slot: "primary" | "secondary") {
    if (!optionId) {
      clearSlotNoEvents(slot);
      return;
    }

    const opt = optionById(optionId);
    const tmAttractionId = attractionIdFromOption(opt);
    if (!tmAttractionId) {
      clearSlotNoEvents(slot);
      return;
    }

    // Debounce to avoid burst calls if user clicks rapidly
    clearAvailabilityDebounce(slot);
    availabilityDebounceRef.current[slot] = window.setTimeout(() => {
      fetchAvailability(tmAttractionId, slot);
    }, 250);
  }

  /* -------------------- Initial hydrate from URL or localStorage -------------------- */

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    cleanupLegacyLocalStorage();

    const qPrimary = sp.get("primaryId") || "";
    const qSecondary = sp.get("secondaryId") || "";
    const qTripDays = safeParseInt(sp.get("tripDays"), 3);

    const qStart = sp.get("start") || "";
    const qEnd = sp.get("end") || "";

    const qMusicGenres = (sp.getAll("musicGenres") || []).flatMap((v) =>
      String(v || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    );
    const qSportsGenres = (sp.getAll("sportsGenres") || []).flatMap((v) =>
      String(v || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    );

    const qMusicGenresClean = sanitizeGenreList(qMusicGenres, MUSIC_GENRES);
    const qSportsGenresClean = sanitizeGenreList(qSportsGenres, SPORTS_GENRES);

    const hasAnyUrlState = Boolean(
      qPrimary ||
        qSecondary ||
        sp.get("tripDays") ||
        qStart ||
        qEnd ||
        qMusicGenres.length ||
        qSportsGenres.length
    );

    const coerceTripDays = (n: number): 3 | 5 | 7 => (n === 5 ? 5 : n === 7 ? 7 : 3);

    const applyState = (next: {
      primaryId: string;
      secondaryId: string;
      tripDays: 3 | 5 | 7;
      start: string;
      end: string;
      musicGenres: string[];
      sportsGenres: string[];
    }) => {
      setPrimaryId(next.primaryId);
      setSecondaryId(next.secondaryId);
      setTripDays(next.tripDays);
      setStartDate(isYMD(next.start) ? next.start : "");
      setEndDate(isYMD(next.end) ? next.end : "");

      const clamped = clampTotalGenres(next.musicGenres, next.sportsGenres, MAX_GENRES_TOTAL);
      setMusicGenres(clamped.music);
      setSportsGenres(clamped.sports);
    };

    if (hasAnyUrlState) {
      applyState({
        primaryId: qPrimary,
        secondaryId: qSecondary,
        tripDays: coerceTripDays(qTripDays),
        start: qStart,
        end: qEnd,
        musicGenres: qMusicGenresClean,
        sportsGenres: qSportsGenresClean,
      });
      return;
    }

    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);

      applyState({
        primaryId: String(parsed?.primaryId || ""),
        secondaryId: String(parsed?.secondaryId || ""),
        tripDays: coerceTripDays(Number(parsed?.tripDays || 3)),
        start: String(parsed?.start || ""),
        end: String(parsed?.end || ""),
        musicGenres: sanitizeGenreList(
          Array.isArray(parsed?.musicGenres) ? parsed.musicGenres : [],
          MUSIC_GENRES
        ),
        sportsGenres: sanitizeGenreList(
          Array.isArray(parsed?.sportsGenres) ? parsed.sportsGenres : [],
          SPORTS_GENRES
        ),
      });
    } catch {
      // ignore
    }
  }, [sp]);

  /* -------------------- Keep URL + LS in sync (guarded; no churn) -------------------- */

  const lastAppliedUrlRef = useRef<string>("");

  useEffect(() => {
    if (!didInitRef.current) return;

    const { start: startNorm, end: endNorm } = normalizeDateRange(startDate, endDate);

    const musicGenresClean = sanitizeGenreList(musicGenres, MUSIC_GENRES);
    const sportsGenresClean = sanitizeGenreList(sportsGenres, SPORTS_GENRES);

    const clamped = clampTotalGenres(musicGenresClean, sportsGenresClean, MAX_GENRES_TOTAL);

    const effective = {
      primaryId,
      secondaryId,
      tripDays,
      start: isYMD(startNorm) ? startNorm : "",
      end: isYMD(endNorm) ? endNorm : "",
      musicGenres: clamped.music,
      sportsGenres: clamped.sports,
    };

    try {
      localStorage.setItem(LS_KEY, JSON.stringify(effective));
    } catch {}

    const qs = new URLSearchParams();
    if (effective.primaryId) qs.set("primaryId", effective.primaryId);
    if (effective.secondaryId) qs.set("secondaryId", effective.secondaryId);

    qs.set("tripDays", String(effective.tripDays));
    qs.set("radiusMiles", String(radiusMilesForTripDays(effective.tripDays)));
    qs.set("countryCode", "US,CA");

    if (effective.start) qs.set("start", effective.start);
    if (effective.end) qs.set("end", effective.end);

    for (const g of effective.musicGenres) qs.append("musicGenres", g);
    for (const g of effective.sportsGenres) qs.append("sportsGenres", g);

    const next = qs.toString() ? `/?${qs.toString()}` : "/";

    // Guard: only replaceState if it actually changed
    if (lastAppliedUrlRef.current !== next && window.location.pathname + window.location.search !== next) {
      lastAppliedUrlRef.current = next;
      window.history.replaceState(null, "", next);
    }
  }, [primaryId, secondaryId, tripDays, startDate, endDate, musicGenres, sportsGenres]);

  /* -------------------- CTA state -------------------- */

  const canSearch = Boolean(primaryId) && !primaryNoEvents;

  useEffect(() => {
    if (!loading && canSearch) {
      setSearchPulse(true);
      const t = window.setTimeout(() => setSearchPulse(false), 900);
      return () => window.clearTimeout(t);
    }
  }, [loading, canSearch]);

  /* -------------------- Genres (hard cap) -------------------- */

  function toggleGenreTotalCap(which: "music" | "sports", value: string) {
    const cur = which === "music" ? musicGenres : sportsGenres;
    const other = which === "music" ? sportsGenres : musicGenres;

    // remove if already selected
    if (cur.includes(value)) {
      const next = cur.filter((x) => x !== value);
      if (which === "music") setMusicGenres(next);
      else setSportsGenres(next);
      return;
    }

    // add only if under TOTAL cap
    const totalSelected = cur.length + other.length;
    if (totalSelected >= MAX_GENRES_TOTAL) {
      alert(`Max ${MAX_GENRES_TOTAL} total genres (Music + Sports).`);
      return;
    }

    const next = [...cur, value];
    if (which === "music") setMusicGenres(next);
    else setSportsGenres(next);
  }

  /* -------------------- Search navigation -------------------- */

  function onSearch() {
    if (!primaryId) {
      alert("Pick a Primary favorite (team or artist).");
      return;
    }
    if (primaryNoEvents) return;

    const { start: startNorm, end: endNorm } = normalizeDateRange(startDate, endDate);

    const params = new URLSearchParams();
    params.set("primaryId", primaryId);
    if (secondaryId) params.set("secondaryId", secondaryId);

    params.set("tripDays", String(tripDays));
    params.set("radiusMiles", String(radiusMilesForTripDays(tripDays)));
    params.set("countryCode", "US,CA");

    if (isYMD(startNorm)) params.set("start", startNorm);
    if (isYMD(endNorm)) params.set("end", endNorm);

    const musicClean = sanitizeGenreList(musicGenres, MUSIC_GENRES);
    const sportsClean = sanitizeGenreList(sportsGenres, SPORTS_GENRES);
    const clamped = clampTotalGenres(musicClean, sportsClean, MAX_GENRES_TOTAL);

    for (const g of clamped.music) params.append("musicGenres", g);
    for (const g of clamped.sports) params.append("sportsGenres", g);

    router.push(`/results?${params.toString()}`);
  }

  /* -------------------- Render -------------------- */

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Top brand bar */}
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-5 lg:max-w-3xl">
          <div className="flex items-center gap-3">
            <LogoMark />
            <div className="min-w-0">
              <div className="text-lg font-black tracking-tight text-slate-900 sm:text-xl">
                {APP_NAME}
              </div>
              <div className="text-xs text-slate-600 sm:text-sm">{TAGLINE}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Content column */}
      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-3xl lg:py-10">
        <div className="space-y-6">
          <Card title="Favorites" subtitle="Pick a Primary, and optionally a Secondary.">
            <div className="grid gap-4">
              <Combobox
                label="Primary*"
                optionsAll={combined}
                grouped={grouped}
                groups={groups}
                valueId={primaryId}
                setValueId={(v) => {
                  setPrimaryId(v);

                  if (!v) {
                    setPrimaryNoEvents(false);
                    abortAvailability("primary");
                    clearAvailabilityDebounce("primary");
                    return;
                  }

                  // If Primary changed to equal existing Secondary, clear Secondary
                  if (secondaryId && v === secondaryId) {
                    setSecondaryId("");
                    setSecondaryNoEvents(false);
                    abortAvailability("secondary");
                    clearAvailabilityDebounce("secondary");
                  }

                  // Debounced availability
                  ensureAvailability(v, "primary");
                }}
                help="We’ll build trip options around this schedule."
                disabled={loading}
              />

              {primaryId && primaryNoEvents ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
                  <span className="font-extrabold">
                    {labelForId(primaryId, combined) || "this selection"}
                  </span>{" "}
                  has no upcoming live events listed.
                </div>
              ) : null}

              <Combobox
                label="Secondary (optional)"
                optionsAll={combined}
                grouped={grouped}
                groups={groups}
                valueId={secondaryId}
                setValueId={(v) => {
                  if (!v) {
                    setSecondaryId("");
                    setSecondaryNoEvents(false);
                    abortAvailability("secondary");
                    clearAvailabilityDebounce("secondary");
                    return;
                  }

                  if (primaryId && v === primaryId) {
                    alert("Secondary must be different from Primary.");
                    return;
                  }

                  setSecondaryId(v);
                  setSecondaryNoEvents(false);

                  ensureAvailability(v, "secondary");
                }}
                help="We’ll look for nearby dates where both have events."
                disabled={loading}
              />

              {secondaryId && secondaryNoEvents ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
                  <span className="font-extrabold">
                    {labelForId(secondaryId, combined) || "this selection"}
                  </span>{" "}
                  has no upcoming live events listed.
                </div>
              ) : null}
            </div>
          </Card>

          <Card title="Trip Length & Dates" subtitle="Choose a window, optionally constrain by date.">
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-900">
                Length (select one)
              </div>
              <div className="grid grid-cols-3 gap-2">
                {TRIP_DAYS_OPTIONS.map((d) => {
                  const half = Math.floor(d / 2);
                  return (
                    <Pill
                      key={d}
                      label={`${d} days (±${half})`}
                      selected={tripDays === d}
                      onClick={() => setTripDays(d)}
                    />
                  );
                })}
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-slate-900">
                  Start Date <span className="text-slate-400">(optional)</span>
                </div>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 shadow-sm outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <div className="mt-2 text-xs text-slate-500">
                  Only trips starting after this date will be considered.
                </div>
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-semibold text-slate-900">
                  End Date <span className="text-slate-400">(optional)</span>
                </div>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 shadow-sm outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
                <div className="mt-2 text-xs text-slate-500">
                  Only trips ending before this date will be considered.
                </div>
              </label>
            </div>
          </Card>

          <Card
            title="Other Interests"
            subtitle={
              <>
                These help us suggest other events near your Primary.
                <br />
                <span>
                  <i>Select up to 4</i>
                </span>
              </>
            }
          >
            <div className="mt-2 grid gap-8 md:grid-cols-2">
              {/* SPORTS */}
              <div>
                <div className="mb-3 text-center text-base font-extrabold text-slate-900">
                  Sports
                </div>

                <div className="grid gap-2">
                  {(showAllSports ? SPORTS_GENRES : SPORTS_GENRES.slice(0, TOP_GENRE_COUNT)).map(
                    (g) => (
                      <Pill
                        key={g}
                        label={g}
                        selected={sportsGenres.includes(g)}
                        onClick={() => toggleGenreTotalCap("sports", g)}
                      />
                    )
                  )}
                </div>

                {SPORTS_GENRES.length > TOP_GENRE_COUNT ? (
                  <button
                    type="button"
                    onClick={() => setShowAllSports((v) => !v)}
                    className="mt-3 w-full rounded-2xl border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-800 shadow-sm transition hover:bg-slate-200 active:scale-[0.99]"
                  >
                    {showAllSports
                      ? "Show less"
                      : `Show more (${SPORTS_GENRES.length - TOP_GENRE_COUNT})`}
                  </button>
                ) : null}
              </div>

              {/* MUSIC */}
              <div>
                <div className="mb-3 text-center text-base font-extrabold text-slate-900">
                  Music
                </div>

                <div className="grid gap-2">
                  {(showAllMusic ? MUSIC_GENRES : MUSIC_GENRES.slice(0, TOP_GENRE_COUNT)).map(
                    (g) => (
                      <Pill
                        key={g}
                        label={g}
                        selected={musicGenres.includes(g)}
                        onClick={() => toggleGenreTotalCap("music", g)}
                      />
                    )
                  )}
                </div>

                {MUSIC_GENRES.length > TOP_GENRE_COUNT ? (
                  <button
                    type="button"
                    onClick={() => setShowAllMusic((v) => !v)}
                    className="mt-3 w-full rounded-2xl border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-800 shadow-sm transition hover:bg-slate-200 active:scale-[0.99]"
                  >
                    {showAllMusic
                      ? "Show less"
                      : `Show more (${MUSIC_GENRES.length - TOP_GENRE_COUNT})`}
                  </button>
                ) : null}
              </div>
            </div>
          </Card>

          {/* Primary CTA */}
          <div className="pt-1">
            <button
              type="button"
              onClick={onSearch}
              disabled={!canSearch || loading}
              title={
                !primaryId
                  ? "Pick a Primary favorite to enable Search."
                  : primaryNoEvents
                  ? "This Primary has no upcoming events listed."
                  : "Search"
              }
              className={[
                "h-12 w-full rounded-2xl px-5 text-sm font-extrabold shadow-sm transition",
                "focus:outline-none focus:ring-4 focus:ring-slate-200",
                searchPulse ? "animate-pulse" : "",
                canSearch && !loading
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "bg-slate-200 text-slate-500 cursor-not-allowed",
              ].join(" ")}
            >
              Find Trips
            </button>

            {loadError ? (
              <div className="mt-4 text-center text-xs font-semibold text-rose-700">
                {loadError}
              </div>
            ) : null}
          </div>

          <div className="pb-6 text-center text-xs text-slate-500">
            Tip: Install EventStack for the best mobile experience.
          </div>
        </div>
      </div>
    </main>
  );
}