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
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
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
type TeamAttractionIds = Record<string, Record<string, string>>; // { NHL: { "Edmonton Oilers": "K8vZ..." }, ... }

type ArtistOpt = {
  id: string; // "artist:Luke_Combs"
  label: string; // "Luke Combs"
  group?: string;
  kind?: string;
  genres?: string[]; // ["Country"] etc (not always TM classificationName)
};

type GenresConfig = {
  music?: { entries?: Array<{ name: string; enabled?: boolean }> };
  sports?: { entries?: Array<{ name: string; enabled?: boolean }> };
  arts?: { entries?: Array<{ name: string; enabled?: boolean }> };
  aliases?: Record<string, string>;
};

type FavoriteOption = {
  key: string; // unique key for list rendering
  label: string; // display label shown in dropdown
  kind: "team" | "artist";
  attractionId?: string; // teams have it; artists resolved on pick
  defaultGenre?: string; // if present, use it
  rawName: string; // clean label without suffix
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
      if (!wrapRef.current.contains(e.target as any)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => setActive(0), [value]);

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
          disabled && "bg-slate-100 text-slate-500 cursor-not-allowed"
        )}
      />

      {open && filtered.length > 0 && !disabled && (
        <div className="absolute z-20 mt-2 w-full rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
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
                "w-full text-left px-4 py-2 text-sm",
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
  genres: string[]; // 1..4
};

type FavState = {
  f1Label: string;
  f1AttractionId: string;
  f1DefaultGenre: string;

  useF2: boolean;
  f2Label: string;
  f2AttractionId: string;
  f2DefaultGenre: string;

  favStart: string; // stays blank by default
  favEnd: string; // stays blank by default
  genres: string[]; // 0..2
};

const KEY_MODE = "eventstack_home_mode_v2";
const KEY_AREA = "eventstack_home_area_v2";
const KEY_FAV = "eventstack_home_fav_v2";

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

  // load persisted forms
  const [area, setArea] = useState<AreaState>(() =>
    loadSession<AreaState>(KEY_AREA, {
      cityLabel: "",
      lat: "",
      lon: "",
      startDate: "",
      endDate: "",
      endTouched: false,
      radiusMiles: 90,
      genres: [""],
    })
  );

  const [fav, setFav] = useState<FavState>(() =>
    loadSession<FavState>(KEY_FAV, {
      f1Label: "",
      f1AttractionId: "",
      f1DefaultGenre: "",

      useF2: false,
      f2Label: "",
      f2AttractionId: "",
      f2DefaultGenre: "",

      favStart: "",
      favEnd: "",
      genres: ["", ""],
    })
  );

  // restore mode once
  useEffect(() => {
    const m = loadSession<Mode>(KEY_MODE, "area");
    if (m === "area" || m === "favorites") setMode(m);
  }, []);

  // persist mode + forms
  useEffect(() => saveSession(KEY_MODE, mode), [mode]);
  useEffect(() => saveSession(KEY_AREA, area), [area]);
  useEffect(() => saveSession(KEY_FAV, fav), [fav]);

  // options
  const [cities, setCities] = useState<CityOpt[]>([]);
  const [favoriteOptions, setFavoriteOptions] = useState<FavoriteOption[]>([]);
  const [genreOptions, setGenreOptions] = useState<Array<{ label: string }>>([]);
  const [genreAliases, setGenreAliases] = useState<Record<string, string>>({});

  // load public JSONs
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

        // Cities (flat: {label, lat, lon})
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

        // Genres config
        const gc: GenresConfig = (genresJ && typeof genresJ === "object") ? (genresJ as any) : {};
        const aliases: Record<string, string> = {};
        for (const [k, v] of Object.entries(gc.aliases || {})) aliases[norm(k)] = String(v);

        const collect = (entries: any[] | undefined) =>
          (Array.isArray(entries) ? entries : [])
            .filter((e) => e && (e.enabled === undefined || e.enabled === true))
            .map((e) => String(e.name || "").trim())
            .filter(Boolean);

        const names = [
          ...collect(gc.music?.entries),
          ...collect(gc.sports?.entries),
          ...collect(gc.arts?.entries),
        ];

        // De-dupe while preserving order
        const seen = new Set<string>();
        const unique = names.filter((n) => {
          const k = norm(n);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        setGenreAliases(aliases);
        setGenreOptions(unique.map((n) => ({ label: n })));

        // Favorites (teams + artists)
        const teamsMaster: TeamMasterRow[] = Array.isArray(teamsMasterJ) ? (teamsMasterJ as any) : [];
        const teamIds: TeamAttractionIds = (teamIdsJ && typeof teamIdsJ === "object") ? (teamIdsJ as any) : {};

        const teamOpts: FavoriteOption[] = teamsMaster
          .map((t: any) => {
            const league = String(t?.league || "").trim();
            const teamName = String(t?.teamName || "").trim();
            if (!league || !teamName) return null;
            const attractionId = String(teamIds?.[league]?.[teamName] || "").trim();
            // for teams, defaultGenre is inferred (since option doesn't provide it)
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
            // use option's genre when present (your requirement)
            const defaultGenre = g0 ? normalizeGenreFromConfig(g0, aliases) : "";
            return {
              key: String(a?.id || `artist:${name}`),
              kind: "artist",
              rawName: name,
              label: defaultGenre ? `${name} — ${defaultGenre}` : name,
              // attractionId resolved via /api/suggest/attractions on pick
              defaultGenre: defaultGenre || undefined,
            };
          })
          .filter(Boolean) as FavoriteOption[];

        // De-dupe by key
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

  // Area defaults for dates
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
      if (autoEnd && autoEnd !== area.endDate) setArea((s) => ({ ...s, endDate: autoEnd }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.startDate]);

  // clamp area radius
  useEffect(() => {
    const clamped = clamp(Number(area.radiusMiles) || 90, 10, 120);
    if (clamped !== area.radiusMiles) setArea((s) => ({ ...s, radiusMiles: clamped }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area.radiusMiles]);

  const areaGenreClean = useMemo(
    () => area.genres.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 4),
    [area.genres]
  );

  const favGenreClean = useMemo(
    () => fav.genres.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 2),
    [fav.genres]
  );

  function addAreaGenre() {
    setArea((s) => ({ ...s, genres: s.genres.length >= 4 ? s.genres : [...s.genres, ""] }));
  }
  function removeAreaGenre(i: number) {
    setArea((s) => ({ ...s, genres: s.genres.filter((_, idx) => idx !== i) }));
  }

  async function resolveArtistAttractionId(name: string): Promise<string> {
    const q = String(name || "").trim();
    if (!q) return "";
    try {
      const r = await fetch(`/api/suggest/attractions?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({} as any));
      const id = String(j?.items?.[0]?.id || "").trim();
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

    // Find the picked city so we can pass airportIata through to results/area
const pickedCity =
  cities.find((c) => String(c.label || "").trim() === area.cityLabel.trim()) ||
  cities.find((c) => String(c.lat) === String(latN) && String(c.lon) === String(lonN));

const airportIata = String(pickedCity?.airportIata || "").trim().toUpperCase();

const url =
  `/results/area?` +
  new URLSearchParams({
    cityLabel: area.cityLabel.trim(),
    lat: String(latN),
    lon: String(lonN),
    airportIata, // ✅ ADD THIS
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

    if (fav.useF2 && fav.f2Label.trim() && fav.f2AttractionId.trim() && fav.f2DefaultGenre.trim()) {
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

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-4 lg:max-w-4xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BrandLogo />
              <div className="min-w-0">
  <div className="text-base font-black tracking-tight text-slate-900 truncate">EventStack</div>
  <div className="text-xs text-slate-600 truncate">Simplifying Concert & Live Sports Trip Planning</div>
</div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("area")}
              className={cx(
                "h-11 rounded-2xl px-4 text-sm font-extrabold border transition",
                mode === "area"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-900 border-slate-200 hover:bg-slate-50"
              )}
            >
              Explore by City
            </button>
            <button
              type="button"
              onClick={() => setMode("favorites")}
              className={cx(
                "h-11 rounded-2xl px-4 text-sm font-extrabold border transition",
                mode === "favorites"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-900 border-slate-200 hover:bg-slate-50"
              )}
            >
              Plan around Favorites
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-4xl lg:py-10">
        {mode === "area" ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="text-lg font-black text-slate-900">Explore by City</div>
            <div className="mt-1 text-xs text-slate-600">
              City typeahead auto-fills lat/lon. Start defaults to tomorrow; End defaults to Start + 13 days. Radius max 120.
            </div>

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
                rightHint="auto lat/lon"
              />

              <div>
                <div className="text-xs font-semibold text-slate-700">Lat</div>
                <input
                  value={area.lat}
                  onChange={(e) => setArea((s) => ({ ...s, lat: e.target.value }))}
                  placeholder="auto"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700">Lon</div>
                <input
                  value={area.lon}
                  onChange={(e) => setArea((s) => ({ ...s, lon: e.target.value }))}
                  placeholder="auto"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700">Start</div>
                <input
                  value={area.startDate}
                  onChange={(e) => setArea((s) => ({ ...s, startDate: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700">End (Start + 13 max)</div>
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

              <div>
                <div className="flex items-end justify-between">
                  <div className="text-xs font-semibold text-slate-700">Radius (miles)</div>
                  <div className="text-[11px] text-slate-500">max 120</div>
                </div>
                <input
                  type="number"
                  value={area.radiusMiles}
                  onChange={(e) => setArea((s) => ({ ...s, radiusMiles: clamp(Number(e.target.value), 10, 120) }))}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                />
              </div>
            </div>

            <div className="mt-6">
              <div className="text-xs font-semibold text-slate-700">Genres (1–4)</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {area.genres.map((g, i) => (
                  <div key={i} className="flex gap-2">
                    <ComboBox<{ label: string }>
                      label={`Genre ${i + 1}`}
                      value={g}
                      placeholder="Type a genre…"
                      options={genreOptions}
                      onChange={(v) =>
                        setArea((s) => ({
                          ...s,
                          genres: s.genres.map((val, idx) => (idx === i ? v : val)),
                        }))
                      }
                      onPick={(opt) =>
                        setArea((s) => ({
                          ...s,
                          genres: s.genres.map((val, idx) => (idx === i ? opt.label : val)),
                        }))
                      }
                    />

                    {area.genres.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeAreaGenre(i)}
                        className="mt-[18px] h-11 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-800 hover:bg-slate-50"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={addAreaGenre}
                  className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                >
                  Add genre
                </button>
                <button
                  type="button"
                  onClick={onSearchArea}
                  className="h-11 rounded-2xl bg-slate-900 px-5 text-sm font-extrabold text-white hover:bg-slate-800"
                >
                  Search
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="text-lg font-black text-slate-900">Plan around Favorites</div>
            <div className="mt-1 text-xs text-slate-600">
              Favorites typeahead auto-fills attractionId. Default genre comes from the option when present. Dates stay blank unless you fill them.
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <ComboBox<FavoriteOption>
                label="Favorite 1"
                value={fav.f1Label}
                placeholder="Type a team or artist…"
                options={favoriteOptions}
                onChange={(v) => setFav((s) => ({ ...s, f1Label: v }))}
                onPick={async (opt) => {
                  const nextLabel = opt.rawName;
                  const nextGenre = opt.defaultGenre ? normalizeGenreFromConfig(opt.defaultGenre, genreAliases) : "";
                  let id = opt.attractionId || "";

                  // artists: resolve id from TM on pick
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
                rightHint="auto ID"
              />

              <div>
                <div className="text-xs font-semibold text-slate-700">AttractionId</div>
                <input
                  value={fav.f1AttractionId}
                  onChange={(e) => setFav((s) => ({ ...s, f1AttractionId: e.target.value }))}
                  placeholder="auto"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-700">Default genre</div>
                <input
                  value={fav.f1DefaultGenre}
                  onChange={(e) => setFav((s) => ({ ...s, f1DefaultGenre: e.target.value }))}
                  placeholder="auto"
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                />
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={fav.useF2}
                  onChange={(e) => setFav((s) => ({ ...s, useF2: e.target.checked }))}
                />
                <div className="text-sm font-extrabold text-slate-900">Include Favorite 2</div>
              </label>

              {fav.useF2 ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <ComboBox<FavoriteOption>
                    label="Favorite 2"
                    value={fav.f2Label}
                    placeholder="Type a team or artist…"
                    options={favoriteOptions}
                    onChange={(v) => setFav((s) => ({ ...s, f2Label: v }))}
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
                    rightHint="auto ID"
                  />

                  <div>
                    <div className="text-xs font-semibold text-slate-700">AttractionId</div>
                    <input
                      value={fav.f2AttractionId}
                      onChange={(e) => setFav((s) => ({ ...s, f2AttractionId: e.target.value }))}
                      placeholder="auto"
                      className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                    />
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-slate-700">Default genre</div>
                    <input
                      value={fav.f2DefaultGenre}
                      onChange={(e) => setFav((s) => ({ ...s, f2DefaultGenre: e.target.value }))}
                      placeholder="auto"
                      className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
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

            <div className="mt-5">
              <div className="text-xs font-semibold text-slate-700">Optional genres (0–2)</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <ComboBox<{ label: string }>
                  label="Genre 1"
                  value={fav.genres[0] || ""}
                  placeholder="Type a genre…"
                  options={genreOptions}
                  onChange={(v) => setFav((s) => ({ ...s, genres: [v, s.genres[1] || ""] }))}
                  onPick={(opt) => setFav((s) => ({ ...s, genres: [opt.label, s.genres[1] || ""] }))}
                />
                <ComboBox<{ label: string }>
                  label="Genre 2"
                  value={fav.genres[1] || ""}
                  placeholder="Type a genre…"
                  options={genreOptions}
                  onChange={(v) => setFav((s) => ({ ...s, genres: [s.genres[0] || "", v] }))}
                  onPick={(opt) => setFav((s) => ({ ...s, genres: [s.genres[0] || "", opt.label] }))}
                />
              </div>

              <div className="mt-5">
                <button
                  type="button"
                  onClick={onSearchFavorites}
                  className="h-11 rounded-2xl bg-slate-900 px-5 text-sm font-extrabold text-white hover:bg-slate-800"
                >
                  Search
                </button>
              </div>
            </div>
          </section>
        )}

        <div className="mt-6 text-center text-xs text-slate-500">
          Form values persist when navigating away and back (session-based).
        </div>
      </div>
    </main>
  );
}