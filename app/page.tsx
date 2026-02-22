// FILE: app/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "./components/BrandLogo";
import { APP_NAME, TAGLINE } from "../lib/brand";

/* -------------------- Types -------------------- */

type Airport = {
  iata: string;
  name: string;
  city: string;
  region: string; // e.g. "US-CA"
  country: string; // "US" | "CA"
  lat: number | null;
  lon: number | null;
};

type City = {
  id: string; // "US|CA|Anaheim"
  name: string;
  region: string; // "CA" | "BC" etc
  country: string; // "US" | "CA"
  lat: number;
  lon: number;
  airportIata?: string | null;
};

type CombinedOption = {
  id: string;
  label: string;
  group: string;
  kind: "team" | "artist";
  league?: string;
  attractionId?: string;
  tmAttractionId?: string;
};

type MenuItem =
  | { type: "group"; group: string }
  | { type: "item"; group: string; option: CombinedOption };

const LS_SEARCH = "eventstack_search_A_v5_city_p1p2_ranked_genres_tripdays";

type SavedSearch = {
  destCityId?: string;
  destCityLabel?: string;
  destLat?: number;
  destLon?: number;
  destAirportIata?: string;

  start?: string;
  end?: string;

  tripDays?: number;

  primaryId?: string;
  primaryLabel?: string;
  secondaryId?: string;
  secondaryLabel?: string;

  genreOrderCsv?: string;

  radiusText?: string;
  countryCode?: string;
};

/* -------------------- Helpers -------------------- */

function isYMD(s: any): s is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function toYMDLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tomorrowYMD() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toYMDLocal(d);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function parseCsv(raw: string) {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function uniqLowerKeepOrder(xs: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function readSavedSearch(): SavedSearch | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(LS_SEARCH);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as SavedSearch;
  } catch {
    return null;
  }
}

function writeSavedSearch(payload: SavedSearch) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_SEARCH, JSON.stringify(payload));
  } catch {}
}

/* -------------------- Geo helpers -------------------- */

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.7613;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function regionShort(region: string) {
  if (!region) return "";
  return region.includes("-") ? region.split("-")[1] : region;
}

function keyCity(country: string, region: string, name: string) {
  return `${country}|${region}|${name}`.toUpperCase();
}

/* -------------------- Overrides -------------------- */

const OVERRIDE_CITIES: Array<Omit<City, "airportIata">> = [
  { id: "US|CA|Anaheim", name: "Anaheim", region: "CA", country: "US", lat: 33.835293, lon: -117.914505 },
];

/* -------------------- City building -------------------- */

