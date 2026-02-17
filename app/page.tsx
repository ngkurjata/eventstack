// FILE: app/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type CombinedOption = {
  id: string;
  label: string;
  group: string; // NHL/NBA/MLB/NFL/MLS/CFL/Artists
  kind: "team" | "artist";
  league?: string;

  // Optional: if your /api/options provides one of these, we'll use it.
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

/* Trip-length presets per your new model */
const TRIP_DAYS_OPTIONS: Array<3 | 5 | 7> = [3, 5, 7];

/* Genre lists (UI buttons) */
const MUSIC_GENRES = [
    "Comedy",
  "Rock",
  "Pop",
  "Country",
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
  "Basketball",
  "Baseball",
  "Hockey",
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
          const hit = Array.from(allowedSet).find((a) => s.toLowerCase().includes(a.toLowerCase()));
          return hit || "";
        })
        .filter(Boolean)
    )
  );
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
    const matches = opts.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 25);

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

function useOutsideClick<T extends HTMLElement>(ref: React.RefObject<T | null>, onOutside: () => void) {
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

  const selectedLabel = useMemo(() => labelForId(valueId, optionsAll), [valueId, optionsAll]);
  const menuItems = useMemo(() => buildGroupedListForQuery(query, grouped, groups), [query, grouped, groups]);

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
      const prev = pos <= 0 ? selectableIndexes[selectableIndexes.length - 1] : selectableIndexes[pos - 1];
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
            "w-full rounded-xl border px-4 py-3 text-[15px] shadow-sm outline-none",
            "transition-all duration-300",
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
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
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
                        isActive ? "bg-slate-900 text-white" : "bg-white text-slate-900 hover:bg-slate-50",
                      ].join(" ")}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(it.option.id);
                      }}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-extrabold leading-tight">{it.option.label}</div>
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

function Pill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
  "w-full rounded-2xl px-3 py-2 text-xs font-extrabold transition border text-center",
  selected ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
].join(" ")}

    >
      {label}
    </button>
  );
}

/* -------------------- Ticketmaster attractionId extraction -------------------- */

function attractionIdFromOption(opt: CombinedOption | undefined | null): string {
  if (!opt) return "";

  // Prefer explicit field
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
  // Keep in sync with /api/search route.js defaulting:
  // <=3 => 60, <=5 => 120, else => 180
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

  const didInitRef = useRef(false);
  const [searchPulse, setSearchPulse] = useState(false);

  // Keyed by Ticketmaster attractionId
  const [availabilityByKey, setAvailabilityByKey] = useState<Record<string, AvailabilityRecord>>({});
  const [primaryNoEvents, setPrimaryNoEvents] = useState(false);

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

  async function ensureAvailability(optionId: string, slot: "primary" | "secondary") {
    if (!optionId) {
      if (slot === "primary") setPrimaryNoEvents(false);
      return;
    }

    const opt = optionById(optionId);
    const tmAttractionId = attractionIdFromOption(opt);

    // If we can't extract an attractionId, fail open (no warning, no block)
    if (!tmAttractionId) {
      if (slot === "primary") setPrimaryNoEvents(false);
      return;
    }

    // Session cache
    const cached = availabilityByKey[tmAttractionId];
    if (cached) {
      if (slot === "primary") setPrimaryNoEvents(!cached.hasUpcomingEvents);
      if (slot === "secondary" && !cached.hasUpcomingEvents) setSecondaryId("");
      return;
    }

    try {
      const res = await fetch(`/api/availability?id=${encodeURIComponent(tmAttractionId)}`, { cache: "no-store" });
      const data = await res.json();

      const rec = (data && data[tmAttractionId]) as AvailabilityRecord | undefined;

      // If API didn't return our key, fail open (do NOT cache as truth)
      if (!rec) {
        if (slot === "primary") setPrimaryNoEvents(false);
        return;
      }

      const normalized: AvailabilityRecord = {
        hasUpcomingEvents: !!rec.hasUpcomingEvents,
        nextEventDate: rec.nextEventDate ?? null,
        checkedAt: rec.checkedAt ?? new Date().toISOString(),
        warning: rec.warning,
      };

      setAvailabilityByKey((prev) => ({ ...prev, [tmAttractionId]: normalized }));

      if (slot === "primary") setPrimaryNoEvents(!normalized.hasUpcomingEvents);
      if (slot === "secondary" && !normalized.hasUpcomingEvents) setSecondaryId("");
    } catch {
      if (slot === "primary") setPrimaryNoEvents(false);
    }
  }

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
  setMusicGenres(next.musicGenres);
  setSportsGenres(next.sportsGenres);
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
  musicGenres: sanitizeGenreList(Array.isArray(parsed?.musicGenres) ? parsed.musicGenres : [], MUSIC_GENRES),
  sportsGenres: sanitizeGenreList(Array.isArray(parsed?.sportsGenres) ? parsed.sportsGenres : [], SPORTS_GENRES),
});

    } catch {
      // ignore
    }
  }, [sp]);

  useEffect(() => {
    if (!didInitRef.current) return;

    const { start: startNorm, end: endNorm } = normalizeDateRange(startDate, endDate);

    const musicGenresClean = sanitizeGenreList(musicGenres, MUSIC_GENRES);
    const sportsGenresClean = sanitizeGenreList(sportsGenres, SPORTS_GENRES);

    const effective = {
      primaryId,
      secondaryId,
      tripDays,
      start: isYMD(startNorm) ? startNorm : "",
      end: isYMD(endNorm) ? endNorm : "",
      musicGenres: musicGenresClean,
      sportsGenres: sportsGenresClean,
    };

    try {
      localStorage.setItem(LS_KEY, JSON.stringify(effective));
    } catch {}

    const qs = new URLSearchParams();
    if (effective.primaryId) qs.set("primaryId", effective.primaryId);
    if (effective.secondaryId) qs.set("secondaryId", effective.secondaryId);
    qs.set("tripDays", String(effective.tripDays));
    if (effective.start) qs.set("start", effective.start);
    if (effective.end) qs.set("end", effective.end);
    for (const g of effective.musicGenres) qs.append("musicGenres", g);
    for (const g of effective.sportsGenres) qs.append("sportsGenres", g);

    const next = qs.toString() ? `/?${qs.toString()}` : "/";
    window.history.replaceState(null, "", next);
}, [primaryId, secondaryId, tripDays, startDate, endDate, musicGenres, sportsGenres]);

  const canSearch = Boolean(primaryId) && !primaryNoEvents;

  useEffect(() => {
    if (!loading && canSearch) {
      setSearchPulse(true);
      const t = window.setTimeout(() => setSearchPulse(false), 900);
      return () => window.clearTimeout(t);
    }
  }, [loading, canSearch]);

  function toggleList(setter: (next: string[]) => void, cur: string[], value: string) {
    setter(cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]);
  }

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
    if (isYMD(startNorm)) params.set("start", startNorm);
    if (isYMD(endNorm)) params.set("end", endNorm);
    for (const g of sanitizeGenreList(musicGenres, MUSIC_GENRES)) params.append("musicGenres", g);
    for (const g of sanitizeGenreList(sportsGenres, SPORTS_GENRES)) params.append("sportsGenres", g);

    router.push(`/results?${params.toString()}`);
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <header className="mb-8">
          <h1 className="text-center text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Find an epic trip!</h1>
          <p className="mt-7 text-center text-sm text-slate-600 sm:text-lg">
            We help users find and book epic trips built around live events featuring their favorite sports teams and/or musical artists.
          </p>
        </header>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4">
  <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 text-center">
    Favorites
  </div>
