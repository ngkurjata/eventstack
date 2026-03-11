"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "./components/BrandLogo";
import { listToCsv } from "@/lib/url";
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

function ensureFourGenres(genres: string[]) {
  const next = Array.isArray(genres) ? [...genres] : [];
  while (next.length < 4) next.push("");
  return next.slice(0, 4);
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

type TeamMasterRow = { league: string; teamName: string };
type TeamAttractionIds = Record<string, Record<string, string>>;

type ArtistOpt = {
  id: string;
  label: string;
  group?: string;
  kind?: string;
  genres?: string[];
};

type GenresConfig = {
  music?: { entries?: Array<{ name: string; enabled?: boolean }> };
  sports?: { entries?: Array<{ name: string; enabled?: boolean }> };
  arts?: { entries?: Array<{ name: string; enabled?: boolean }> };
  aliases?: Record<string, string>;
};

type FavoriteOption = {
  key: string;
  label: string;
  kind: "team" | "artist";
  attractionId?: string;
  defaultGenre?: string;
  rawName: string;
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
  genres: string[];
};

type FavState = {
  f1Label: string;
  f1AttractionId: string;
  f1DefaultGenre: string;

  f2Label: string;
  f2AttractionId: string;
  f2DefaultGenre: string;

  favStart: string;
  favEnd: string;
  genres: string[];
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
  genres: ["", "", "", ""],
};

const DEFAULT_FAV: FavState = {
  f1Label: "",
  f1AttractionId: "",
  f1DefaultGenre: "",

  f2Label: "",
  f2AttractionId: "",
  f2DefaultGenre: "",

  favStart: "",
  favEnd: "",
  genres: ["", "", "", ""],
};

/* -------------------- helpers -------------------- */

function leagueToDefaultGenre(league: string) {
  const L = String(league || "").toUpperCase();
  if (L === "NHL") return "Hockey";
  if (L === "MLB") return "Baseball";
  if (L === "NBA") return "Basketball";
  if (L === "NFL" || L === "CFL") return "Football";
  if (L === "MLS") return "Soccer";
  return "Sports";
}

function normalizeGenreFromConfig(input: string, aliases?: Record<string, string>) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const key = norm(raw);
  const found = aliases ? aliases[key] : undefined;
  return found || raw;
}

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
  const [genreOptions, setGenreOptions] = useState<Array<{ label: string }>>([]);
  const [genreAliases, setGenreAliases] = useState<Record<string, string>>({});

  const artistAttractionCacheRef = useRef<Record<string, string>>({});

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
      genres: ensureFourGenres(nextArea?.genres || DEFAULT_AREA.genres),
    });

    setFav({
      ...DEFAULT_FAV,
      ...nextFav,
      genres: ensureFourGenres(Array.isArray(nextFav?.genres) ? nextFav.genres : DEFAULT_FAV.genres),
    });

    setHasLoadedSession(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedSession) return;
    saveSession(KEY_MODE, mode);
  }, [mode, hasLoadedSession]);

  useEffect(() => {
    if (!hasLoadedSession) return;
    saveSession(KEY_AREA, { ...area, genres: ensureFourGenres(area.genres) });
  }, [area, hasLoadedSession]);

  useEffect(() => {
    if (!hasLoadedSession) return;
    saveSession(KEY_FAV, fav);
  }, [fav, hasLoadedSession]);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        const [citiesJ, teamsMasterJ, teamIdsJ, artistsJ, genresJ] = await Promise.all([
          fetch("/cities.json", { cache: "force-cache" }).then((r) => (r.ok ? r.json() : [])),
          fetch("/teams_master.json", { cache: "force-cache" }).then((r) => (r.ok ? r.json() : [])),
          fetch("/team_attraction_ids.json", { cache: "force-cache" }).then((r) => (r.ok ? r.json() : {})),
          fetch("/artist_options.json", { cache: "force-cache" }).then((r) => (r.ok ? r.json() : [])),
          fetch("/genres_config.json", { cache: "force-cache" }).then((r) => (r.ok ? r.json() : {})),
        ]);

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

        const gc: GenresConfig = genresJ && typeof genresJ === "object" ? (genresJ as any) : {};
        const aliases: Record<string, string> = {};
        for (const [k, v] of Object.entries(gc.aliases || {})) {
          aliases[norm(k)] = String(v);
        }

        const collect = (entries: any[] | undefined) =>
          (Array.isArray(entries) ? entries : [])
            .filter((e) => e && (e.enabled === undefined || e.enabled === true))
            .map((e) => String(e.name || "").trim())
            .filter(Boolean);

        const names = [...collect(gc.music?.entries), ...collect(gc.sports?.entries), ...collect(gc.arts?.entries)];

        const seen = new Set<string>();
        const unique = names.filter((n) => {
          const k = norm(n);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        setGenreAliases(aliases);
        setGenreOptions(unique.map((n) => ({ label: n })));

        const teamsMaster: TeamMasterRow[] = Array.isArray(teamsMasterJ) ? (teamsMasterJ as any) : [];
        const teamIds: TeamAttractionIds = teamIdsJ && typeof teamIdsJ === "object" ? (teamIdsJ as any) : {};

        const teamOpts: FavoriteOption[] = teamsMaster
          .map((t: any) => {
            const league = String(t?.league || "").trim();
            const teamName = String(t?.teamName || "").trim();
            if (!league || !teamName) return null;

            const attractionId = String(teamIds?.[league]?.[teamName] || "").trim();
            const defaultGenre = leagueToDefaultGenre(league);

            return {
              key: `team:${league}:${teamName}`,
              kind: "team",
              rawName: teamName,
              label: `${teamName} — ${league}`,
              attractionId: attractionId || undefined,
              defaultGenre,
            };
          })
          .filter(Boolean) as FavoriteOption[];

        const artists: ArtistOpt[] = Array.isArray(artistsJ) ? (artistsJ as any) : [];
        const artistOpts: FavoriteOption[] = artists
          .map((a) => {
            const name = String(a?.label || "").trim();
            if (!name) return null;

            const g0 = Array.isArray(a?.genres) ? String(a.genres[0] || "").trim() : "";
            const defaultGenre = g0 ? normalizeGenreFromConfig(g0, aliases) : "";

            return {
              key: String(a?.id || `artist:${name}`),
              kind: "artist",
              rawName: name,
              label: defaultGenre ? `${name} — ${defaultGenre}` : name,
              defaultGenre: defaultGenre || undefined,
            };
          })
          .filter(Boolean) as FavoriteOption[];

        const map = new Map<string, FavoriteOption>();
        for (const o of [...teamOpts, ...artistOpts]) map.set(o.key, o);
        setFavoriteOptions(Array.from(map.values()));
      } catch {
        if (!cancelled) {
          setCities([]);
          setFavoriteOptions([]);
          setGenreOptions([]);
          setGenreAliases({});
        }
      }
    }

    loadAll();

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
        genres: ensureFourGenres(s.genres),
      }));
      return;
    }

    if (isYMD(area.startDate) && !area.endTouched) {
      const autoEnd = addDaysLocal(area.startDate, 13);
      if (autoEnd && autoEnd !== area.endDate) {
        setArea((s) => ({
          ...s,
          endDate: autoEnd,
          genres: ensureFourGenres(s.genres),
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
        genres: ensureFourGenres(s.genres),
      }));
    }
  }, [area.radiusMiles]);

  useEffect(() => {
    if ((area.genres || []).length !== 4) {
      setArea((s) => ({ ...s, genres: ensureFourGenres(s.genres) }));
    }
  }, [area.genres]);

  

  const areaGenreClean = useMemo(() => {
    return ensureFourGenres(area.genres)
      .map((g) => String(g || "").trim())
      .filter(Boolean)
      .slice(0, 4);
  }, [area.genres]);

  const favGenreClean = useMemo(() => {
    return ensureFourGenres(fav.genres)
      .map((g) => String(g || "").trim())
      .filter(Boolean)
      .slice(0, 4);
  }, [fav.genres]);

  async function resolveArtistAttractionId(name: string): Promise<string> {
    const q = String(name || "").trim();
    if (!q) return "";

    const cacheKey = q.toLowerCase();
    const cached = artistAttractionCacheRef.current[cacheKey];
    if (cached) return cached;

    try {
      const r = await fetch(`/api/suggest/attractions?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({} as any));
      const id = String(j?.items?.[0]?.id || "").trim();

      if (id) {
        artistAttractionCacheRef.current[cacheKey] = id;
      }

      return id;
    } catch {
      return "";
    }
  }

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

    if (areaGenreClean.length < 1) {
      alert("Area search requires at least 1 Genre.");
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
        genres: listToCsv(areaGenreClean),
        countryCode: "US,CA",
      }).toString();

    router.push(url);
  }

  function onSearchFavorites() {
    if (!fav.f1Label.trim() || !fav.f1AttractionId.trim() || !fav.f1DefaultGenre.trim()) {
      alert("Favorites search requires Favorite 1 (pick an option so attractionId + defaultGenre fill).");
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
      f1DefaultGenre: fav.f1DefaultGenre.trim(),
      genres: listToCsv(favGenreClean),
    };

    if (fav.f2Label.trim() && fav.f2AttractionId.trim() && fav.f2DefaultGenre.trim()) {
      params.f2Label = fav.f2Label.trim();
      params.f2AttractionId = fav.f2AttractionId.trim();
      params.f2DefaultGenre = fav.f2DefaultGenre.trim();
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

  const areaGenres = ensureFourGenres(area.genres);

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
                    Tell us where and when you're going, and what you're into, and we'll find you some events to check
                    out while you're there.
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
                      onChange={(v) => setArea((s) => ({ ...s, cityLabel: v }))}
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

                  <div className="mt-6">
                    <div className="text-xs font-semibold text-slate-700">
                      Favorite Sports and/or Music Genres (enter up to 4)
                    </div>

                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      {areaGenres.map((g, i) => (
                        <ComboBox<{ label: string }>
                          key={i}
                          label={`Genre ${i + 1}`}
                          value={g}
                          placeholder="Type a genre…"
                          options={genreOptions}
                          onChange={(v) =>
                            setArea((s) => ({
                              ...s,
                              genres: ensureFourGenres(s.genres).map((val, idx) => (idx === i ? v : val)),
                            }))
                          }
                          onPick={(opt) =>
                            setArea((s) => ({
                              ...s,
                              genres: ensureFourGenres(s.genres).map((val, idx) => (idx === i ? opt.label : val)),
                            }))
                          }
                        />
                      ))}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onSearchArea}
                        className="h-11 rounded-2xl bg-slate-900 px-5 text-sm font-extrabold text-white hover:bg-slate-800"
                      >
                        Search
                      </button>
                    </div>
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
                  <div className="text-lg font-black">Plan around Favorites</div>
                  <div
                    className={cx("mt-1 text-xs", openPanel === "favorites" ? "text-slate-300" : "text-slate-600")}
                  >
                    Tell us what you're into, and we'll help you find some good trips.
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
                      label="Favorite Team, Artist or Band 1 (Required)"
                      value={fav.f1Label}
                      placeholder="Type a team or artist…"
                      options={favoriteOptions}
                      onChange={(v) =>
                        setFav((s) => ({
                          ...s,
                          f1Label: v,
                          ...(v.trim()
                            ? {}
                            : {
                                f1AttractionId: "",
                                f1DefaultGenre: "",
                              }),
                        }))
                      }
                      onPick={async (opt) => {
                        const nextLabel = opt.rawName;
                        const nextGenre = opt.defaultGenre ? normalizeGenreFromConfig(opt.defaultGenre, genreAliases) : "";
                        let id = opt.attractionId || "";

                        if (!id && opt.kind === "artist") {
                          id = await resolveArtistAttractionId(opt.rawName);
                        }

                        setFav((s) => ({
                          ...s,
                          f1Label: nextLabel,
                          f1AttractionId: id,
                          f1DefaultGenre: nextGenre || s.f1DefaultGenre || "",
                        }));
                      }}
                    />

                    <ComboBox<FavoriteOption>
                      label="Favorite Team, Artist or Band 2"
                      value={fav.f2Label}
                      placeholder="Type a team or artist…"
                      options={favoriteOptions}
                      onChange={(v) =>
                        setFav((s) => ({
                          ...s,
                          f2Label: v,
                          ...(v.trim()
                            ? {}
                            : {
                                f2AttractionId: "",
                                f2DefaultGenre: "",
                              }),
                        }))
                      }
                      onPick={async (opt) => {
                        const nextLabel = opt.rawName;
                        const nextGenre = opt.defaultGenre ? normalizeGenreFromConfig(opt.defaultGenre, genreAliases) : "";
                        let id = opt.attractionId || "";

                        if (!id && opt.kind === "artist") {
                          id = await resolveArtistAttractionId(opt.rawName);
                        }

                        setFav((s) => ({
                          ...s,
                          f2Label: nextLabel,
                          f2AttractionId: id,
                          f2DefaultGenre: nextGenre || s.f2DefaultGenre || "",
                        }));
                      }}
                    />

                    <div>
                      <div className="text-xs font-semibold text-slate-700">
                        Favorite Sports and/or Music Genres (enter up to 4)
                      </div>

                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {ensureFourGenres(fav.genres).map((g, i) => (
                          <ComboBox<{ label: string }>
                            key={i}
                            label={`Genre ${i + 1}`}
                            value={g}
                            placeholder="Type a genre…"
                            options={genreOptions}
                            onChange={(v) =>
                              setFav((s) => {
                                const next = ensureFourGenres(s.genres);
                                next[i] = v;
                                return { ...s, genres: next };
                              })
                            }
                            onPick={(opt) =>
                              setFav((s) => {
                                const next = ensureFourGenres(s.genres);
                                next[i] = opt.label;
                                return { ...s, genres: next };
                              })
                            }
                          />
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-700">Start (optional)</div>
                        <input
                          value={fav.favStart}
                          onChange={(e) => setFav((s) => ({ ...s, favStart: e.target.value }))}
                          placeholder="YYYY-MM-DD"
                          className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                        />
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-slate-700">End (optional)</div>
                        <input
                          value={fav.favEnd}
                          onChange={(e) => setFav((s) => ({ ...s, favEnd: e.target.value }))}
                          placeholder="YYYY-MM-DD"
                          className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                        />
                      </div>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={onSearchFavorites}
                        className="h-11 rounded-2xl bg-slate-900 px-5 text-sm font-extrabold text-white hover:bg-slate-800"
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