"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "./components/BrandLogo";
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
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
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
  favStart: string;
  favEnd: string;
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
  favStart: "",
  favEnd: "",
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
      alert("End date must be within 14 days of Start (Start + 13 max).");
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

    if ((fav.favStart && !isYMD(fav.favStart)) || (fav.favEnd && !isYMD(fav.favEnd))) {
      alert("If provided, Favorites Start/End must be YYYY-MM-DD.");
      return;
    }

    if ((fav.favStart && !fav.favEnd) || (!fav.favStart && fav.favEnd)) {
      alert("Provide both Start and End or leave both empty for Favorites search.");
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

    if (fav.favStart && fav.favEnd) {
      params.start = fav.favStart;
      params.end = fav.favEnd;
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

  const favoriteHint = favoriteLoading
    ? "Searching..."
    : favoriteError
    ? favoriteError
    : fav.f1Label.trim()
    ? `${favoriteOptions.length} match${favoriteOptions.length === 1 ? "" : "es"}`
    : "";

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-4 lg:max-w-4xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <BrandLogo />
              <div className="min-w-0">
                <div className="truncate text-base font-black tracking-tight text-slate-900">EventStack</div>
                <div className="truncate text-xs text-slate-600">
                  Simplifying Concert &amp; Live Sports Trip Planning
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-4xl lg:py-10">
        <div className="space-y-4">
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
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
                  <div className="text-lg font-black">Explore by City</div>
                  <div className={cx("mt-1 text-xs", openPanel === "area" ? "text-slate-300" : "text-slate-600")}>
                    Tell us where and when you're going, and we'll find you some events to check out while you're there.
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
                      <input
                        value={area.startDate}
                        onChange={(e) => setArea((s) => ({ ...s, startDate: e.target.value }))}
                        placeholder="YYYY-MM-DD"
                        className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                      />
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-slate-700">End Date</div>
                      <input
                        value={area.endDate}
                        onChange={(e) => setArea((s) => ({ ...s, endDate: e.target.value, endTouched: true }))}
                        placeholder="YYYY-MM-DD"
                        className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                      />
                      {!area.endTouched && isYMD(area.startDate) ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Auto end: {addDaysLocal(area.startDate, 13)}
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

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
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
                  <div className="text-lg font-black">Plan around your Favorites</div>
                  <div
                    className={cx("mt-1 text-xs", openPanel === "favorites" ? "text-slate-300" : "text-slate-600")}
                  >
                    Pick a team or artist, then build from that schedule.
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
                      label="Favorite Team or Artist*"
                      value={fav.f1Label}
                      placeholder="Type a team or artist…"
                      options={favoriteOptions}
                      rightHint={favoriteHint}
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

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-700">Start Date (optional)</div>
                        <input
                          value={fav.favStart}
                          onChange={(e) => setFav((s) => ({ ...s, favStart: e.target.value }))}
                          placeholder="YYYY-MM-DD"
                          className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                        />
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-slate-700">End Date (optional)</div>
                        <input
                          value={fav.favEnd}
                          onChange={(e) => setFav((s) => ({ ...s, favEnd: e.target.value }))}
                          placeholder="YYYY-MM-DD"
                          className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                        />
                      </div>
                    </div>

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