</div>


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
                    return;
                  }
                  if (secondaryId && v === secondaryId) setSecondaryId("");
                  ensureAvailability(v, "primary");
                }}
                help="We'll show you trip options based on their schedule."
                disabled={loading}
              />
{primaryId && primaryNoEvents ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
                {" "}
                <span className="font-extrabold">{labelForId(primaryId, combined) || "this selection"}</span> have no live events scheduled.
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
                    return;
                  }
                  if (primaryId && v === primaryId) {
                    setSecondaryId("");
                    return;
                  }
                  setSecondaryId(v);
                  ensureAvailability(v, "secondary");
                }}
                help="If such an opportunity exists, we'll show you when and where your Secondary has an event near your Primary."
                disabled={loading}
              />
            </div>

            

                      </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 text-center">Trip Length & Dates</div>

            <div className="mt-4">
              <div className="mb-2 text-sm font-semibold text-slate-900">Length (select one)</div>
              <div className="grid grid-cols-3 gap-2">
  {TRIP_DAYS_OPTIONS.map((d) => {
  const half = Math.floor(d / 2); // 3=>1, 5=>2, 7=>3
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

              <div className="mt-2" />
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-slate-900">Start Date (optional)</div>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 shadow-sm outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <div className="mt-2 text-center text-xs text-slate-500">Only trips starting after this date will be considered.</div>
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-semibold text-slate-900">End Date (optional)</div>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 shadow-sm outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
                <div className="mt-2 text-center text-xs text-slate-500">Only trips ending before this date will be considered.</div>
              </label>
            </div>
          </div>

<div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
<div className="text-2xl sm:text-3xl font-extrabold text-slate-900 text-center">
    Other Interests
  </div>

  <div className="mt-2 text-xs text-slate-500 text-center">
    These help us find other events near your Primary that might be of interest to you.
  </div>

  <div className="mt-6 grid gap-8 md:grid-cols-2">
    {/* Sports column */}
    <div>
      <div className="mb-3 text-center text-base font-extrabold text-slate-900">Sports</div>
      <div className="grid gap-2">
        {SPORTS_GENRES.map((g) => (
          <Pill
            key={g}
            label={g}
            selected={sportsGenres.includes(g)}
            onClick={() => toggleList(setSportsGenres, sportsGenres, g)}
          />
        ))}
      </div>
    </div>

    {/* Music column */}
    <div>
      <div className="mb-3 text-center text-base font-extrabold text-slate-900">Music</div>
      <div className="grid gap-2">
        {MUSIC_GENRES.map((g) => (
          <Pill
            key={g}
            label={g}
            selected={musicGenres.includes(g)}
            onClick={() => toggleList(setMusicGenres, musicGenres, g)}
          />
        ))}
      </div>
    </div>
  </div>
</div>
        
          <div className="flex items-center justify-center">
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
                "rounded-2xl px-5 py-3 text-sm font-extrabold shadow-sm transition",
                searchPulse ? "animate-pulse" : "",
                canSearch && !loading ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed",
              ].join(" ")}
            >
              Search
            </button>
          </div>
        </div>

        {loadError ? <div className="mt-6 text-center text-xs text-rose-700">{loadError}</div> : null}
      </div>
    </main>
  );
}
