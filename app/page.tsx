"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadSession, saveSession } from "@/lib/home/persist";
import GroupedComboBox from "@/app/components/GroupedComboBox";
import { buildHomeFavoriteRows } from "@/lib/filters/groupedCombobox";
import { type FavoriteKind } from "@/lib/favorites/options";
import { RESOLVED_FAVORITE_OPTIONS } from "@/lib/favorites/resolvedOptions";
import DateField from "@/app/components/date/DateField";
import { addDaysLocal, isYMD, tomorrowYMD } from "@/lib/date/ymd";

type Mode = "area" | "favorites";

/* -------------------- utils -------------------- */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function norm(s: unknown) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
  const {
    label,
    value,
    placeholder,
    options,
    onChange,
    onPick,
    disabled,
    rightHint,
    renderOption,
  } = props;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = norm(value);
    const base = options || [];

    if (!q) return base.slice(0, 20);

    const starts = base.filter((o) => norm(o.label).startsWith(q));
    const contains = base.filter(
      (o) => !norm(o.label).startsWith(q) && norm(o.label).includes(q)
    );

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
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-option-idx="${active}"]`
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const showList = open && !disabled && value.trim().length > 0;

  return (
    <div ref={wrapRef} className="relative z-20 overflow-visible">
      <div className="flex items-end justify-between">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        {rightHint ? (
          <div className="text-[11px] text-slate-500">{rightHint}</div>
        ) : null}
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
        <div className="absolute left-0 right-0 top-full z-[70] mt-2 rounded-2xl border border-slate-200 bg-white shadow-lg">
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
                      isActive
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-900 hover:bg-slate-50"
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
  f1Kind: "" | FavoriteKind;
  f1AttractionId: string;
  f1SeriesKey: string;
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
  f1SeriesKey: "",
  f1DefaultGenre: "",
};

/* -------------------- page -------------------- */

export default function HomePage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("area");
  const [openPanel, setOpenPanel] = useState<Mode | null>(null);
  const [area, setArea] = useState<AreaState>(DEFAULT_AREA);
  const [fav, setFav] = useState<FavState>(DEFAULT_FAV);
  const [hasLoadedSession, setHasLoadedSession] = useState(false);

  const [cities, setCities] = useState<CityOpt[]>([]);

  const favoriteRows = useMemo(
    () => buildHomeFavoriteRows(RESOLVED_FAVORITE_OPTIONS),
    []
  );

  const hasPickedCity =
    !!String(area.cityLabel).trim() &&
    !!String(area.lat).trim() &&
    !!String(area.lon).trim() &&
    Number.isFinite(Number(area.lat)) &&
    Number.isFinite(Number(area.lon));

  const canSearchArea =
    hasPickedCity && isYMD(area.startDate) && isYMD(area.endDate);

  const canSearchFavorites =
    !!fav.f1Label.trim() &&
    (!!fav.f1AttractionId.trim() || !!fav.f1SeriesKey.trim());

  useEffect(() => {
    const m = loadSession<Mode>(KEY_MODE, "area");
    const nextArea = loadSession<AreaState>(KEY_AREA, DEFAULT_AREA);
    const nextFav = loadSession<FavState>(KEY_FAV, DEFAULT_FAV);

    if (m === "area" || m === "favorites") {
      setMode(m);
    }

    setArea({
      ...DEFAULT_AREA,
      ...nextArea,
    });

    setFav({
      ...DEFAULT_FAV,
      ...nextFav,
    });

    setOpenPanel(null);
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
        const citiesJ = await fetch("/cities.json", { cache: "force-cache" }).then(
          (r) => (r.ok ? r.json() : [])
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
    if (!hasLoadedSession) return;

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
  }, [hasLoadedSession, area.startDate, area.endDate, area.endTouched]);

  useEffect(() => {
    if (!isYMD(area.startDate)) return;
    if (!isYMD(area.endDate)) return;

    const minEnd = area.startDate;
    const maxEnd = addDaysLocal(area.startDate, 13);

    if (area.endDate < minEnd || area.endDate > maxEnd) {
      setArea((s) => ({
        ...s,
        endDate: "",
        endTouched: false,
      }));
    }
  }, [area.startDate, area.endDate]);

  useEffect(() => {
    const clamped = clamp(Number(area.radiusMiles) || 90, 10, 120);
    if (clamped !== area.radiusMiles) {
      setArea((s) => ({
        ...s,
        radiusMiles: clamped,
      }));
    }
  }, [area.radiusMiles]);

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
    const label = fav.f1Label.trim();
    const attractionId = fav.f1AttractionId.trim();
    const seriesKey = fav.f1SeriesKey.trim();
    const kind = fav.f1Kind.trim();

    if (!label || (!attractionId && !seriesKey)) {
      alert("Favorites search requires selecting a valid favorite.");
      return;
    }

    const params: Record<string, string> = {
      countryCode: "US,CA",
      f1Label: label,
    };

    if (attractionId) {
      params.f1AttractionId = attractionId;
    }

    if (seriesKey) {
      params.f1SeriesKey = seriesKey;
    }

    if (fav.f1DefaultGenre.trim()) {
      params.f1DefaultGenre = fav.f1DefaultGenre.trim();
    }

    if (kind) {
      params.f1Kind = kind;
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

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-4xl lg:py-10">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
            Plan and build trips around live sports and concerts.
          </h1>
        </div>

        <div className="space-y-4">
          <section
            className={cx(
              "relative overflow-visible rounded-3xl border border-slate-200 bg-white shadow-sm",
              openPanel === "area" ? "z-30" : "z-10"
            )}
          >
            <button
              type="button"
              onClick={() => togglePanel("area")}
              className={cx(
                "w-full px-5 py-4 text-left transition sm:px-7",
                openPanel === "area"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-900 hover:bg-slate-50"
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-black">by City</div>
                  <div
                    className={cx(
                      "mt-1 text-xs",
                      openPanel === "area" ? "text-slate-300" : "text-slate-600"
                    )}
                  />
                </div>
                <div className="text-2xl font-light leading-none">
                  {openPanel === "area" ? "−" : "+"}
                </div>
              </div>
            </button>

            <div
              className={cx(
                "grid transition-all duration-500 ease-in-out",
                openPanel === "area"
                  ? "grid-rows-[1fr] opacity-100 pointer-events-auto"
                  : "grid-rows-[0fr] opacity-0 pointer-events-none"
              )}
              aria-hidden={openPanel !== "area"}
            >
              <div className="min-h-0 overflow-visible">
                <div className="overflow-visible border-t border-slate-200 p-5 sm:p-7">
                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <div className="relative z-40">
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
                    </div>

                    <div className="relative z-30">
                      <div className="text-xs font-semibold text-slate-700">Start Date</div>
                      <div className="mt-1">
                        <DateField
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

                    <div className="relative z-10">
                      <div className="text-xs font-semibold text-slate-700">End Date</div>
                      <div className="mt-1">
                        <DateField
                          value={area.endDate}
                          min={area.startDate && isYMD(area.startDate) ? area.startDate : undefined}
                          max={
                            area.startDate && isYMD(area.startDate)
                              ? addDaysLocal(area.startDate, 13)
                              : undefined
                          }
                          initialMonth={
                            area.startDate && isYMD(area.startDate)
                              ? area.startDate
                              : undefined
                          }
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
                        <div className="mt-1 text-center text-[11px] text-slate-500">
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
                      disabled={!canSearchArea}
                      className={cx(
                        "h-11 rounded-2xl px-8 text-sm font-extrabold text-white",
                        canSearchArea
                          ? "bg-slate-900 hover:bg-slate-800"
                          : "cursor-not-allowed bg-slate-300"
                      )}
                    >
                      Search
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="flex items-center justify-center py-3">
            <div className="flex items-center gap-4">
              <div className="h-px w-20 bg-slate-300" />
              <div className="text-base font-extrabold tracking-widest text-slate-700">
                OR
              </div>
              <div className="h-px w-20 bg-slate-300" />
            </div>
          </div>

          <section
            className={cx(
              "relative overflow-visible rounded-3xl border border-slate-200 bg-white shadow-sm",
              openPanel === "favorites" ? "z-30" : "z-10"
            )}
          >
            <button
              type="button"
              onClick={() => togglePanel("favorites")}
              className={cx(
                "w-full px-5 py-4 text-left transition sm:px-7",
                openPanel === "favorites"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-900 hover:bg-slate-50"
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-black">by Favorite Team or Band</div>
                  <div
                    className={cx(
                      "mt-1 text-xs",
                      openPanel === "favorites" ? "text-slate-300" : "text-slate-600"
                    )}
                  />
                </div>
                <div className="text-2xl font-light leading-none">
                  {openPanel === "favorites" ? "−" : "+"}
                </div>
              </div>
            </button>

            <div
              className={cx(
                "grid transition-all duration-500 ease-in-out",
                openPanel === "favorites"
                  ? "grid-rows-[1fr] opacity-100 pointer-events-auto"
                  : "grid-rows-[0fr] opacity-0 pointer-events-none"
              )}
              aria-hidden={openPanel !== "favorites"}
            >
              <div className="min-h-0 overflow-visible">
                <div className="overflow-visible border-t border-slate-200 p-5 sm:p-7">
                  <div className="grid gap-5">
                    <div className="relative z-20">
                      <GroupedComboBox
                        label="Favorite Team or Band"
                        value={fav.f1Label}
                        placeholder="Browse teams and artists, or type to narrow"
                        rows={favoriteRows}
                        onChange={(v) =>
                          setFav((s) => ({
                            ...s,
                            f1Label: v,
                            f1Kind: "",
                            f1AttractionId: "",
                            f1SeriesKey: "",
                            f1DefaultGenre: "",
                          }))
                        }
                        onPick={(row) => {
                          if (row.optionType !== "favorite" || !row.favorite) return;

                          const opt = row.favorite;

                          setFav((s) => ({
                            ...s,
                            f1Label: opt.label,
                            f1Kind: opt.kind,
                            f1AttractionId: String(opt.attractionId || "").trim(),
                            f1SeriesKey: String(opt.seriesKey || "").trim(),
                            f1DefaultGenre: String(opt.defaultGenre || "").trim(),
                          }));
                        }}
                        onClear={() => setFav(DEFAULT_FAV)}
                      />
                    </div>

                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={onSearchFavorites}
                        disabled={!canSearchFavorites}
                        className={cx(
                          "h-11 rounded-2xl px-8 text-sm font-extrabold text-white",
                          canSearchFavorites
                            ? "bg-slate-900 hover:bg-slate-800"
                            : "cursor-not-allowed bg-slate-300"
                        )}
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