function buildCitiesFromAirports(airports: Airport[]): City[] {
  const byKey = new Map<string, { city: City; airports: Airport[] }>();

  for (const a of airports) {
    const cName = String(a.city || "").trim();
    const cCountry = String(a.country || "").trim().toUpperCase();
    const cRegion = regionShort(String(a.region || "").trim()).toUpperCase();

    if (!cName || !cCountry || !cRegion) continue;
    const lat = a.lat == null ? null : Number(a.lat);
    const lon = a.lon == null ? null : Number(a.lon);
    if (!Number.isFinite(lat as any) || !Number.isFinite(lon as any)) continue;

    const k = keyCity(cCountry, cRegion, cName);

    if (!byKey.has(k)) {
      byKey.set(k, {
        city: {
          id: `${cCountry}|${cRegion}|${cName}`,
          name: cName,
          region: cRegion,
          country: cCountry,
          lat: Number(lat),
          lon: Number(lon),
          airportIata: null,
        },
        airports: [],
      });
    }
    byKey.get(k)!.airports.push(a);
  }

  const out: City[] = [];
  for (const { city, airports: aps } of byKey.values()) {
    let sumLat = 0;
    let sumLon = 0;
    let n = 0;
    for (const a of aps) {
      if (a.lat == null || a.lon == null) continue;
      const lat = Number(a.lat);
      const lon = Number(a.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      sumLat += lat;
      sumLon += lon;
      n += 1;
    }
    if (n > 0) {
      city.lat = sumLat / n;
      city.lon = sumLon / n;
    }
    out.push(city);
  }

  return out;
}

function mergeOverrides(base: City[], overrides: Array<Omit<City, "airportIata">>): City[] {
  const map = new Map<string, City>();
  for (const c of base) map.set(keyCity(c.country, c.region, c.name), c);

  for (const o of overrides) {
    const k = keyCity(o.country, o.region, o.name);
    if (!map.has(k)) map.set(k, { ...o, airportIata: null });
  }

  return Array.from(map.values());
}

function computeNearestAirportIata(c: City, airports: Airport[]): string | null {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;

  let best: { iata: string; d: number } | null = null;

  for (const a of airports) {
    const iata = String(a.iata || "").trim().toUpperCase();
    const lat = a.lat == null ? null : Number(a.lat);
    const lon = a.lon == null ? null : Number(a.lon);
    if (iata.length !== 3) continue;
    if (!Number.isFinite(lat as any) || !Number.isFinite(lon as any)) continue;

    const d = haversineMiles(c.lat, c.lon, Number(lat), Number(lon));
    if (!best || d < best.d) best = { iata, d };
  }

  if (!best) return null;
  if (best.d > 250) return null;
  return best.iata;
}

/* -------------------- CityPicker -------------------- */

function cityLabel(c: City) {
  return `${c.name}${c.region ? `, ${c.region}` : ""} (${c.country})`;
}

function CityPicker(props: {
  cities: City[];
  valueCityId: string;
  onPick: (city: City | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => {
    const v = (props.valueCityId || "").trim();
    return props.cities.find((c) => c.id === v) || null;
  }, [props.valueCityId, props.cities]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query || selected) return [];

    const matches = props.cities.filter((c) => {
      const n = (c.name || "").toLowerCase();
      const r = (c.region || "").toLowerCase();
      const cc = (c.country || "").toLowerCase();
      const iata = (c.airportIata || "").toLowerCase();
      return (
        n.startsWith(query) ||
        n.includes(query) ||
        r.startsWith(query) ||
        r.includes(query) ||
        cc === query ||
        iata.startsWith(query)
      );
    });

    matches.sort((a, b) => {
      const qi = query;
      const aN = (a.name || "").toLowerCase();
      const bN = (b.name || "").toLowerCase();
      const aR = (a.region || "").toLowerCase();
      const bR = (b.region || "").toLowerCase();

      const pref = (s: string) => (s.startsWith(qi) ? 0 : s.includes(qi) ? 3 : 10);
      const sa = pref(aN) + pref(aR);
      const sb = pref(bN) + pref(bR);
      if (sa !== sb) return sa - sb;

      return (a.name + a.region + a.country).localeCompare(b.name + b.region + b.country);
    });

    return matches.slice(0, 12);
  }, [q, props.cities, selected]);

  const isOpen = results.length > 0 && !selected;

  function commitCity(c: City) {
    props.onPick(c);
    setQ("");
    setActiveIdx(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) return;

    if (e.key === "Escape") {
      setActiveIdx(-1);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((idx) => (idx < 0 ? 0 : Math.min(idx + 1, results.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((idx) => (idx <= 0 ? results.length - 1 : idx - 1));
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const pick = results[activeIdx];
      if (pick) commitCity(pick);
      return;
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={selected ? cityLabel(selected) : q}
        onFocus={() => {
          if (selected) requestAnimationFrame(() => inputRef.current?.select());
        }}
        onChange={(e) => {
          props.onPick(null);
          setQ(e.target.value);
          setActiveIdx(-1);
        }}
        onKeyDown={onKeyDown}
        placeholder={props.placeholder ?? "Type a city (e.g., Anaheim, Kelowna)"}
        className="text-slate-900 placeholder:text-slate-400"
        style={{
          width: "100%",
          padding: 10,
          borderRadius: 12,
          border: "1px solid #d7d7d7",
          background: "#fff",
          outline: "none",
        }}
        autoComplete="off"
      />

      <div className="mt-2 text-xs text-center text-slate-600">
        City sets the event radius. Nearest airport is auto-selected for one-click Expedia.
      </div>

      {isOpen ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: 320,
            overflow: "auto",
            border: "1px solid #e6e6e6",
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            padding: 4,
          }}
        >
          {results.map((c, idx) => {
            const isActive = idx === activeIdx;
            return (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  commitCity(c);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 10,
                  background: isActive ? "#0f172a" : "transparent",
                  color: isActive ? "#fff" : "#0f172a",
                }}
              >
                <div style={{ fontWeight: 900 }}>{cityLabel(c)}</div>
                <div style={{ fontSize: 12, opacity: isActive ? 0.85 : 0.75 }}>
                  {c.lat.toFixed(3)}, {c.lon.toFixed(3)}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------- P1/P2 Picker -------------------- */

function buildMenu(options: CombinedOption[], query: string): MenuItem[] {
  const q = query.trim().toLowerCase();

  const filtered =
    q.length < 2
      ? []
      : options.filter((o) => {
          const lbl = (o.label || "").toLowerCase();
          const grp = (o.group || "").toLowerCase();
          const id = (o.id || "").toLowerCase();
          return lbl.includes(q) || grp.includes(q) || id.includes(q);
        });

  const groups: string[] = [];
  const byGroup = new Map<string, CombinedOption[]>();
  for (const o of filtered) {
    const g = o.group || "Other";
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      groups.push(g);
    }
    byGroup.get(g)!.push(o);
  }

  for (const g of groups) {
    byGroup.get(g)!.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  }

  const menu: MenuItem[] = [];
  for (const g of groups) {
    menu.push({ type: "group", group: g });
    for (const o of byGroup.get(g)!) menu.push({ type: "item", group: g, option: o });
  }

  return menu.slice(0, 240);
}

function OptionPicker(props: {
  label: string;
  options: CombinedOption[];
  valueId: string;
  valueLabel: string;
  onPick: (opt: CombinedOption | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isSelected = Boolean(props.valueId);

  const menu = useMemo(() => {
    if (isSelected) return [];
    return buildMenu(props.options, q);
  }, [props.options, q, isSelected]);

  const isOpen = !isSelected && menu.length > 0;

  function commit(opt: CombinedOption | null) {
    props.onPick(opt);
    setQ("");
    setActiveIdx(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) return;

    if (e.key === "Escape") {
      setActiveIdx(-1);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((idx) => (idx < 0 ? 0 : Math.min(idx + 1, menu.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((idx) => (idx <= 0 ? menu.length - 1 : idx - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = menu[activeIdx];
      if (item?.type === "item") commit(item.option);
      return;
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <div className="text-xs font-black text-slate-700">{props.label}</div>

      <div className="mt-1 flex items-stretch gap-2">
        <input
          ref={inputRef}
          value={isSelected ? props.valueLabel : q}
          onFocus={() => {
            if (isSelected) requestAnimationFrame(() => inputRef.current?.select());
          }}
          onChange={(e) => {
            if (isSelected) commit(null);
            setQ(e.target.value);
            setActiveIdx(-1);
          }}
          onKeyDown={onKeyDown}
          placeholder={props.placeholder ?? "Type 2+ letters to search…"}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 placeholder:text-slate-400"
          autoComplete="off"
        />

        {isSelected ? (
          <button
            type="button"
            onClick={() => commit(null)}
            className="rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-50"
            title="Clear"
          >
            Clear
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            zIndex: 60,
            maxHeight: 360,
            overflow: "auto",
            border: "1px solid #e6e6e6",
            background: "#fff",
            borderRadius: 14,
            boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
            padding: 6,
          }}
        >
          {menu.map((it, idx) => {
            if (it.type === "group") {
              return (
                <div
                  key={`g:${it.group}:${idx}`}
                  className="px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-500"
                >
                  {it.group}
                </div>
              );
            }
            const isActive = idx === activeIdx;
            return (
              <button
                key={it.option.id}
                type="button"
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  commit(it.option);
                }}
                className="block w-full rounded-xl px-3 py-2 text-left"
                style={{
                  background: isActive ? "#0f172a" : "transparent",
                  color: isActive ? "#fff" : "#0f172a",
                }}
              >
                <div className="text-sm font-extrabold">{it.option.label}</div>
                <div className="text-[11px]" style={{ opacity: isActive ? 0.85 : 0.65 }}>
                  {it.option.kind === "team" ? "Team" : "Artist"} • {it.option.group}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------- Genres -------------------- */

const MUSIC_GENRES = [
  "Country",
  "Rock",
  "Pop",
  "Hip-Hop",
  "R&B",
  "Electronic",
  "Latin",
  "Metal",
  "Indie",
  "Jazz",
  "Classical",
  "Reggae",
  "Folk",
  "Blues",
];

const SPORTS_GENRES = [
  "Hockey",
  "Baseball",
  "Basketball",
  "Football",
  "Soccer",
  "Golf",
  "Tennis",
  "MMA",
  "Boxing",
  "Racing",
];

function GenreChip(props: { label: string; active: boolean; badge?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-full border px-3 py-2 text-xs font-black"
      style={{
        borderColor: props.active ? "#0f172a" : "#e2e8f0",
        background: props.active ? "#0f172a" : "#ffffff",
        color: props.active ? "#ffffff" : "#0f172a",
      }}
      title={props.active ? "Click to remove" : "Click to select"}
    >
      <span className="inline-flex items-center gap-2">
        {props.badge ? (
          <span
            className="inline-flex h-5 items-center rounded-full bg-white/20 px-2 text-[10px] font-black"
            style={{ border: "1px solid rgba(255,255,255,0.28)" }}
          >
            {props.badge}
          </span>
        ) : null}
        {props.label}
      </span>
    </button>
  );
}

/* -------------------- Page -------------------- */

export default function HomePage() {
  const router = useRouter();

  // City-based destination (optional now)
  const [destCityId, setDestCityId] = useState("");
  const [destCityLabelState, setDestCityLabelState] = useState("");
  const [destLat, setDestLat] = useState<number | null>(null);
  const [destLon, setDestLon] = useState<number | null>(null);
  const [destAirportIata, setDestAirportIata] = useState("");

  // Dates
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // Trip days
  const [tripDaysText, setTripDaysText] = useState("4");
  const tripDays = useMemo(() => {
    const v = Number(tripDaysText);
    if (!Number.isFinite(v)) return 4;
    return clamp(Math.trunc(v), 2, 7);
  }, [tripDaysText]);

  // P1 / P2
  const [primaryId, setPrimaryId] = useState("");
  const [primaryLabel, setPrimaryLabel] = useState("");
  const [secondaryId, setSecondaryId] = useState("");
  const [secondaryLabel, setSecondaryLabel] = useState("");

  // Genres ranked (cap 3 total)
  const [genreOrder, setGenreOrder] = useState<string[]>([]);
  const genreOrderCsv = useMemo(() => genreOrder.join(","), [genreOrder]);

  const [showMoreMusic, setShowMoreMusic] = useState(false);
  const [showMoreSports, setShowMoreSports] = useState(false);

  // Radius
  const [radiusText, setRadiusText] = useState("120");
  const radiusMiles = useMemo(() => {
    const v = Number(radiusText);
    if (!Number.isFinite(v)) return 120;
    return clamp(Math.trunc(v), 1, 120);
  }, [radiusText]);

  // Country code (hidden)
  const [countryCode] = useState("US,CA");

  // Data (cities)
  const [airports, setAirports] = useState<Airport[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [airportsErr, setAirportsErr] = useState("");

  // Data (P1/P2 options)
  const [options, setOptions] = useState<CombinedOption[]>([]);
  const [optionsErr, setOptionsErr] = useState("");

  // Guards
  const hydratedRef = useRef(false);
  const hydratingRef = useRef(false);

  function hydrateFromStorage() {
    try {
      hydratingRef.current = true;

      const saved = readSavedSearch();
      if (saved) {
        if (typeof saved.destCityId === "string") setDestCityId(saved.destCityId);
        if (typeof saved.destCityLabel === "string") setDestCityLabelState(saved.destCityLabel);

        if (saved.destLat != null && Number.isFinite(Number(saved.destLat))) setDestLat(Number(saved.destLat));
        if (saved.destLon != null && Number.isFinite(Number(saved.destLon))) setDestLon(Number(saved.destLon));

        if (typeof saved.destAirportIata === "string") setDestAirportIata(saved.destAirportIata);

        if (typeof saved.start === "string") setStart(saved.start);
        if (typeof saved.end === "string") setEnd(saved.end);

        if (typeof saved.tripDays === "number" && Number.isFinite(saved.tripDays)) {
          setTripDaysText(String(clamp(Math.trunc(saved.tripDays), 2, 7)));
        }

        if (typeof saved.primaryId === "string") setPrimaryId(saved.primaryId);
        if (typeof saved.primaryLabel === "string") setPrimaryLabel(saved.primaryLabel);

        if (typeof saved.secondaryId === "string") setSecondaryId(saved.secondaryId);
        if (typeof saved.secondaryLabel === "string") setSecondaryLabel(saved.secondaryLabel);

        if (typeof saved.genreOrderCsv === "string") {
          setGenreOrder(uniqLowerKeepOrder(parseCsv(saved.genreOrderCsv)).slice(0, 3));
        }

        if (typeof saved.radiusText === "string") {
          setRadiusText(saved.radiusText);
        } else if ((saved as any)?.radiusMiles != null && Number.isFinite(Number((saved as any).radiusMiles))) {
          setRadiusText(String(Number((saved as any).radiusMiles)));
        }
      }

      hydratedRef.current = true;

      setTimeout(() => {
        hydratingRef.current = false;
      }, 0);
    } catch {
      hydratedRef.current = true;
      hydratingRef.current = false;
    }
  }

  useEffect(() => {
    hydrateFromStorage();

    const onPageShow = () => hydrateFromStorage();
    const onPopState = () => hydrateFromStorage();
    const onFocus = () => hydrateFromStorage();
    const onVis = () => {
      if (document.visibilityState === "visible") hydrateFromStorage();
    };

    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default Start date to tomorrow (only if empty/invalid)
  useEffect(() => {
    const t = tomorrowYMD();
    setStart((prev) => (prev && isYMD(prev) ? prev : t));
  }, []);

  // persist on change (but not during hydration)
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (hydratingRef.current) return;

    writeSavedSearch({
      destCityId,
      destCityLabel: destCityLabelState,
      destLat: destLat ?? undefined,
      destLon: destLon ?? undefined,
      destAirportIata,

      start,
      end,

      tripDays,

      primaryId,
      primaryLabel,
      secondaryId,
      secondaryLabel,

      genreOrderCsv,

      radiusText,
      countryCode,
    });
  }, [
    destCityId,
    destCityLabelState,
    destLat,
    destLon,
    destAirportIata,
    start,
    end,
    tripDays,
    primaryId,
    primaryLabel,
    secondaryId,
    secondaryLabel,
    genreOrderCsv,
    radiusText,
    countryCode,
  ]);

  // Load airports -> build cities -> compute nearest airport
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setAirportsErr("");
      try {
        const res = await fetch("/airports.usca.min.json", { cache: "force-cache" });
        if (!res.ok) throw new Error(`airports.usca.min.json failed (${res.status})`);
        const json = await res.json();
        if (cancelled) return;

        const arr = Array.isArray(json)
          ? json
          : Array.isArray((json as any)?.airports)
          ? (json as any).airports
          : [];

        const cleaned: Airport[] = (arr || [])
          .map((a: any) => ({
            iata: String(a?.iata || "").trim().toUpperCase(),
            name: String(a?.name || "").trim(),
            city: String(a?.city || "").trim(),
            region: String(a?.region || "").trim(),
            country: String(a?.country || "").trim().toUpperCase(),
            lat: a?.lat == null ? null : Number(a.lat),
            lon: a?.lon == null ? null : Number(a.lon),
          }))
          .filter((a: Airport) => a.iata.length === 3);

        setAirports(cleaned);

        const baseCities = buildCitiesFromAirports(cleaned);
        const merged = mergeOverrides(baseCities, OVERRIDE_CITIES);

        const withNearest: City[] = merged.map((c) => ({
          ...c,
          airportIata: computeNearestAirportIata(c, cleaned),
        }));

        withNearest.sort((a, b) => (a.name + a.region + a.country).localeCompare(b.name + b.region + b.country));
        setCities(withNearest);
      } catch (e: any) {
        if (cancelled) return;
        setAirports([]);
        setCities([]);
        setAirportsErr(String(e?.message || e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ Backfill destAirportIata after cities are loaded + a city is selected (post-hydration safe)
  useEffect(() => {
    const currentId = (destCityId || "").trim();
    if (!currentId) return;

    if ((destAirportIata || "").trim().length === 3) return;
    if (!cities.length) return;

    const found = cities.find((x) => x.id === currentId);
    if (found?.airportIata) setDestAirportIata(String(found.airportIata).toUpperCase());
  }, [cities, destCityId, destAirportIata]);

  // Load P1/P2 options
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setOptionsErr("");
      try {
        const res = await fetch("/api/options", { cache: "force-cache" });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;

        const combined = Array.isArray(json?.combined) ? (json.combined as CombinedOption[]) : [];
        const cleaned = combined
          .map((o: any) => ({
            id: String(o?.id || ""),
            label: String(o?.label || ""),
            group: String(o?.group || "Other"),
            kind: (o?.kind === "team" ? "team" : "artist") as "team" | "artist",
            league: o?.league ? String(o.league) : undefined,
            attractionId: o?.attractionId ? String(o.attractionId) : undefined,
            tmAttractionId: o?.tmAttractionId ? String(o.tmAttractionId) : undefined,
          }))
          .filter((o: CombinedOption) => o.id && o.label);

        setOptions(cleaned);
        if (!res.ok) setOptionsErr(String(json?.error || `Options failed (${res.status})`));
      } catch (e: any) {
        if (cancelled) return;
        setOptions([]);
        setOptionsErr(String(e?.message || e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // genre helpers
  function isGenreSelected(g: string) {
    return genreOrder.some((x) => x.toLowerCase() === g.toLowerCase());
  }

  function rankBadgeFor(g: string): string | undefined {
    const idx = genreOrder.findIndex((x) => x.toLowerCase() === g.toLowerCase());
    if (idx < 0) return undefined;
    return idx === 0 ? "1st" : idx === 1 ? "2nd" : "3rd";
  }

  function toggleGenre(g: string) {
    setGenreOrder((prev) => {
      const idx = prev.findIndex((x) => x.toLowerCase() === g.toLowerCase());
      if (idx >= 0) {
        const copy = prev.slice();
        copy.splice(idx, 1);
        return copy;
      }
      if (prev.length >= 3) {
        alert("You can only select up to 3 genres.");
        return prev;
      }
      return [...prev, g];
    });
  }

  async function onSearch() {
    const tmr = tomorrowYMD();

    if (genreOrder.length < 1) {
      alert("Pick at least 1 genre.");
      return;
    }

    if (!isYMD(start)) {
      alert("Pick a valid Start date.");
      return;
    }
    if (start < tmr) {
      alert(`Start date must be ${tmr} or later.`);
      return;
    }

    if (!isYMD(end)) {
      alert("Pick a valid End date.");
      return;
    }
    if (end < start) {
      alert("End date must be the same as or after the Start date.");
      return;
    }

    // “Where” is optional. If city is filled properly, A; otherwise B (api/search decides).
    const hasCity = Boolean(destCityId) && Number.isFinite(destLat as any) && Number.isFinite(destLon as any);

    // Split genres by known lists
    const sportsSet = new Set(SPORTS_GENRES.map((x) => x.toLowerCase()));
    const splitSports: string[] = [];
    const splitMusic: string[] = [];
    for (const g of genreOrder) {
      if (sportsSet.has(String(g).toLowerCase())) splitSports.push(g);
      else splitMusic.push(g);
    }

    writeSavedSearch({
      destCityId,
      destCityLabel: destCityLabelState,
      destLat: destLat ?? undefined,
      destLon: destLon ?? undefined,
      destAirportIata,
      start,
      end,
      tripDays,
      primaryId,
      primaryLabel,
      secondaryId,
      secondaryLabel,
      genreOrderCsv,
      radiusText,
      countryCode,
    });

    const qs = new URLSearchParams();
    qs.set("tripDays", String(tripDays));
    qs.set("start", start);
    qs.set("end", end);
    qs.set("radiusMiles", String(radiusMiles));
    qs.set("countryCode", countryCode);

    if (primaryId) qs.set("primaryId", primaryId);
    if (secondaryId) qs.set("secondaryId", secondaryId);

    qs.set("genreOrder", genreOrder.join(","));

    for (const g of splitSports) qs.append("sportsGenres", g);
    for (const g of splitMusic) qs.append("musicGenres", g);

    // ✅ only include destination params when we truly have a destination
    if (hasCity) {
      qs.set("destCityId", destCityId);
      qs.set("destCityLabel", destCityLabelState || "");
      qs.set("lat", String(destLat));
      qs.set("lon", String(destLon));

      // IMPORTANT: only send destIata when hasCity is true
      if ((destAirportIata || "").trim().length === 3) {
        qs.set("destIata", destAirportIata.trim().toUpperCase());
      }
    }

    const res = await fetch(`/api/search?${qs.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json?.ok || !json?.nextUrl) {
      alert(json?.error || `Search failed (${res.status})`);
      return;
    }

    router.push(String(json.nextUrl));
  }

  const minStart = tomorrowYMD();
  const minEnd = isYMD(start) ? start : minStart;

  const shownMusic = showMoreMusic ? MUSIC_GENRES : MUSIC_GENRES.slice(0, 4);
  const shownSports = showMoreSports ? SPORTS_GENRES : SPORTS_GENRES.slice(0, 4);

  const pref1 = genreOrder[0] || "";
  const pref2 = genreOrder[1] || "";
  const pref3 = genreOrder[2] || "";

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-5 lg:max-w-3xl">
          <div className="flex items-center gap-3">
            <BrandLogo />
            <div className="min-w-0">
              <div className="text-lg font-black tracking-tight text-slate-900 sm:text-xl">{APP_NAME}</div>
              <div className="text-xs text-slate-600 sm:text-sm">{TAGLINE}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-3xl lg:py-10">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="text-center">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">Search</h1>
            <div className="mt-2 text-sm font-semibold text-slate-700">
              Genre #1 is required. Everything else is optional.
            </div>
            {airportsErr ? <div className="mt-3 text-xs text-rose-700">Airports file error: {airportsErr}</div> : null}
            {optionsErr ? <div className="mt-2 text-xs text-rose-700">Options error: {optionsErr}</div> : null}
          </div>

          <div className="mt-6 grid gap-4">
            {/* Genres */}
            <div>
              <div className="text-xs font-black text-slate-700">Preferred genres (max 3)</div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                <GenreChip label={pref1 || "Genre 1"} active={Boolean(pref1)} badge="1st" onClick={() => pref1 && toggleGenre(pref1)} />
                <GenreChip label={pref2 || "Genre 2"} active={Boolean(pref2)} badge="2nd" onClick={() => pref2 && toggleGenre(pref2)} />
                <GenreChip label={pref3 || "Genre 3"} active={Boolean(pref3)} badge="3rd" onClick={() => pref3 && toggleGenre(pref3)} />
              </div>

              <div className="mt-3">
                <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Music</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {shownMusic.map((g) => (
                    <GenreChip key={g} label={g} active={isGenreSelected(g)} badge={rankBadgeFor(g)} onClick={() => toggleGenre(g)} />
                  ))}
                  {MUSIC_GENRES.length > 4 ? (
                    <button
                      type="button"
                      onClick={() => setShowMoreMusic((v) => !v)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      {showMoreMusic ? "Hide more" : "Show more"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4">
                <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Sports</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {shownSports.map((g) => (
                    <GenreChip key={g} label={g} active={isGenreSelected(g)} badge={rankBadgeFor(g)} onClick={() => toggleGenre(g)} />
                  ))}
                  {SPORTS_GENRES.length > 4 ? (
                    <button
                      type="button"
                      onClick={() => setShowMoreSports((v) => !v)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      {showMoreSports ? "Hide more" : "Show more"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-2 text-[11px] text-slate-500">
                Click chips to add/remove. Order is set by selection order (1st, 2nd, 3rd).
              </div>
            </div>

            {/* Destination (optional) */}
            <div>
              <div className="text-xs font-black text-slate-700">Destination city (optional)</div>
              <CityPicker
                cities={cities}
                valueCityId={destCityId}
                onPick={(c) => {
                  if (!c) {
                    setDestCityId("");
                    setDestCityLabelState("");
                    setDestLat(null);
                    setDestLon(null);
                    setDestAirportIata("");
                    return;
                  }
                  setDestCityId(c.id);
                  setDestCityLabelState(cityLabel(c));
                  setDestLat(c.lat);
                  setDestLon(c.lon);
                  setDestAirportIata((c.airportIata || "").toUpperCase());
                }}
                placeholder="Type a city (optional)"
              />
              {destCityLabelState ? <div className="mt-1 text-xs font-semibold text-slate-600">{destCityLabelState}</div> : null}
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-black text-slate-700">Start date</div>
                <input
                  type="date"
                  value={start}
                  min={minStart}
                  onChange={(e) => setStart(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900"
                />
              </div>
              <div>
                <div className="text-xs font-black text-slate-700">End date</div>
                <input
                  type="date"
                  value={end}
                  min={minEnd}
                  onChange={(e) => setEnd(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900"
                />
              </div>
            </div>

            {/* Trip days */}
            <div>
              <div className="text-xs font-black text-slate-700">Trip days (2–7)</div>
              <input
                type="text"
                inputMode="numeric"
                value={tripDaysText}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setTripDaysText("");
                    return;
                  }
                  if (!/^\d+$/.test(raw)) return;
                  setTripDaysText(raw);
                }}
                onBlur={() => {
                  const v = Number(tripDaysText);
                  if (!Number.isFinite(v)) {
                    setTripDaysText("4");
                    return;
                  }
                  setTripDaysText(String(clamp(Math.trunc(v), 2, 7)));
                }}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900"
              />
              <div className="mt-1 text-[11px] text-slate-500">Current: {tripDays} days</div>
            </div>

            {/* P1/P2 */}
            <div className="grid gap-3">
              <OptionPicker
                label="P1 (optional)"
                options={options}
                valueId={primaryId}
                valueLabel={primaryLabel}
                onPick={(opt) => {
                  if (!opt) {
                    setPrimaryId("");
                    setPrimaryLabel("");
                    return;
                  }
                  setPrimaryId(opt.id);
                  setPrimaryLabel(opt.label);
                }}
                placeholder="Type 2+ letters (e.g., Oilers, Dodgers, Luke)…"
              />

              <OptionPicker
                label="P2 (optional)"
                options={options}
                valueId={secondaryId}
                valueLabel={secondaryLabel}
                onPick={(opt) => {
                  if (!opt) {
                    setSecondaryId("");
                    setSecondaryLabel("");
                    return;
                  }
                  setSecondaryId(opt.id);
                  setSecondaryLabel(opt.label);
                }}
                placeholder="Type 2+ letters…"
              />
            </div>

            {/* Radius */}
            <div>
              <div className="text-xs font-black text-slate-700">Radius (miles)</div>
              <input
                type="text"
                inputMode="numeric"
                value={radiusText}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setRadiusText("");
                    return;
                  }
                  if (!/^\d+$/.test(raw)) return;
                  setRadiusText(raw);
                }}
                onBlur={() => {
                  const v = Number(radiusText);
                  if (!Number.isFinite(v)) {
                    setRadiusText("120");
                    return;
                  }
                  setRadiusText(String(clamp(Math.trunc(v), 1, 120)));
                }}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900"
              />
              <div className="mt-1 text-[11px] text-slate-500">Max 120 miles (UI cap for now).</div>
            </div>

            <button
              type="button"
              onClick={onSearch}
              className="mt-2 h-12 w-full rounded-2xl bg-slate-900 px-4 text-sm font-extrabold text-white hover:bg-slate-800"
            >
              Search
            </button>
          </div>
        </section>

        <div className="pb-6 pt-6 text-center text-xs text-slate-500">
          {APP_NAME} • {TAGLINE}
        </div>
      </div>
    </main>
  );
}