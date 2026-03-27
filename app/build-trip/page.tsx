"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { type Airport } from "../components/AirportPicker";
import SharedEventCard from "@/app/components/events/SharedEventCard";
import SharedEventDateGroup from "@/app/components/events/SharedEventDateGroup";
import DateField from "@/app/components/date/DateField";
import { isYMD, tomorrowYMD } from "@/lib/date/ymd";

/* -------------------- Types -------------------- */

type FavoriteKind = "team" | "artist" | "series";

type RowEvent = {
  date?: string | null;
  name?: string;
  location?: string;
  genre?: string | null;
  url?: string | null;
  lat?: number | null;
  lon?: number | null;
  localTime?: string | null;
};

type BuildTripPayload = {
  rowKey?: string;
  tripStyle?: string;
  destIata?: string;
  cityState?: string;
  startYMD?: string | null;
  endYMD?: string | null;
  radiusMiles?: number;
  countryCode?: string;
  airport?: string;
  anchor?: RowEvent;
  events?: RowEvent[];
};

type BuildTripApiResponse = {
  ok?: boolean;
  payload?: BuildTripPayload;
  error?: string;
  detail?: string;
  debug?: any;
};

type ShareApiResponse = {
  ok?: boolean;
  id?: string;
  trip?: BuildTripPayload;
  error?: string;
  detail?: string;
};

type CityOpt = {
  id?: string;
  label: string;
  lat: number;
  lon: number;
  country?: string | null;
  airportIata?: string | null;
};

type TravelState = {
  leavingFrom: string;
  leavingFromLat: string;
  leavingFromLon: string;
  leavingFromTouched: boolean;

  goingTo: string;
  goingToLat: string;
  goingToLon: string;
  goingToTouched: boolean;

  startDate: string;
  startTouched: boolean;

  endDate: string;
  endTouched: boolean;
};

const LS_SELECTED = "eventstack_selected_events_v1";
const LS_DELETED = "eventstack_deleted_events_v1";

/* -------------------- Small utils -------------------- */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function safeParseData(raw: string | null): any {
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

function unwrapBuildTripPayload(raw: any): BuildTripPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const maybePayload = (raw as any).payload;
  if (maybePayload && typeof maybePayload === "object") return maybePayload as BuildTripPayload;
  return raw as BuildTripPayload;
}

