"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadSession, saveSession } from "@/lib/home/persist";

type Mode = "area" | "favorites";

/* -------------------- utils -------------------- */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function ymdFromLocalDate(dt: Date) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysLocal(ymd: string, days: number) {
  if (!isYMD(ymd)) return "";
  const [yy, mm, dd] = ymd.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(yy, mm - 1, dd);
  dt.setDate(dt.getDate() + days);
  return ymdFromLocalDate(dt);
}

function tomorrowYMD() {
  const dt = new Date();
  dt.setDate(dt.getDate() + 1);
  return ymdFromLocalDate(dt);
}

function norm(s: any) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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

/* -------------------- data shapes -------------------- */

type CityOpt = {
  id?: string;
  label: string;
  lat: number;
  lon: number;
  country?: string;
  airportIata?: string;
};

type FavoriteOption = {
  key: string;
  label: string;
  kind: "team" | "artist";
  rawName: string;
  attractionId?: string;
  defaultGenre?: string;
  league?: string;
};

type ResolveFavoriteResponse = {
  ok: boolean;
  q: string;
  items: FavoriteOption[];
  error?: string;
};

/* -------------------- lightweight combobox -------------------- */

function ComboBox<T extends { label: string }>(props: {
  label: string;
  value: string;
  placeholder?: string;
  options: T[];
  onChange: (next: string) => void;
  onPick: (opt: T) => void;
  disabled?: boolean;
  rightHint?: string;
  renderOption?: (opt: T, active: boolean) => React.ReactNode;
}) {
  const { label, value, placeholder, options, onChange, onPick, disabled, rightHint, renderOption } = props;
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
    <div ref={wrapRef} className="overflow-visible">
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
          "mt-1 h-11 w-full rounded-2xl border bg-white px-4 text-sm font-semibold text-slate-900 outline-none",
          "border-slate-200 focus:border-slate-400",
          disabled && "cursor-not-allowed bg-slate-100 text-slate-500"
        )}
      />

      {showList && (
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white">
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
            <div
              ref={listRef}
              className="max-h-96 overflow-y-auto overscroll-contain py-1"
            >
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
    <span className="relative inline-flex w-full align-middle">
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
          "inline-flex h-11 w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none",
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

/* -------------------- persisted state -------------------- */

type AreaState = {
  cityLabel: string;
  lat: string;
  lon: string;
  startDate: string;
  endDate: string;
  endTouched: boolean;
  radiusMiles: number;
};

type FavState = {
  f1Label: string;
  f1Kind: "" | "team" | "artist";
  f1AttractionId: string;
  f1DefaultGenre: string;
};

const KEY_MODE = "eventstack_home_mode_v2";
const KEY_AREA = "eventstack_home_area_v2";
const KEY_FAV = "eventstack_home_fav_v2";

const DEFAULT_AREA: AreaState = {
  cityLabel: "",
  lat: "",
  lon: "",
  startDate: "",
  endDate: "",
  endTouched: false,
  radiusMiles: 90,
};

const DEFAULT_FAV: FavState = {
  f1Label: "",
  f1Kind: "",
  f1AttractionId: "",
  f1DefaultGenre: "",
};

/* -------------------- page -------------------- */

export default function HomePage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("area");
  const [openPanel, setOpenPanel] = useState<Mode | null>("area");
  const [area, setArea] = useState<AreaState>(DEFAULT_AREA);
  const [fav, setFav] = useState<FavState>(DEFAULT_FAV);
  const [hasLoadedSession, setHasLoadedSession] = useState(false);

  const [cities, setCities] = useState<CityOpt[]>([]);

  const [favoriteOptions, setFavoriteOptions] = useState<FavoriteOption[]>([]);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string>("");

  useEffect(() => {
    const m = loadSession<Mode>(KEY_MODE, "area");
    const nextArea = loadSession<AreaState>(KEY_AREA, DEFAULT_AREA);
    const nextFav = loadSession<FavState>(KEY_FAV, DEFAULT_FAV);

    if (m === "area" || m === "favorites") {
      setMode(m);
      setOpenPanel(m);
    }

    setArea({
      ...DEFAULT_AREA,
      ...nextArea,
    });

    setFav({
      ...DEFAULT_FAV,
      ...nextFav,
    });

    setHasLoadedSession(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedSession) return;
    saveSession(KEY_MODE, mode);
  }, [mode, hasLoadedSession]);

  useEffect(() => {
    if (!hasLoadedSession) return;
    saveSession(KEY_AREA, area);
  }, [area, hasLoadedSession]);

  useEffect(() => {
    if (!hasLoadedSession) return;
    saveSession(KEY_FAV, fav);
  }, [fav, hasLoadedSession]);

  useEffect(() => {
    let cancelled = false;

    async function loadCities() {
      try {
        const citiesJ = await fetch("/cities.json", { cache: "force-cache" }).then((r) =>
          r.ok ? r.json() : []
        );

        if (cancelled) return;

        const cityList: CityOpt[] = (Array.isArray(citiesJ) ? (citiesJ as any[]) : [])
          .map((x: any) => {
            const label = String(x?.label ?? "").trim();
            const lat = Number(x?.lat);
            const lon = Number(x?.lon);
            if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

            return {
              id: x?.id ? String(x.id) : undefined,
              label,
              lat,
              lon,
              country: x?.country ? String(x.country) : undefined,
              airportIata: x?.airportIata ? String(x.airportIata) : undefined,
            } as CityOpt;
          })
          .filter(Boolean) as CityOpt[];

        setCities(cityList);
      } catch {
        if (!cancelled) setCities([]);
      }
    }

    loadCities();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!area.startDate) {
      const t = tomorrowYMD();
      setArea((s) => ({
        ...s,
        startDate: t,
        endDate: s.endTouched ? s.endDate : addDaysLocal(t, 13),
      }));
      return;
    }

    if (isYMD(area.startDate) && !area.endTouched) {
      const autoEnd = addDaysLocal(area.startDate, 13);
      if (autoEnd && autoEnd !== area.endDate) {
        setArea((s) => ({
          ...s,
          endDate: autoEnd,
        }));
      }
    }
  }, [area.startDate, area.endDate, area.endTouched]);

  useEffect(() => {
    const clamped = clamp(Number(area.radiusMiles) || 90, 10, 120);
    if (clamped !== area.radiusMiles) {
      setArea((s) => ({
        ...s,
        radiusMiles: clamped,
      }));
    }
  }, [area.radiusMiles]);

  useEffect(() => {
    if (mode !== "favorites") return;

    const q = fav.f1Label.trim();

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

        setFavoriteOptions(Array.isArray(data.items) ? data.items : []);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
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
  }, [fav.f1Label, mode]);

  function onSearchArea() {
    const latN = Number(area.lat);
    const lonN = Number(area.lon);

    if (!area.cityLabel.trim() || !Number.isFinite(latN) || !Number.isFinite(lonN)) {
      alert("Area search requires City selection (label + lat + lon).");
      return;
    }

    if (!isYMD(area.startDate) || !isYMD(area.endDate)) {
      alert("Area search requires Start and End (YYYY-MM-DD).");
      return;
    }

    const maxEnd = addDaysLocal(area.startDate, 13);
    if (maxEnd && isYMD(maxEnd) && area.endDate > maxEnd) {
      alert("Trip Length Cannot Exceed 14 Days.");
      return;
    }

    const pickedCity =
      cities.find((c) => String(c.label || "").trim() === area.cityLabel.trim()) ||
      cities.find((c) => String(c.lat) === String(latN) && String(c.lon) === String(lonN));

    const airportIata = String(pickedCity?.airportIata || "")
      .trim()
      .toUpperCase();

    const url =
      `/results/area?` +
      new URLSearchParams({
        cityLabel: area.cityLabel.trim(),
        lat: String(latN),
        lon: String(lonN),
        airportIata,
        start: area.startDate,
        end: area.endDate,
        radiusMiles: String(clamp(area.radiusMiles, 10, 120)),
        countryCode: "US,CA",
      }).toString();

    router.push(url);
  }

  function onSearchFavorites() {
    if (!fav.f1Label.trim() || !fav.f1AttractionId.trim()) {
      alert("Favorites search requires selecting a valid favorite.");
      return;
    }

    const params: Record<string, string> = {
      countryCode: "US,CA",
      f1Label: fav.f1Label.trim(),
      f1AttractionId: fav.f1AttractionId.trim(),
    };

    if (fav.f1DefaultGenre.trim()) {
      params.f1DefaultGenre = fav.f1DefaultGenre.trim();
    }

    if (fav.f1Kind.trim()) {
      params.f1Kind = fav.f1Kind.trim();
    }

    router.push(`/results/favorites?${new URLSearchParams(params).toString()}`);
  }

  function togglePanel(next: Mode) {
    if (openPanel === next) {
      setOpenPanel(null);
      return;
    }
    setMode(next);
    setOpenPanel(next);
  }

  function favoriteSubLabel(opt: FavoriteOption) {
    const parts =
      opt.kind === "team"
        ? [String(opt.defaultGenre || "").trim(), String(opt.league || "").trim()]
        : [String(opt.defaultGenre || "").trim()];

    return parts.filter(Boolean).join(" • ");
  }

  const favoriteHint = favoriteLoading ? "Searching..." : favoriteError ? favoriteError : "";

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-4xl lg:py-10">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
            Plan and build trips around live sports and concerts.
          </h1>
        </div>

        <div className="space-y-4">
          <section className="overflow-visible rounded-3xl border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => togglePanel("area")}
              className={cx(
                "w-full px-5 py-4 text-left transition sm:px-7",
                openPanel === "area" ? "bg-slate-900 text-white" : "bg-white text-slate-900 hover:bg-slate-50"
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-black">by City</div>
                  <div className={cx("mt-1 text-xs", openPanel === "area" ? "text-slate-300" : "text-slate-600")}>
                  </div>
                </div>
                <div className="text-2xl font-light leading-none">{openPanel === "area" ? "−" : "+"}</div>
              </div>
            </button>

            <div
              className={cx(
                "grid transition-all duration-500 ease-in-out",
                openPanel === "area" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              )}
            >
              <div className="overflow-hidden">
                <div className="border-t border-slate-200 p-5 sm:p-7">
                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <ComboBox<CityOpt>
                      label="City"
                      value={area.cityLabel}
                      placeholder="Type a city…"
                      options={cities}
                      onChange={(v) =>
                        setArea((s) => ({
                          ...s,
                          cityLabel: v,
                          lat: "",
                          lon: "",
                        }))
                      }
                      onPick={(opt) =>
                        setArea((s) => ({
                          ...s,
                          cityLabel: opt.label,
                          lat: String(opt.lat),
                          lon: String(opt.lon),
                        }))
                      }
                    />

                    <div>
                      <div className="text-xs font-semibold text-slate-700">Start Date</div>
                      <div className="mt-1">
                        <DatePickerButton
                          value={area.startDate}
                          min={tomorrowYMD()}
                          placeholder="Select date"
                          onChange={(next) =>
                            setArea((s) => ({
                              ...s,
                              startDate: next,
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-700">End Date</div>
                      <div className="mt-1">
                        <DatePickerButton
                          value={area.endDate}
                          min={area.startDate && isYMD(area.startDate) ? area.startDate : undefined}
                          placeholder="Select date"
                          onChange={(next) =>
                            setArea((s) => ({
                              ...s,
                              endDate: next,
                              endTouched: true,
                            }))
                          }
                        />
                      </div>
                      {!area.endTouched && isYMD(area.startDate) ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Cannot be more than 14 days from start date.
                        </div>
                      ) : null}
                    </div>

                    <input type="hidden" value={area.radiusMiles} readOnly />
                  </div>

                  <div className="mt-6 flex justify-center">
                    <button
                      type="button"
                      onClick={onSearchArea}
                      className="h-11 rounded-2xl bg-slate-900 px-8 text-sm font-extrabold text-white hover:bg-slate-800"
                    >
                      Search
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-visible rounded-3xl border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => togglePanel("favorites")}
              className={cx(
                "w-full px-5 py-4 text-left transition sm:px-7",
                openPanel === "favorites" ? "bg-slate-900 text-white" : "bg-white text-slate-900 hover:bg-slate-50"
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-black">by Favorite Team or Band</div>
                  <div
                    className={cx("mt-1 text-xs", openPanel === "favorites" ? "text-slate-300" : "text-slate-600")}
                  >
                  </div>
                </div>
                <div className="text-2xl font-light leading-none">{openPanel === "favorites" ? "−" : "+"}</div>
              </div>
            </button>

            <div
              className={cx(
                "grid transition-all duration-500 ease-in-out",
                openPanel === "favorites" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              )}
            >
              <div className="overflow-hidden">
                <div className="border-t border-slate-200 p-5 sm:p-7">
                  <div className="grid gap-5">
                    <ComboBox<FavoriteOption>
                      label="Favorite Team or Band"
                      value={fav.f1Label}
                      placeholder="Type a team or artist…"
                      options={favoriteOptions}
                      rightHint={favoriteHint}
                      renderOption={(opt, active) => {
                        const sub = favoriteSubLabel(opt);
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
                      }}
                      onChange={(v) =>
                        setFav((s) => ({
                          ...s,
                          f1Label: v,
                          f1Kind: "",
                          f1AttractionId: "",
                          f1DefaultGenre: "",
                        }))
                      }
                      onPick={(opt) =>
                        setFav((s) => ({
                          ...s,
                          f1Label: opt.rawName,
                          f1Kind: opt.kind,
                          f1AttractionId: String(opt.attractionId || "").trim(),
                          f1DefaultGenre: String(opt.defaultGenre || "").trim(),
                        }))
                      }
                    />

                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={onSearchFavorites}
                        className="h-11 rounded-2xl bg-slate-900 px-8 text-sm font-extrabold text-white hover:bg-slate-800"
                      >
                        Search
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}