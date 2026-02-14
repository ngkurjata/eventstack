// FILE: app/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AirportPicker, type Airport } from "./components/AirportPicker";

type CombinedOption = {
  id: string;
  label: string;
  group: string; // NHL/NBA/MLB/NFL/MLS/CFL/Artists
  kind: "team" | "artist";
  league?: string;
};

type MenuItem =
  | { type: "group"; group: string }
  | { type: "item"; group: string; option: CombinedOption };

const LS_KEY = "eventstack_search_v1";

// Public (no-email) mode presets. Keep the underlying logic flexible for future signed-in users.
const PUBLIC_MODE = true;
const PUBLIC_PRESET = {
  maxDays: 5,
  maxRadiusMiles: 200,
  maxSelections: 2,
} as const;

function safeParseInt(v: string | null, fallback: number) {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function clamp(n: number, min: number, max: number) {
  const nn = Number(n);
  if (!Number.isFinite(nn)) return min;
  return Math.min(max, Math.max(min, nn));
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
      // We will *not* render group headers anymore (redundant), but we keep this
      // structure in case you want to bring them back later.
      items.push({ type: "group", group });
      for (const option of matches) items.push({ type: "item", group, option });
    }
  }
  return items;
}

function cleanupLegacyLocalStorage() {
  // No-op for now.
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

function Combobox({
  label,
  required,
  optionsAll,
  grouped,
  groups,
  valueId,
  setValueId,
  help,
  disabled,
}: {
  label: string;
  required: boolean;
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

  // query drives filtering; inputValue is what user sees/edits
  const [query, setQuery] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  const selectedLabel = useMemo(() => labelForId(valueId, optionsAll), [valueId, optionsAll]);

  const menuItems = useMemo(() => {
    return buildGroupedListForQuery(query, grouped, groups);
  }, [query, grouped, groups]);

  // When selection changes or menu closes, reflect selected label in input.
  useEffect(() => {
    if (!open) {
      setInputValue(selectedLabel);
      setQuery("");
      setActiveIdx(-1);
    }
  }, [selectedLabel, open]);

  // If we become disabled, close menu and reset query/active.
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
      // Only allow opening the menu via keyboard if user has typed at least 1 character.
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

    // ✅ Tab commits highlighted option (if any) and lets the browser move focus naturally
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
        pos <= 0 ? selectableIndexes[selectableIndexes.length - 1] : selectableIndexes[pos - 1];
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
      {/* Header row: move "Required" here (right side), not as help text */}
      <div className="mb-2 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <div className="text-sm font-semibold text-slate-900">{label}</div>
        </div>

        <div className="flex items-center gap-3">
  {!required ? (
    <div className="text-xs font-semibold text-slate-500">(optional)</div>
  ) : null}

  {/* Keep help (if provided) */}
  {help ? <div className="hidden text-xs text-slate-500 sm:block">{help}</div> : null}
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
          placeholder={
            showLoading ? "Loading ..." : required ? "Type to search…" : "Type to search (or leave blank)…"
          }
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
                  // ✅ CHANGE 1: remove sticky group headers (NHL/NBA/ARTISTS etc.)
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

                      {/* keep the right-side league label (useful even without headers) */}
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

      {help ? <div className="mt-2 text-xs text-slate-500 sm:hidden">{help}</div> : null}
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  const sp = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [combined, setCombined] = useState<CombinedOption[]>([]);

  const [daysText, setDaysText] = useState<string>(String(PUBLIC_MODE ? PUBLIC_PRESET.maxDays : 3));
  const [radiusText, setRadiusText] = useState<string>(
    String(PUBLIC_MODE ? PUBLIC_PRESET.maxRadiusMiles : 100)
  );
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [p3, setP3] = useState("");

  const [airports, setAirports] = useState<Airport[]>([]);
  const [originIata, setOriginIata] = useState<string>("");
  const [originErr, setOriginErr] = useState<string>("");

  const didInitRef = useRef(false);

  const [searchPulse, setSearchPulse] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    fetch("/airports.min.json")
      .then((r) => r.json())
      .then((list: Airport[]) => {
        if (cancelled) return;
        setAirports(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (cancelled) return;
        setAirports([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { map: grouped, groups } = useMemo(() => groupOptions(combined), [combined]);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    cleanupLegacyLocalStorage();

    const qp1 = sp.get("p1") || "";
    const qp2 = sp.get("p2") || "";
    const qp3 = sp.get("p3") || "";
    const qDays = sp.get("days");
    const qRadius = sp.get("radiusMiles");
    const qOrigin = sp.get("origin") || "";

    const hasAnyUrlState = Boolean(qp1 || qp2 || qp3 || qDays || qRadius || qOrigin);

    const applyState = (next: {
      p1: string;
      p2: string;
      p3: string;
      days: number;
      radiusMiles: number;
      origin: string;
    }) => {
      const clamped = PUBLIC_MODE
        ? {
            ...next,
            p3: "",
            days: clamp(next.days, 1, PUBLIC_PRESET.maxDays),
            radiusMiles: clamp(next.radiusMiles, 1, PUBLIC_PRESET.maxRadiusMiles),
          }
        : next;

      setP1(clamped.p1);
      setP2(clamped.p2);
      setP3(clamped.p3);
      setDaysText(String(clamped.days));
      setRadiusText(String(clamped.radiusMiles));
      setOriginIata(clamped.origin.trim().toUpperCase());
    };

    if (hasAnyUrlState) {
      applyState({
        p1: qp1,
        p2: qp2,
        p3: qp3,
        days: safeParseInt(qDays, 3),
        radiusMiles: safeParseInt(qRadius, 100),
        origin: qOrigin,
      });
      return;
    }

    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);

      applyState({
        p1: String(parsed?.p1 || ""),
        p2: String(parsed?.p2 || ""),
        p3: String(parsed?.p3 || ""),
        days: Number.isFinite(Number(parsed?.days)) ? Number(parsed.days) : 3,
        radiusMiles: Number.isFinite(Number(parsed?.radiusMiles)) ? Number(parsed.radiusMiles) : 100,
        origin: String(parsed?.origin || ""),
      });
    } catch {
      // ignore
    }
  }, [sp]);

  useEffect(() => {
    if (!didInitRef.current) return;

    const effective = {
      p1,
      p2,
      p3: PUBLIC_MODE ? "" : p3,
      days: (() => {
        const parsed = safeParseInt(daysText, PUBLIC_MODE ? PUBLIC_PRESET.maxDays : 3);
        return PUBLIC_MODE ? clamp(parsed, 1, PUBLIC_PRESET.maxDays) : parsed;
      })(),
      radiusMiles: (() => {
        const parsed = safeParseInt(radiusText, PUBLIC_MODE ? PUBLIC_PRESET.maxRadiusMiles : 100);
        return PUBLIC_MODE ? clamp(parsed, 1, PUBLIC_PRESET.maxRadiusMiles) : clamp(parsed, 1, 2000);
      })(),
      origin: originIata,
    };

    try {
      localStorage.setItem(LS_KEY, JSON.stringify(effective));
    } catch {}

    const qs = new URLSearchParams();
    if (effective.p1) qs.set("p1", effective.p1);
    if (effective.p2) qs.set("p2", effective.p2);
    if (effective.p3) qs.set("p3", effective.p3);
    qs.set("days", String(effective.days));
    qs.set("radiusMiles", String(effective.radiusMiles));
    if (effective.origin) qs.set("origin", effective.origin);

    const next = qs.toString() ? `/?${qs.toString()}` : "/";
    window.history.replaceState(null, "", next);
  }, [p1, p2, p3, daysText, radiusText, originIata]);

  useEffect(() => {
    if (!PUBLIC_MODE) return;
    if (p3) setP3("");
  }, [p3]);

  const canSearch = Boolean(p1 && p2);
  const needsBothPicks = Boolean((p1 && !p2) || (!p1 && p2));

  useEffect(() => {
    if (!loading && canSearch) {
      setSearchPulse(true);
      const t = window.setTimeout(() => setSearchPulse(false), 900);
      return () => window.clearTimeout(t);
    }
  }, [loading, canSearch]);

  function onSearch() {
    if (!p1 || !p2) {
      alert("Pick at least Favorite Team/Artist #1 and #2.");
      return;
    }

    // Airport is optional; flights/buttons will be disabled on results if missing.
    if (!originIata) setOriginErr("");

    const parsedDays = safeParseInt(daysText, PUBLIC_MODE ? PUBLIC_PRESET.maxDays : 3);
    const effectiveDays = PUBLIC_MODE
      ? clamp(parsedDays, 1, PUBLIC_PRESET.maxDays)
      : clamp(parsedDays, 1, 30);
    const parsedRadius = safeParseInt(radiusText, PUBLIC_MODE ? PUBLIC_PRESET.maxRadiusMiles : 100);
    const effectiveRadius = PUBLIC_MODE
      ? clamp(parsedRadius, 1, PUBLIC_PRESET.maxRadiusMiles)
      : clamp(parsedRadius, 1, 2000);
    const effectiveP3 = PUBLIC_MODE ? "" : p3;

    const params = new URLSearchParams();
    params.set("p1", p1);
    params.set("p2", p2);
    if (effectiveP3) params.set("p3", effectiveP3);
    params.set("days", String(effectiveDays));
    params.set("radiusMiles", String(effectiveRadius));
    params.set("origin", originIata);

    router.push(`/results?${params.toString()}`);
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <header className="mb-8">
          <h1 className="text-center text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
            Plan an epic trip ...
          </h1>
          <p className="mt-7 text-center text-sm text-slate-600 sm:text-base">
            We help users find epic trip opportunities based on their favorite teams and artists.
          </p>
        </header>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <div className="text-lg font-extrabold text-slate-900">Pick 2 of your favorites</div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Combobox
                label="Favorite Team/Artist #1"
                required
                optionsAll={combined}
                grouped={grouped}
                groups={groups}
                valueId={p1}
                setValueId={setP1}
                // no longer used for "Required" (we show Required in the header row)
                help={undefined}
                disabled={loading}
              />
              <Combobox
                label="Favorite Team/Artist #2"
                required
                optionsAll={combined}
                grouped={grouped}
                groups={groups}
                valueId={p2}
                setValueId={setP2}
                help={undefined}
                disabled={loading}
              />
            </div>

            {!PUBLIC_MODE && (
              <div className="mt-4">
                <Combobox
                  label="Favorite Team/Artist #3"
                  required={false}
                  optionsAll={combined}
                  grouped={grouped}
                  groups={groups}
                  valueId={p3}
                  setValueId={setP3}
                  help="Nice-to-have"
                />
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="text-lg font-extrabold text-slate-900">Trip constraints</div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <div className="mb-2 text-sm font-semibold text-slate-900">Max trip length (# of Days)</div>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 shadow-sm outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={daysText}
                  onFocus={(e) => {
                    const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement | null;
                    requestAnimationFrame(() => el?.select());
                  }}
                  onChange={(e) => {
                    const next = e.target.value;

                    if (next === "") {
                      setDaysText("");
                      return;
                    }

                    if (/^\d+$/.test(next)) {
                      setDaysText(next);
                    }
                  }}
                  onBlur={() => {
                    const parsed = safeParseInt(daysText, PUBLIC_MODE ? PUBLIC_PRESET.maxDays : 3);
                    const clamped = PUBLIC_MODE ? clamp(parsed, 1, PUBLIC_PRESET.maxDays) : clamp(parsed, 1, 30);
                    setDaysText(String(clamped));
                  }}
                />
                <div className="mt-2 text-xs text-slate-500">
                  {PUBLIC_MODE
                    ? `Cannot be greater than ${PUBLIC_PRESET.maxDays} days.`
                    : "Example: “2” means events within a 2-day window."}
                </div>
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-semibold text-slate-900">
                  Max distance between events (# of Miles)
                </div>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 shadow-sm outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={radiusText}
                  onFocus={(e) => {
                    const el = e.currentTarget as HTMLInputElement | HTMLTextAreaElement | null;
                    requestAnimationFrame(() => el?.select());
                  }}
                  onChange={(e) => {
                    const next = e.target.value;

                    if (next === "") {
                      setRadiusText("");
                      return;
                    }

                    if (/^\d+$/.test(next)) {
                      setRadiusText(next);
                    }
                  }}
                  onBlur={() => {
                    const parsed = safeParseInt(radiusText, PUBLIC_MODE ? PUBLIC_PRESET.maxRadiusMiles : 100);
                    const clamped = PUBLIC_MODE
                      ? clamp(parsed, 1, PUBLIC_PRESET.maxRadiusMiles)
                      : clamp(parsed, 1, 2000);
                    setRadiusText(String(clamped));
                  }}
                />
                <div className="mt-2 text-xs text-slate-500">
                  {PUBLIC_MODE
                    ? `Cannot be greater than ${PUBLIC_PRESET.maxRadiusMiles} miles.`
                    : "How far you’re willing to travel between events."}
                </div>
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <AirportPicker
              airports={airports}
              valueIata={originIata}
              onPick={(iata) => {
                setOriginErr("");
                setOriginIata(iata);
              }}
            />
            {originErr ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900">
                {originErr}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={onSearch}
              disabled={!canSearch || loading}
              title={
                needsBothPicks
                  ? "Both Favorite #1 and Favorite #2 are required before Search will work."
                  : !canSearch
                  ? "Pick Favorite #1 and Favorite #2 to enable Search."
                  : "Search for overlap occurrences"
              }
              className={[
                "rounded-2xl px-5 py-3 text-sm font-extrabold shadow-sm transition",
                searchPulse ? "animate-pulse" : "",
                canSearch && !loading
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "bg-slate-200 text-slate-500 cursor-not-allowed",
              ].join(" ")}
            >
              Search
            </button>
          </div>
        </div>

        <footer className="mt-7 text-center text-sm text-slate-600 sm:text-base">
          The next page will show you when and where your favorites cross paths (if at all).
        </footer>

        {loadError ? (
          <div className="mt-6 text-center text-xs text-rose-700">{loadError}</div>
        ) : null}
      </div>
    </main>
  );
}