function norm(s: any) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function ymdToUTCDate(ymd?: string | null): Date | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function utcDateToYMD(dt: Date | null): string | null {
  if (!dt) return null;
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysUTC(ymd: string | null, deltaDays: number): string | null {
  const dt = ymdToUTCDate(ymd);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return utcDateToYMD(dt);
}

function fmtYMDPretty(ymd?: string | null) {
  const dt = ymdToUTCDate(ymd);
  if (!dt) return ymd || "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(dt);
}

function minMaxYMD(events: RowEvent[]) {
  const dates = events.map((e) => e.date).filter(Boolean) as string[];
  dates.sort();
  return { start: dates[0] || null, end: dates[dates.length - 1] || null };
}

function parseCityRegion(loc?: string | null) {
  const raw = String(loc || "").trim();
  if (!raw) return { city: "", region: "" };
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const city = parts[0] || raw;
  const region = parts[1] || "";
  return { city, region };
}

function uniqueCitiesInOrder(events: RowEvent[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of events) {
    const loc = String(e.location || "").trim();
    if (!loc) continue;
    const { city, region } = parseCityRegion(loc);
    const label = [city, region].filter(Boolean).join(", ").trim();
    if (!label) continue;
    const key = norm(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function pickDisplayCityState(citiesInOrder: string[]) {
  const cleaned = (citiesInOrder || []).map((x) => String(x || "").trim()).filter(Boolean);
  if (cleaned.length === 0) return "Your trip";
  if (cleaned.length === 1) return cleaned[0];
  return `${cleaned[0]} Area`;
}

function eventKey(e: RowEvent) {
  return [
    String(e.date || "").trim(),
    String(e.location || "").trim(),
    String(e.name || "").trim(),
    String(e.localTime || "").trim(),
    String(e.url || "").trim(),
  ].join("|");
}

function getSelectedEventIds(): string[] {
  try {
    const raw = localStorage.getItem(LS_SELECTED);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const ids = Object.keys(parsed).filter((k) => parsed[k]);
    ids.sort();
    return ids;
  } catch {
    return [];
  }
}

function readBooleanMap(key: string): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeBooleanMap(key: string, map: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}

function removeEventFromSelectedStorage(key: string) {
  if (typeof window === "undefined" || !key) return;
  try {
    const raw = localStorage.getItem(LS_SELECTED);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    if (!parsed[key]) return;
    delete parsed[key];
    localStorage.setItem(LS_SELECTED, JSON.stringify(parsed));
  } catch {}
}

function formatSectionDate(dateStr: string) {
  if (!isYMD(dateStr)) return dateStr;
  const d = new Date(`${dateStr}T12:00:00`);
  return d
    .toLocaleDateString("en-CA", {
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
    })
    .toUpperCase();
}

function formatTime12h(time: string | null) {
  if (!time) return "";

  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return time;

  const date = new Date();
  date.setHours(h);
  date.setMinutes(m || 0);

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function groupByDate(events: RowEvent[]) {
  const sorted = [...events].sort((a, b) => {
    const dateDiff = String(a.date || "").localeCompare(String(b.date || ""));
    if (dateDiff !== 0) return dateDiff;

    const aTime = String(a.localTime || "23:59");
    const bTime = String(b.localTime || "23:59");
    const timeDiff = aTime.localeCompare(bTime);
    if (timeDiff !== 0) return timeDiff;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const map = new Map<string, RowEvent[]>();
  for (const event of sorted) {
    const key = event.date || "Unknown Date";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(event);
  }

  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

/* -------------------- “Nearest major city” logic -------------------- */

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function tripCentroid(events: RowEvent[]) {
  const pts = (events || [])
    .map((e) => ({ lat: e.lat, lon: e.lon }))
    .filter((p) => typeof p.lat === "number" && typeof p.lon === "number") as Array<{
    lat: number;
    lon: number;
  }>;

  if (!pts.length) return null;

  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  return { lat, lon };
}

function airportTypeRank(t?: string | null) {
  const x = String(t || "").toLowerCase();
  if (x === "large_airport") return 3;
  if (x === "medium_airport") return 2;
  if (x === "small_airport") return 1;
  return 0;
}

function regionShort(region?: string | null) {
  const r = String(region || "").trim();
  if (!r) return "";
  const parts = r.split("-");
  return parts[1] || r;
}

function pickRepresentativeAirport(
  events: RowEvent[],
  airports: Airport[],
  opts?: { maxMiles?: number }
) {
  const c = tripCentroid(events);
  if (!c) return null;

  const maxMiles = opts?.maxMiles ?? 250;
  let best: { ap: Airport; score: number } | null = null;

  for (const ap of airports || []) {
    if (typeof (ap as any)?.lat !== "number" || typeof (ap as any)?.lon !== "number") continue;

    const dist = haversineMiles(c.lat, c.lon, (ap as any).lat, (ap as any).lon);
    if (dist > maxMiles) continue;

    const rank = airportTypeRank((ap as any)?.type);
    const score = dist - rank * 25;

    if (!best || score < best.score) best = { ap, score };
  }

  if (best) return best.ap;

  let nearest: { ap: Airport; dist: number } | null = null;
  for (const ap of airports || []) {
    if (typeof (ap as any)?.lat !== "number" || typeof (ap as any)?.lon !== "number") continue;
    const dist = haversineMiles(c.lat, c.lon, (ap as any).lat, (ap as any).lon);
    if (!nearest || dist < nearest.dist) nearest = { ap, dist };
  }
  return nearest?.ap || null;
}

function pickRepresentativeCity(
  events: RowEvent[],
  cities: CityOpt[],
  airports: Airport[],
  opts?: { maxMiles?: number }
) {
  const c = tripCentroid(events);
  if (!c) return null;

  const maxMiles = opts?.maxMiles ?? 250;

  const airportByIata = new Map<string, Airport>();
  for (const a of airports || []) {
    if ((a as any)?.iata) airportByIata.set(String((a as any).iata).toUpperCase(), a);
  }

  let best: { city: CityOpt; score: number } | null = null;

  for (const city of cities || []) {
    if (typeof city.lat !== "number" || typeof city.lon !== "number") continue;

    const dist = haversineMiles(c.lat, c.lon, city.lat, city.lon);
    if (dist > maxMiles) continue;

    const iata = String(city.airportIata || "").toUpperCase();
    const ap = iata ? airportByIata.get(iata) : undefined;
    const rank = airportTypeRank((ap as any)?.type);

    const score = dist - rank * 25;
    if (!best || score < best.score) best = { city, score };
  }

  if (best) return best.city;

  let nearest: { city: CityOpt; dist: number } | null = null;
  for (const city of cities || []) {
    if (typeof city.lat !== "number" || typeof city.lon !== "number") continue;
    const dist = haversineMiles(c.lat, c.lon, city.lat, city.lon);
    if (!nearest || dist < nearest.dist) nearest = { city, dist };
  }
  return nearest?.city || null;
}

/* -------------------- Expedia booking links -------------------- */

function ymdToExpediaMDY(ymd: string | null) {
  if (!ymd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return "";
  const mm = String(parseInt(m[2], 10));
  const dd = String(parseInt(m[3], 10));
  const yyyy = m[1];
  return `${mm}/${dd}/${yyyy}`;
}

function openExpediaHotels(destination: string, checkinYMD: string | null, checkoutYMD: string | null) {
  const dest = String(destination || "").trim();

  const qs = new URLSearchParams();
  qs.set("SearchType", "Destination");
  if (dest) qs.set("CityName", dest);
  if (checkinYMD) qs.set("InDate", checkinYMD);
  if (checkoutYMD) qs.set("OutDate", checkoutYMD);
  qs.set("NumRoom", "1");
  qs.set("NumAdult-Room1", "1");

  window.open(
    `https://www.expedia.ca/go/hotel/search/Destination?${qs.toString()}`,
    "_blank",
    "noopener,noreferrer"
  );
}

function openExpediaFlights(
  originCity: string,
  destinationCity: string,
  departYMD: string | null,
  returnYMD: string | null
) {
  const o = String(originCity || "").trim();
  const d = String(destinationCity || "").trim();
  const dep = ymdToExpediaMDY(departYMD);
  const ret = ymdToExpediaMDY(returnYMD);

  const qs = new URLSearchParams();
  qs.set("trip", "roundtrip");
  qs.set("passengers", "adults:1,children:0,infantinlap:N");
  qs.set("mode", "search");

  if (o && d && dep) qs.set("leg1", `from:${o},to:${d},departure:${dep}TANYT`);
  if (o && d && ret) qs.set("leg2", `from:${d},to:${o},departure:${ret}TANYT`);

  window.open(
    `https://www.expedia.com/Flights-Search?${qs.toString()}`,
    "_blank",
    "noopener,noreferrer"
  );
}

function openExpediaFlightHotelBundle(
  originCity: string,
  destinationCity: string,
  departYMD: string | null,
  returnYMD: string | null
) {
  const o = String(originCity || "").trim();
  const d = String(destinationCity || "").trim();

  if (!departYMD || !returnYMD || !o || !d) return;

  const qs = new URLSearchParams();
  qs.set("FromAirport", o);
  qs.set("Destination", d);
  qs.set("FromTime", "362");
  qs.set("ToTime", "362");
  qs.set("NumRoom", "1");
  qs.set("NumAdult", "1");

  window.open(
    `https://www.expedia.ca/go/package/search/FlightHotel/${departYMD}/${returnYMD}?${qs.toString()}`,
    "_blank",
    "noopener,noreferrer"
  );
}

/* -------------------- Sharing -------------------- */

async function createShareLink(payload: any) {
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      version: 1,
      trip: payload,
    }),
  });

  const j = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    console.error("Share route error response:", j);
    throw new Error(j?.detail || j?.error || `Share failed (${res.status})`);
  }

  const id = String(j?.id || j?.tripId || j?.rowKey || "").trim();
  if (!id) {
    console.error("Share response missing id:", j);
    throw new Error("Share id missing.");
  }

return `${window.location.origin}/build-trip?share=${encodeURIComponent(id)}`;
}

async function shareUrl(url: string) {
  const navAny = navigator as any;
  if (navAny?.share) {
    try {
      await navAny.share({
        title: "Trip Plan",
        text: "Check this out! We'd be crazy not to ... right!?",
        url,
      });
      return { ok: true, method: "native" as const };
    } catch {
      // fall through
    }
  }

  await navigator.clipboard.writeText(url);
  return { ok: true, method: "clipboard" as const };
}

/* -------------------- Reusable controls -------------------- */

function ComboBox<T extends { label: string }>(props: {
  value: string;
  placeholder?: string;
  options: T[];
  onChange: (next: string) => void;
  onPick: (opt: T) => void;
  disabled?: boolean;
  renderOption?: (opt: T, active: boolean) => React.ReactNode;
}) {
  const { value, placeholder, options, onChange, onPick, disabled, renderOption } = props;
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

  const showList = open && !disabled;

  return (
    <div ref={wrapRef} className="relative min-w-0">
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
          "h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none",
          "focus:border-slate-400",
          disabled && "cursor-not-allowed bg-slate-100 text-slate-500"
        )}
      />

      {showList && filtered.length > 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div ref={listRef} className="max-h-80 overflow-y-auto overscroll-contain py-1">
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
        </div>
      ) : null}
    </div>
  );
}

/* -------------------- Icons -------------------- */

function ShareIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 12v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 7.5 12 4l3.5 3.5" />
    </svg>
  );
}

function SaveIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3-6 3V4.75Z"
      />
    </svg>
  );
}

function MapPinIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-4.35 7-11a7 7 0 1 0-14 0c0 6.65 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.75" />
    </svg>
  );
}

function CalendarIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  );
}

function TravelField(props: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3 shadow-sm">
      <div className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-3">
        <div className="pt-[22px] text-slate-700">{props.icon}</div>

        <div className="min-w-0">
          <div className="mb-1 text-[11px] font-semibold text-slate-500">{props.label}</div>
          <div className="min-w-0">{props.children}</div>
        </div>
      </div>
    </div>
  );
}

/* -------------------- Page -------------------- */

export default function BuildTripPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const dataParam = sp.get("data");
  const shareIdParam = (sp.get("share") || "").trim();
  const dataFromParam = useMemo(() => unwrapBuildTripPayload(safeParseData(dataParam)), [dataParam]);

  const tripStyle = (sp.get("tripStyle") || "A").toUpperCase();
  const destIata = (sp.get("destIata") || "").trim().toUpperCase();
  const cityLabel = (sp.get("cityLabel") || "").trim();
  const cityLat = Number(sp.get("lat") || "");
  const cityLon = Number(sp.get("lon") || "");
  const start = (sp.get("start") || "").trim();
  const end = (sp.get("end") || "").trim();
  const radiusMiles = Number(sp.get("radiusMiles") || 120) || 120;
  const countryCode = (sp.get("countryCode") || "US,CA").trim() || "US,CA";

  const f1Label = (sp.get("f1Label") || "").trim();
  const f1Kind = ((sp.get("f1Kind") || "team").trim().toLowerCase() || "team") as FavoriteKind;
  const f1AttractionId = (sp.get("f1AttractionId") || "").trim();
  const f1SeriesKey = (sp.get("f1SeriesKey") || "").trim();
  const f1DefaultGenre = (sp.get("f1DefaultGenre") || "").trim();

  const f2Label = (sp.get("f2Label") || "").trim();
  const f2Kind = ((sp.get("f2Kind") || "team").trim().toLowerCase() || "team") as FavoriteKind;
  const f2AttractionId = (sp.get("f2AttractionId") || "").trim();
  const f2SeriesKey = (sp.get("f2SeriesKey") || "").trim();
  const f2DefaultGenre = (sp.get("f2DefaultGenre") || "").trim();

  const genresCsv = (sp.get("genres") || "").trim();

  const [built, setBuilt] = useState<BuildTripPayload | null>(dataFromParam);
  const [builtLoading, setBuiltLoading] = useState(false);
  const [builtError, setBuiltError] = useState("");

  const [airports, setAirports] = useState<Airport[]>([]);
  const [citiesList, setCitiesList] = useState<CityOpt[]>([]);

  const [travel, setTravel] = useState<TravelState>({
    leavingFrom: "",
    leavingFromLat: "",
    leavingFromLon: "",
    leavingFromTouched: false,

    goingTo: "",
    goingToLat: "",
    goingToLon: "",
    goingToTouched: false,

    startDate: "",
    startTouched: false,

    endDate: "",
    endTouched: false,
  });

  const [dismissedMap, setDismissedMap] = useState<Record<string, boolean>>({});
  const [lastDismissed, setLastDismissed] = useState<RowEvent | null>(null);

  useEffect(() => {
    setDismissedMap(readBooleanMap(LS_DELETED));
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (dataFromParam) {
      setBuilt(dataFromParam);
      setBuiltError("");
      setBuiltLoading(false);
      return;
    }

    if (!shareIdParam) return;

    (async () => {
      setBuiltLoading(true);
      setBuiltError("");

      try {
        const res = await fetch(`/api/share?id=${encodeURIComponent(shareIdParam)}`, {
          method: "GET",
          cache: "no-store",
        });

        const json = (await res.json().catch(() => ({}))) as ShareApiResponse;

        if (cancelled) return;

        if (!res.ok) {
          throw new Error(json?.error || json?.detail || `Share load failed (${res.status})`);
        }

        const payload = json?.trip;
        if (!payload || typeof payload !== "object") {
          throw new Error("Shared trip payload was empty.");
        }

        setBuilt(payload);
      } catch (e: any) {
        if (cancelled) return;
        setBuilt(null);
        setBuiltError(e?.message || "Failed to load shared trip.");
      } finally {
        if (!cancelled) setBuiltLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataFromParam, shareIdParam]);

  useEffect(() => {
    if (dataFromParam || shareIdParam) return;

    if (tripStyle !== "A" && tripStyle !== "B") {
      setBuilt(null);
      setBuiltError("This page is intended for TripStyle A or B.");
      setBuiltLoading(false);
      return;
    }

    const hasDestIata = destIata.length === 3;
    const hasCityAnchor = !!cityLabel || (Number.isFinite(cityLat) && Number.isFinite(cityLon));

    if (!hasDestIata && !hasCityAnchor) {
      setBuilt(null);
      setBuiltError("Missing destination context. Go back and re-run your search.");
      setBuiltLoading(false);
      return;
    }

    if (!isYMD(start) || !isYMD(end)) {
      setBuilt(null);
      setBuiltError("Missing/invalid start/end. Go back and pick valid dates.");
      setBuiltLoading(false);
      return;
    }

    const ids = getSelectedEventIds();
    if (ids.length === 0) {
      setBuilt(null);
      setBuiltError("No events selected. Go back and check a few events first.");
      setBuiltLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setBuiltLoading(true);
      setBuiltError("");

      try {
        const res = await fetch("/api/build-trip", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            tripStyle: "A",
            destIata,
            cityLabel,
            lat: Number.isFinite(cityLat) ? cityLat : null,
            lon: Number.isFinite(cityLon) ? cityLon : null,
            start,
            end,
            radiusMiles,
            countryCode,
            eventIds: ids,
          }),
        });

        const json = (await res.json().catch(() => ({}))) as BuildTripApiResponse | BuildTripPayload;
        if (cancelled) return;

        if (!res.ok) throw new Error((json as any)?.error || `Build-trip failed (${res.status})`);

        const payload = unwrapBuildTripPayload(json);
        if (!payload) throw new Error("Build-trip payload was empty.");

        setBuilt(payload);
      } catch (e: any) {
        if (cancelled) return;
        setBuilt(null);
        setBuiltError(e?.message || "Failed to build trip");
      } finally {
        if (!cancelled) setBuiltLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataFromParam, shareIdParam, tripStyle, destIata, cityLabel, cityLat, cityLon, start, end, radiusMiles, countryCode]);

  /* -------------------- Load datasets -------------------- */

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

  useEffect(() => {
    let cancelled = false;

    fetch("/cities.json")
      .then((r) => r.json())
      .then((list: CityOpt[]) => {
        if (cancelled) return;
        setCitiesList(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (cancelled) return;
        setCitiesList([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!lastDismissed) return;

    const t = window.setTimeout(() => {
      setLastDismissed(null);
    }, 5000);

    return () => window.clearTimeout(t);
  }, [lastDismissed]);

  /* -------------------- Derived values -------------------- */

  const events: RowEvent[] = useMemo(() => {
    const e = built?.events;
    return Array.isArray(e) ? (e as RowEvent[]) : [];
  }, [built]);

  const visibleEvents = useMemo(() => {
    return events.filter((e) => !dismissedMap[eventKey(e)]);
  }, [events, dismissedMap]);

  const groupedEvents = useMemo(() => groupByDate(visibleEvents), [visibleEvents]);

  const representativeAirport = useMemo(() => {
    if (!visibleEvents.length) return null;
    if (!airports.length) return null;
    return pickRepresentativeAirport(visibleEvents, airports, { maxMiles: 250 });
  }, [visibleEvents, airports]);

  const representativeCityLabel = useMemo(() => {
    if (!representativeAirport) return null;
    const city = String((representativeAirport as any)?.city || "").trim();
    const reg = regionShort((representativeAirport as any)?.region);
    const label = [city, reg].filter(Boolean).join(", ").trim();
    return label || null;
  }, [representativeAirport]);

  const representativeCity = useMemo(() => {
    if (!visibleEvents.length) return null;
    if (!citiesList.length) return null;
    return pickRepresentativeCity(visibleEvents, citiesList, airports, { maxMiles: 250 });
  }, [visibleEvents, citiesList, airports]);

  const cities = useMemo(() => uniqueCitiesInOrder(visibleEvents), [visibleEvents]);

  const displayCityState = useMemo(() => {
    if (cityLabel) return cityLabel;

    const cs = String(built?.cityState || "").trim();
    if (cs) return cs;

    if (representativeCityLabel) return representativeCityLabel;
    if (representativeCity?.label) return representativeCity.label;

    return pickDisplayCityState(cities);
  }, [cityLabel, built?.cityState, representativeCityLabel, representativeCity, cities]);

  const { start: minStart, end: minEnd } = useMemo(() => minMaxYMD(visibleEvents), [visibleEvents]);

  const eventStart = useMemo(() => {
    if (isYMD(minStart)) return minStart;
    const b = String(built?.startYMD || "");
    return isYMD(b) ? (b as string) : null;
  }, [minStart, built?.startYMD]);

  const eventEnd = useMemo(() => {
    if (isYMD(minEnd)) return minEnd;
    const b = String(built?.endYMD || "");
    return isYMD(b) ? (b as string) : null;
  }, [minEnd, built?.endYMD]);

  const defaultCheckin = useMemo(() => addDaysUTC(eventStart, -1), [eventStart]);
  const defaultCheckout = useMemo(() => addDaysUTC(eventEnd, +1), [eventEnd]);

  const defaultDestinationCity = useMemo(() => {
    const exact = citiesList.find((c) => norm(c.label) === norm(displayCityState));
    if (exact) return exact;

    const prefix = citiesList.find((c) => {
      const label = norm(c.label);
      const raw = norm(displayCityState);
      return label.startsWith(raw) || raw.startsWith(label);
    });
    if (prefix) return prefix;

    if (representativeCity?.label) {
      const rep = citiesList.find((c) => norm(c.label) === norm(representativeCity.label));
      if (rep) return rep;
    }

    return null;
  }, [citiesList, displayCityState, representativeCity]);

  /* -------------------- Initialize editable travel controls -------------------- */

  useEffect(() => {
    if (!built && !dataFromParam && !shareIdParam) return;

    setTravel((s) => ({
      ...s,

      leavingFrom: s.leavingFromTouched ? s.leavingFrom : "",
      leavingFromLat: s.leavingFromTouched ? s.leavingFromLat : "",
      leavingFromLon: s.leavingFromTouched ? s.leavingFromLon : "",

      goingTo: s.goingToTouched
        ? s.goingTo
        : String(defaultDestinationCity?.label || displayCityState || "").trim(),
      goingToLat: s.goingToTouched
        ? s.goingToLat
        : defaultDestinationCity && Number.isFinite(defaultDestinationCity.lat)
        ? String(defaultDestinationCity.lat)
        : "",
      goingToLon: s.goingToTouched
        ? s.goingToLon
        : defaultDestinationCity && Number.isFinite(defaultDestinationCity.lon)
        ? String(defaultDestinationCity.lon)
        : "",

      startDate: s.startTouched ? s.startDate : String(defaultCheckin || ""),
      endDate: s.endTouched ? s.endDate : String(defaultCheckout || ""),
    }));
  }, [built, dataFromParam, shareIdParam, defaultDestinationCity, displayCityState, defaultCheckin, defaultCheckout]);

  const pickedDestinationCity = useMemo(() => {
    const byLabel = citiesList.find((c) => norm(c.label) === norm(travel.goingTo));
    if (byLabel) return byLabel;

    const latN = Number(travel.goingToLat);
    const lonN = Number(travel.goingToLon);
    if (Number.isFinite(latN) && Number.isFinite(lonN)) {
      const byCoords = citiesList.find((c) => c.lat === latN && c.lon === lonN);
      if (byCoords) return byCoords;
    }

    return null;
  }, [citiesList, travel.goingTo, travel.goingToLat, travel.goingToLon]);

  const destinationQuery = useMemo(() => {
    return String(pickedDestinationCity?.label || travel.goingTo || displayCityState || "").trim();
  }, [pickedDestinationCity, travel.goingTo, displayCityState]);

  const hasOrigin = Boolean(String(travel.leavingFrom || "").trim());
  const hasDestination = Boolean(String(destinationQuery || "").trim());

  /* -------------------- Share + Save state -------------------- */

  const [shareBusy, setShareBusy] = useState(false);
  const [shareNote, setShareNote] = useState("");

  const [saveBusy, setSaveBusy] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveUrl, setSaveUrl] = useState("");
  const [saveNote, setSaveNote] = useState("");

  function buildSharePayload() {
    return {
      ...built,
      airport: travel.leavingFrom ? String(travel.leavingFrom).trim() : built?.airport || "",
      destIata: built?.destIata || destIata,
      cityState: destinationQuery || built?.cityState || "",
      startYMD: travel.startDate || built?.startYMD || "",
      endYMD: travel.endDate || built?.endYMD || "",
      radiusMiles: built?.radiusMiles ?? radiusMiles,
      countryCode: built?.countryCode ?? countryCode,
      events: visibleEvents,
    };
  }

  async function onShare() {
    if (!built || builtLoading || builtError) return;

    setShareBusy(true);
    setShareNote("");

    try {
      const url = await createShareLink(buildSharePayload());
      const r = await shareUrl(url);

      setShareNote(r.method === "native" ? "Shared." : "Link copied.");
      window.setTimeout(() => setShareNote(""), 2500);
    } catch (e: any) {
      setShareNote(e?.message || "Share failed.");
      window.setTimeout(() => setShareNote(""), 3500);
    } finally {
      setShareBusy(false);
    }
  }

  async function onSave() {
    if (!built || builtLoading || builtError) return;

    setSaveBusy(true);
    setSaveNote("");

    try {
      const url = await createShareLink(buildSharePayload());
      setSaveUrl(url);
      setSaveModalOpen(true);
    } catch (e: any) {
      setSaveNote(e?.message || "Save link failed.");
      window.setTimeout(() => setSaveNote(""), 3500);
    } finally {
      setSaveBusy(false);
    }
  }

  async function onCopySaveLink() {
    if (!saveUrl) return;

    try {
      await navigator.clipboard.writeText(saveUrl);
      setSaveNote("Link copied. Bookmark it to save your trip.");
      window.setTimeout(() => setSaveNote(""), 2500);
    } catch {
      setSaveNote("Could not copy link.");
      window.setTimeout(() => setSaveNote(""), 2500);
    }
  }

  const shareDisabled = !built || builtLoading || Boolean(builtError) || shareBusy;
  const saveDisabled = !built || builtLoading || Boolean(builtError) || saveBusy;

  function onDismissEvent(e: RowEvent) {
    const key = eventKey(e);

    setDismissedMap((prev) => {
      const next = { ...prev, [key]: true };
      writeBooleanMap(LS_DELETED, next);
      return next;
    });

    removeEventFromSelectedStorage(key);
    setLastDismissed(e);
  }

  function onUndoDismiss() {
    if (!lastDismissed) return;

    const key = eventKey(lastDismissed);
    setDismissedMap((prev) => {
      const next = { ...prev };
      delete next[key];
      writeBooleanMap(LS_DELETED, next);
      return next;
    });

    setLastDismissed(null);
  }

  function renderTripEventCard(e: RowEvent) {
    const whereCityRegion = (() => {
      const raw = String(e.location || "").trim();
      if (!raw) return "Location TBD";
      return raw;
    })();

    const pill = String(e.genre || "").trim();

    return (
      <SharedEventCard
        title={e.name || "Untitled event"}
        subtitle={`${whereCityRegion}${e.localTime ? ` • ${formatTime12h(e.localTime)}` : ""}`}
        primaryPill={pill || null}
        ticketHref={e.url || null}
        showTickets
        selected
        onRemove={() => onDismissEvent(e)}
        removeAriaLabel="Remove event from trip"
      />
    );
  }

  function buildBackToEventsUrl() {
    const q = new URLSearchParams();

    if (cityLabel) q.set("cityLabel", cityLabel);
    if (Number.isFinite(cityLat)) q.set("lat", String(cityLat));
    if (Number.isFinite(cityLon)) q.set("lon", String(cityLon));
    if (start) q.set("start", start);
    if (end) q.set("end", end);
    if (radiusMiles) q.set("radiusMiles", String(radiusMiles));
    if (countryCode) q.set("countryCode", countryCode);

    if (f1Label) q.set("f1Label", f1Label);
    if (f1Kind) q.set("f1Kind", f1Kind);
    if (f1AttractionId) q.set("f1AttractionId", f1AttractionId);
    if (f1SeriesKey) q.set("f1SeriesKey", f1SeriesKey);
    if (f1DefaultGenre) q.set("f1DefaultGenre", f1DefaultGenre);

    if (f2Label) q.set("f2Label", f2Label);
    if (f2Kind) q.set("f2Kind", f2Kind);
    if (f2AttractionId) q.set("f2AttractionId", f2AttractionId);
    if (f2SeriesKey) q.set("f2SeriesKey", f2SeriesKey);
    if (f2DefaultGenre) q.set("f2DefaultGenre", f2DefaultGenre);

    if (genresCsv) q.set("genres", genresCsv);

    return `/events?${q.toString()}`;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-6xl lg:py-8">
        {builtLoading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              <div className="text-sm font-semibold text-slate-700">
                {shareIdParam ? "Loading shared trip…" : "Building trip…"}
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {shareIdParam ? "Loading trip from share link." : "Using your selected events."}
            </div>
          </section>
        ) : builtError ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
            <div className="text-sm font-black">Can’t build trip.</div>
            <div className="mt-2 text-sm font-semibold text-rose-700">{builtError}</div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  if (window.history.length > 1) router.back();
                  else router.push(buildBackToEventsUrl());
                }}
                className="h-11 w-full rounded-2xl bg-slate-900 text-sm font-extrabold text-white hover:bg-slate-800"
              >
                Back to events
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white text-sm font-extrabold text-slate-800 hover:bg-slate-50"
              >
                Back to search
              </button>
            </div>
          </section>
        ) : (
          <>
            {/* ACTION BUTTONS (above card) */}

<div className="mb-3 flex justify-end">
  <div className="flex items-center gap-3">
    <button
      type="button"
      disabled={saveDisabled}
      onClick={onSave}
      className={cx(
        "inline-flex h-12 w-12 items-center justify-center rounded-full border shadow-md transition",
        saveDisabled
          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
          : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50 active:scale-95"
      )}
      title={saveBusy ? "Preparing save link…" : "Save this trip"}
      aria-label="Save this trip"
    >
      <SaveIcon className="h-5 w-5" />
    </button>

    <button
      type="button"
      disabled={shareDisabled}
      onClick={onShare}
      className={cx(
        "inline-flex h-12 w-12 items-center justify-center rounded-full border shadow-md transition",
        shareDisabled
          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
          : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50 active:scale-95"
      )}
      title={shareBusy ? "Sharing…" : "Share this trip"}
      aria-label="Share this trip"
    >
      <ShareIcon className="h-5 w-5" />
    </button>
  </div>
</div>
            
            <section className="mb-5 rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-8 sm:py-7">
              <div>
                <div className="min-w-0">
                  <h1 className="text-[1.75rem] font-black leading-tight tracking-tight text-slate-900 sm:text-4xl">
                    {destinationQuery || displayCityState}
                  </h1>

                  <div className="mt-2 text-sm font-semibold text-slate-600 sm:text-base">
                    {travel.startDate ? fmtYMDPretty(travel.startDate) : "—"} →{" "}
                    {travel.endDate ? fmtYMDPretty(travel.endDate) : "—"}
                  </div>
                </div>

                
              </div>
            </section>

            {!!shareNote && (
              <div className="mb-4 text-right text-xs font-semibold text-slate-600">
                {shareNote}
              </div>
            )}

            {!!saveNote && !saveModalOpen && (
              <div className="mb-4 text-right text-xs font-semibold text-slate-600">
                {saveNote}
              </div>
            )}

            <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-4">
  <h2 className="text-[1.1rem] font-black uppercase tracking-[0.18em] text-slate-900">
    TICKET LINKS
  </h2>
  <p className="mt-1 text-sm font-semibold text-slate-600">
    (for your convenience)
  </p>
</div>

              {visibleEvents.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  No events currently in this trip.
                </div>
              ) : (
                <div className="space-y-3">
                  {groupedEvents.map(([date, items]) => (
                    <SharedEventDateGroup
                      key={date}
                      title={formatSectionDate(date)}
                      className="mb-[14px]"
                    >
                      {items.map((e) => (
                        <React.Fragment key={eventKey(e)}>{renderTripEventCard(e)}</React.Fragment>
                      ))}
                    </SharedEventDateGroup>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4">
  <h2 className="text-[1.1rem] font-black uppercase tracking-[0.18em] text-slate-900">
    TRAVEL LINKS
  </h2>
  <p className="mt-1 text-sm font-semibold text-slate-600">
    (for your convenience)
  </p>
</div>

              <div className="grid gap-3 lg:grid-cols-4">
                <TravelField label="Leaving from" icon={<MapPinIcon />}>
                  <ComboBox<CityOpt>
                    value={travel.leavingFrom}
                    placeholder="Type a city…"
                    options={citiesList}
                    onChange={(next) =>
                      setTravel((s) => ({
                        ...s,
                        leavingFrom: next,
                        leavingFromLat: "",
                        leavingFromLon: "",
                        leavingFromTouched: true,
                      }))
                    }
                    onPick={(opt) =>
                      setTravel((s) => ({
                        ...s,
                        leavingFrom: opt.label,
                        leavingFromLat: String(opt.lat),
                        leavingFromLon: String(opt.lon),
                        leavingFromTouched: true,
                      }))
                    }
                  />
                </TravelField>

                <TravelField label="Going to" icon={<MapPinIcon />}>
                  <ComboBox<CityOpt>
                    value={travel.goingTo}
                    placeholder="Type a city…"
                    options={citiesList}
                    onChange={(next) =>
                      setTravel((s) => ({
                        ...s,
                        goingTo: next,
                        goingToLat: "",
                        goingToLon: "",
                        goingToTouched: true,
                      }))
                    }
                    onPick={(opt) =>
                      setTravel((s) => ({
                        ...s,
                        goingTo: opt.label,
                        goingToLat: String(opt.lat),
                        goingToLon: String(opt.lon),
                        goingToTouched: true,
                      }))
                    }
                  />
                </TravelField>

                <TravelField label="Start date" icon={<CalendarIcon />}>
                  <DateField
                    value={travel.startDate}
                    min={tomorrowYMD()}
                    placeholder="Select date"
                    onChange={(next) =>
                      setTravel((s) => ({
                        ...s,
                        startDate: next,
                        startTouched: true,
                        endDate:
                          s.endTouched || !isYMD(s.endDate) || (isYMD(s.endDate) && s.endDate >= next)
                            ? s.endDate
                            : next,
                      }))
                    }
                  />
                </TravelField>

                <TravelField label="End date" icon={<CalendarIcon />}>
                  <DateField
                    value={travel.endDate}
                    min={travel.startDate && isYMD(travel.startDate) ? travel.startDate : undefined}
                    placeholder="Select date"
                    onChange={(next) =>
                      setTravel((s) => ({
                        ...s,
                        endDate: next,
                        endTouched: true,
                      }))
                    }
                  />
                </TravelField>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={!hasDestination}
                  onClick={() => {
                    if (!hasDestination) return;
                    openExpediaHotels(destinationQuery, travel.startDate || null, travel.endDate || null);
                  }}
                  className={cx(
                    "inline-flex h-10 items-center justify-center rounded-2xl px-5 text-sm font-extrabold transition",
                    hasDestination
                      ? "bg-slate-900 text-white hover:bg-slate-800"
                      : "cursor-not-allowed bg-slate-200 text-slate-400"
                  )}
                >
                  Hotels
                </button>

                <button
                  type="button"
                  disabled={!hasOrigin || !hasDestination}
                  onClick={() => {
                    if (!hasOrigin || !hasDestination) return;
                    openExpediaFlights(
                      travel.leavingFrom,
                      destinationQuery,
                      travel.startDate || null,
                      travel.endDate || null
                    );
                  }}
                  className={cx(
                    "inline-flex h-10 items-center justify-center rounded-2xl px-5 text-sm font-extrabold transition",
                    hasOrigin && hasDestination
                      ? "bg-slate-900 text-white hover:bg-slate-800"
                      : "cursor-not-allowed bg-slate-200 text-slate-400"
                  )}
                >
                  Flights
                </button>

                <button
                  type="button"
                  disabled={!hasOrigin || !hasDestination}
                  onClick={() => {
                    if (!hasOrigin || !hasDestination) return;
                    openExpediaFlightHotelBundle(
                      travel.leavingFrom,
                      destinationQuery,
                      travel.startDate || null,
                      travel.endDate || null
                    );
                  }}
                  className={cx(
                    "inline-flex h-10 items-center justify-center rounded-2xl px-5 text-sm font-extrabold transition",
                    hasOrigin && hasDestination
                      ? "bg-slate-900 text-white hover:bg-slate-800"
                      : "cursor-not-allowed bg-slate-200 text-slate-400"
                  )}
                >
                  Packages
                </button>
              </div>
            </section>

            {saveModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
                <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-black text-slate-900">Save this trip</h2>
                      <p className="mt-2 text-sm font-medium text-slate-600">
                        Copy or bookmark this link to come back to your trip anytime.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSaveModalOpen(false)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      aria-label="Close save dialog"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="mt-5">
                    <input
                      value={saveUrl}
                      readOnly
                      className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-800 outline-none"
                    />
                  </div>

                  {!!saveNote && (
                    <div className="mt-3 text-xs font-semibold text-slate-600">
                      {saveNote}
                    </div>
                  )}

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={onCopySaveLink}
                      className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-900 px-4 text-sm font-extrabold text-white hover:bg-slate-800"
                    >
                      Copy Link
                    </button>

                    <button
                      type="button"
                      onClick={() => setSaveModalOpen(false)}
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {lastDismissed && (
              <div className="sticky bottom-[68px] z-20 px-3 pb-2 pt-0">
                <div className="mx-auto flex max-w-[860px] items-center justify-between gap-3 rounded-[14px] bg-[#071b3b] px-3 py-2.5 text-white shadow-[0_8px_22px_rgba(7,27,59,0.22)]">
                  <div className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-bold">
                    Event removed: {lastDismissed.name}
                  </div>

                  <button
                    type="button"
                    onClick={onUndoDismiss}
                    className="h-8 shrink-0 rounded-full border border-white/35 bg-white px-3 text-[13px] font-extrabold text-[#071b3b]"
                  >
                    Undo
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}