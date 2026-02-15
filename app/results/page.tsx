// FILE: app/results/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type ApiResponse = {
  count?: number;
  occurrences?: any[];
  error?: string;
  debug?: any;
  fallback?: {
    mode?: string;
    schedules?: Array<{ label: string; events: any[] }>;
  };
};

type Airport = {
  iata: string;
  name: string;
  city: string;
  region: string; // e.g. "CA-BC" or "US-NY"
  country: string; // e.g. "CA" or "US"
  lat: number | null;
  lon: number | null;
};

/* -------------------- Public-mode limits (keep in sync with app/page + api/search) -------------------- */

const PUBLIC_MODE = true;
const PUBLIC_PRESET = {
  maxDays: 7,
  maxRadiusMiles: 300,
} as const;

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(x)));
}

/* -------------------- Query helpers -------------------- */

function stripDeprecatedParams(sp: ReturnType<typeof useSearchParams>) {
  const qs = new URLSearchParams(sp.toString());
  qs.delete("p4"); // legacy
  return qs;
}

/* -------------------- Date helpers -------------------- */

function parseYMDToUTC(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

const fmtUTC = (dt: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(dt);

function formatRangePretty(startYMD: string, endYMD: string): string {
  const s = parseYMDToUTC(startYMD);
  const e = parseYMDToUTC(endYMD);
  if (!s || !e) return "Date TBD";

  const sm = fmtUTC(s, { month: "long" });
  const em = fmtUTC(e, { month: "long" });
  const sd = fmtUTC(s, { day: "numeric" });
  const ed = fmtUTC(e, { day: "numeric" });
  const sy = fmtUTC(s, { year: "numeric" });
  const ey = fmtUTC(e, { year: "numeric" });

  if (startYMD === endYMD) return `${sm} ${sd}, ${sy}`;
  if (sy === ey) {
    if (sm === em) return `${sm} ${sd}-${ed}, ${sy}`;
    return `${sm} ${sd}-${em} ${ed}, ${sy}`;
  }
  return `${sm} ${sd}, ${sy}-${em} ${ed}, ${ey}`;
}

function ymdToDMY(ymd: string): string | null {
  const dt = parseYMDToUTC(ymd);
  if (!dt) return null;
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(dt.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function addDaysUTC(ymd: string, deltaDays: number): string | null {
  const dt = parseYMDToUTC(ymd);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const y = String(dt.getUTCFullYear());
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* -------------------- Expedia deep links -------------------- */

function buildExpediaHotelSearchUrl(opts: {
  destinationLabel: string; // e.g. "Toronto, ON"
  checkInYMD: string;
  checkOutYMD: string;
  adults?: number;
}) {
  const adults = opts.adults ?? 2;
  const params = new URLSearchParams({
    adults: String(adults),
    destination: opts.destinationLabel,
    startDate: opts.checkInYMD,
    endDate: opts.checkOutYMD,
    d1: opts.checkInYMD,
    d2: opts.checkOutYMD,
  });
  return `https://www.expedia.ca/Hotel-Search?${params.toString()}`;
}

function buildExpediaFlightsOnlyUrl(opts: {
  fromIata: string;
  toIata: string;
  departYMD: string;
  returnYMD: string;
  adults?: number;
}) {
  const adults = opts.adults ?? 2;

  const d1 = ymdToDMY(opts.departYMD);
  const d2 = ymdToDMY(opts.returnYMD);
  if (!d1 || !d2) return null;

  const leg1 = `from:${opts.fromIata},to:${opts.toIata},departure:${d1}TANYT`;
  const leg2 = `from:${opts.toIata},to:${opts.fromIata},departure:${d2}TANYT`;

  const params = new URLSearchParams({
    trip: "roundtrip",
    leg1,
    leg2,
    mode: "search",
    options: "cabinclass:economy",
    passengers: `adults:${adults},children:0,seniors:0,infantinlap:N`,
  });

  return `https://www.expedia.ca/Flights-Search?${params.toString()}`;
}

function buildExpediaFlightHotelPackageUrl(opts: {
  fromAirport: string; // IATA
  destination: string; // best: destination IATA; fallback: "City, ST"
  fromDateYMD: string;
  toDateYMD: string;
  numAdult?: number;
  numRoom?: number;
}) {
  const numAdult = opts.numAdult ?? 2;
  const numRoom = opts.numRoom ?? 1;

  const params = new URLSearchParams({
    FromAirport: opts.fromAirport,
    Destination: opts.destination,
    NumAdult: String(numAdult),
    NumRoom: String(numRoom),
  });

  return `https://www.expedia.ca/go/package/search/FlightHotel/${opts.fromDateYMD}/${opts.toDateYMD}?${params.toString()}`;
}

/* -------------------- Event helpers -------------------- */

const getEventLocalDate = (e: any) => e?.dates?.start?.localDate ?? null;
const getEventLocalTime = (e: any) => e?.dates?.start?.localTime ?? null;

function formatEventDateMMMDDYYYY(d: string | null) {
  const dt = d ? parseYMDToUTC(d) : null;
  if (!dt) return "";
  const mm = fmtUTC(dt, { month: "short" });
  const dd = fmtUTC(dt, { day: "2-digit" });
  const yyyy = fmtUTC(dt, { year: "numeric" });
  return `${mm} ${dd}`;
}

function formatEventTimeLower(t: string | null) {
  if (!t) return "";
  const m = /^(\d{2}):(\d{2})/.exec(t);
  if (!m) return t;
  let hh = +m[1];
  const mm = m[2];
  const ampm = hh >= 12 ? "pm" : "am";
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${mm}${ampm}`; // e.g., 8:00pm
}

const eventId = (e: any) => e?.id ?? null;
const eventTitle = (e: any) => e?.name ?? "";
const eventUrl = (e: any) => e?.url ?? null;

function eventVenueCityState(e: any) {
  const v = e?._embedded?.venues?.[0];
  const city = v?.city?.name;
  const st = v?.state?.stateCode;
  if (!city || !st) return null;
  return `${city}, ${st}`;
}

function eventVenueKey(e: any) {
  const v = e?._embedded?.venues?.[0];
  const nm = (v?.name || "").trim().toLowerCase();
  const city = (v?.city?.name || "").trim().toLowerCase();
  const st = (v?.state?.stateCode || "").trim().toUpperCase();
  return `${nm}|${city}|${st}`;
}

function normalizeTitleForDedup(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function eventSortKey(e: any) {
  const d = getEventLocalDate(e);
  const t = getEventLocalTime(e);
  const dKey = d ? Number(String(d).replace(/-/g, "")) : 99999999;

  const m = t ? /^(\d{2}):(\d{2})/.exec(t) : null;
  const tKey = m ? +m[1] * 60 + +m[2] : 999999;

  return dKey * 100000 + tKey;
}

/* -------------------- Geo + clustering helpers (for P1=P2) -------------------- */

function getEventLatLon(e: any): { lat: number; lon: number } | null {
  const v = e?._embedded?.venues?.[0];
  const lat = v?.location?.latitude;
  const lon = v?.location?.longitude;
  const la = lat != null ? Number(lat) : NaN;
  const lo = lon != null ? Number(lon) : NaN;
  if (Number.isFinite(la) && Number.isFinite(lo)) return { lat: la, lon: lo };
  return null;
}

function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 3958.7613; // miles
  const toRad = (x: number) => (x * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLon / 2) ** 2);

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function daysBetweenYMD(a: string, b: string) {
  const da = parseYMDToUTC(a);
  const db = parseYMDToUTC(b);
  if (!da || !db) return Infinity;
  const ms = Math.abs(db.getTime() - da.getTime());
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function buildSinglePickOccurrencesFromSchedule(params: {
  events: any[];
  maxDays: number;
  radiusMiles: number;
}) {
  const { events, maxDays, radiusMiles } = params;

  const base = (events || [])
    .filter((e) => !!eventUrl(e))
    .sort((a, b) => eventSortKey(a) - eventSortKey(b));

  const sigSet = new Set<string>();
  const out: any[] = [];

  for (let i = 0; i < base.length; i++) {
    const seed = base[i];
    const seedDate = getEventLocalDate(seed);
    if (!seedDate) continue;

    const seedLL = getEventLatLon(seed);
    const seedCS = eventVenueCityState(seed);

    const group: any[] = [];

    for (let j = 0; j < base.length; j++) {
      const e = base[j];
      const d = getEventLocalDate(e);
      if (!d) continue;

      if (daysBetweenYMD(seedDate, d) > maxDays) continue;

      const ll = getEventLatLon(e);
      let okDist = true;

      if (seedLL && ll) {
        okDist = haversineMiles(seedLL, ll) <= radiusMiles;
      } else if (seedCS) {
        okDist = eventVenueCityState(e) === seedCS;
      }

      if (!okDist) continue;
      group.push(e);
    }

    const deduped = dedupeEventsWithinOccurrence(group);
    if (deduped.length < 2) continue;

    const ids = deduped
      .map((e) => eventId(e) || `${eventSortKey(e)}|${eventVenueKey(e)}`)
      .sort();
    const sig = ids.join("~");
    if (sigSet.has(sig)) continue;
    sigSet.add(sig);

    const dates = uniqueSortedDates(deduped);
    const startYMD = dates[0] || null;
    const endYMD = dates.length ? dates[dates.length - 1] : startYMD;

    out.push({
      events: deduped,
      popular: [],
      meta: {
        startYMD,
        endYMD,
        anchor: seedLL ? { lat: seedLL.lat, lon: seedLL.lon } : null,
        mode: "SINGLE_PICK_OCCURRENCES",
      },
    });
  }

  out.sort((a, b) => {
    const aStart = a?.meta?.startYMD ? Number(String(a.meta.startYMD).replace(/-/g, "")) : 99999999;
    const bStart = b?.meta?.startYMD ? Number(String(b.meta.startYMD).replace(/-/g, "")) : 99999999;
    return aStart - bStart;
  });

  return out;
}

/* -------------------- Misc helpers -------------------- */

function uniqueSortedDates(events: any[]) {
  const set = new Set<string>();
  for (const e of events) {
    const d = getEventLocalDate(e);
    if (d) set.add(d);
  }
  return Array.from(set).sort();
}

function getOccurrenceDateRange(events: any[]) {
  const dates = uniqueSortedDates(events);
  const start = dates[0] ?? "Date TBD";
  const end = dates.length ? dates[dates.length - 1] : start;
  return { start, end };
}

function getMostCommonCityState(events: any[]) {
  const counts: Record<string, number> = {};
  for (const e of events) {
    const cs = eventVenueCityState(e);
    if (!cs) continue;
    counts[cs] = (counts[cs] ?? 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}

function getMostCommonCountryCode(events: any[]) {
  const counts: Record<string, number> = {};
  for (const e of events) {
    const v = e?._embedded?.venues?.[0];
    const cc = v?.country?.countryCode;
    if (!cc) continue;
    counts[cc] = (counts[cc] ?? 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}

function getAnchorLatLonFromEvents(events: any[]) {
  for (const e of events) {
    const v = e?._embedded?.venues?.[0];
    const lat = v?.location?.latitude;
    const lon = v?.location?.longitude;
    if (lat != null && lon != null) {
      const la = Number(lat);
      const lo = Number(lon);
      if (Number.isFinite(la) && Number.isFinite(lo)) return { lat: la, lng: lo };
    }
  }
  return null;
}

/* -------------------- Dedup helpers -------------------- */

function dedupeEventsWithinOccurrence(events: any[]) {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const e of events || []) {
    const id = eventId(e);
    const key =
      id || `${eventSortKey(e)}|${eventVenueKey(e)}|${normalizeTitleForDedup(eventTitle(e))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function dedupeNearbyPopularEvents(events: any[]) {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const e of events || []) {
    const id = eventId(e);
    const key =
      id || `${eventSortKey(e)}|${eventVenueKey(e)}|${normalizeTitleForDedup(eventTitle(e))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/* -------------------- Coverage helpers -------------------- */

function pickKeyClient(p: any) {
  if (!p) return "unknown";
  if (p.type === "team") return `team:${p.attractionId || p.name || ""}`;
  if (p.type === "artist") return `artist:${p.attractionId || ""}`;
  if (p.type === "genre") return `genre:${p.bucket || ""}`;
  if (p.type === "raw") return `raw:${p.name || ""}`;
  return "unknown";
}

function occurrenceCoverageCountFromMainEvents(eventsMain: any[]) {
  const set = new Set<string>();
  for (const ev of eventsMain) set.add(pickKeyClient(ev?.__pick));
  set.delete("unknown");
  return set.size;
}

/* -------------------- Airport matching -------------------- */

function normalizeRegionToStateCode(region: string) {
  const m = /^([A-Z]{2})-([A-Z0-9]{2,3})$/.exec(String(region || "").toUpperCase());
  if (!m) return null;
  return m[2];
}

function resolveBestDestinationIata(opts: {
  preferredCityState: string | null;
  eventsForCandidates: any[];
  country: string | null;
  airports: Airport[];
}) {
  const { preferredCityState, eventsForCandidates, country, airports } = opts;

  const candidates: string[] = [];
  if (preferredCityState) candidates.push(preferredCityState);

  for (const e of eventsForCandidates || []) {
    const cs = eventVenueCityState(e);
    if (cs && !candidates.includes(cs)) candidates.push(cs);
  }

  for (const cs of candidates) {
    const [cityRaw, stateRaw] = cs.split(",").map((x) => x.trim());
    const city = (cityRaw || "").toLowerCase();
    const st = (stateRaw || "").toUpperCase();
    if (!city || !st) continue;

    const matches = airports.filter((a) => {
      if (!a?.iata) return false;
      if (country && a.country && String(a.country).toUpperCase() !== String(country).toUpperCase())
        return false;

      const aCity = String(a.city || "").toLowerCase();
      const aState = normalizeRegionToStateCode(a.region) || "";
      const aStateU = aState.toUpperCase();

      return aCity === city && aStateU === st;
    });

    if (matches.length) {
      return { destIata: matches[0].iata, destName: matches[0].name };
    }
  }

  return { destIata: null as string | null, destName: null as string | null };
}

/* -------------------- UI helpers -------------------- */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function TravelButton({
  label,
  enabled,
  title,
  onClick,
}: {
  label: string;
  enabled: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        "rounded-xl px-3 py-2 text-xs font-extrabold transition border",
        enabled
          ? "bg-white/20 text-white border-white/30 hover:bg-white/30"
          : "bg-white/5 text-white/40 border-white/10 cursor-not-allowed"
      )}
    >
      {label}
    </button>
  );
}

/* ==================== Share pick parsing + lookup ==================== */

function parsePickParam(p: string | null): { kind: string; label?: string; id?: string } | null {
  const s = (p || "").trim();
  if (!s) return null;

  const decoded = s.replace(/\+/g, " ");
  const parts = decoded
    .split(":")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!parts.length) return null;

  const kind = parts[0].toLowerCase();

  // team:NHL:Edmonton Oilers
  if (kind === "team") {
    const label = parts.slice(2).join(":") || parts[1];
    return { kind, label };
  }

  // artist:K8vZ9171uzf or artist:Chris Isaak:K8vZ9171uzf
  if (kind === "artist") {
    if (parts.length >= 3) {
      return { kind, label: parts.slice(1, -1).join(":"), id: parts[parts.length - 1] };
    }
    return { kind, id: parts[1] };
  }

  // genre:Rock, raw:Something, etc.
  return { kind, label: parts[parts.length - 1] };
}

function lookupAttractionNameById(events: any[], attractionId: string): string | null {
  if (!attractionId) return null;

  for (const e of events || []) {
    const atts = e?._embedded?.attractions;
    if (!Array.isArray(atts)) continue;

    const hit = atts.find((a: any) => String(a?.id || "") === attractionId);
    if (hit?.name) {
      const nm = String(hit.name).trim();
      if (nm) return nm;
    }
  }

  return null;
}

/* ==================== Same-pick detection for P1 vs P2 ==================== */

function normPickLabel(s: string) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9 ]+/g, "");
}

function samePick(p1Raw: string | null, p2Raw: string | null) {
  const a = parsePickParam(p1Raw);
  const b = parsePickParam(p2Raw);
  if (!a || !b) return false;

  if (a.kind !== b.kind) return false;

  if (a.id && b.id) return String(a.id).trim() === String(b.id).trim();

  const al = a.label ? normPickLabel(a.label) : "";
  const bl = b.label ? normPickLabel(b.label) : "";
  if (al && bl) return al === bl;

  return false;
}

/* ==================== Fallback schedules overlay (P1 != P2, 0 occurrences) ==================== */

function dedupeScheduleEvents(events: any[]) {
  return dedupeEventsWithinOccurrence(events || []);
}

function buildMergedFallbackScheduleRows(schedules: Array<{ label: string; events: any[] }>) {
  const rows: Array<{ src: "p1" | "p2"; e: any }> = [];

  const s0 = schedules?.[0];
  const s1 = schedules?.[1];

  const p1Events = dedupeScheduleEvents(Array.isArray(s0?.events) ? s0.events : []).filter(
    (e) => !!eventUrl(e)
  );
  const p2Events = dedupeScheduleEvents(Array.isArray(s1?.events) ? s1.events : []).filter(
    (e) => !!eventUrl(e)
  );

  for (const e of p1Events) rows.push({ src: "p1", e });
  for (const e of p2Events) rows.push({ src: "p2", e });

  rows.sort((a, b) => eventSortKey(a.e) - eventSortKey(b.e));
  return rows;
}

/* ==================== PAGE ==================== */

export default function ResultsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const qs = useMemo(() => stripDeprecatedParams(sp), [sp]);
  const qsString = useMemo(() => qs.toString(), [qs]);

  const originIata = (qs.get("origin") || "").trim().toUpperCase();
  const hasOriginAirport = /^[A-Z]{3}$/.test(originIata);

  const selectedPickCount = useMemo(() => {
    const ids = [qs.get("p1"), qs.get("p2"), qs.get("p3")]
      .map((x) => (x || "").trim())
      .filter(Boolean);
    return ids.length;
  }, [qsString]);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [airports, setAirports] = useState<Airport[]>([]);
  const [showPopularByOcc, setShowPopularByOcc] = useState<Record<string, boolean>>({});

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  // ✅ NEW: true overlay/modal for the "no overlap" schedule view
  const [showNoOverlapModal, setShowNoOverlapModal] = useState(false);

  function showToast(msg: string) {
    setToastMsg(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2200);
  }

  type PopularCacheEntry = {
    loading: boolean;
    loaded: boolean;
    events: any[];
    error?: string;
  };

  const [popularCacheByOcc, setPopularCacheByOcc] = useState<Record<string, PopularCacheEntry>>(
    {}
  );

  // ✅ UPDATED: default + clamp in public mode
  const radiusMiles = useMemo(() => {
    const raw = qs.get("radiusMiles");
    if (PUBLIC_MODE) {
      return clampInt(raw ?? PUBLIC_PRESET.maxRadiusMiles, 1, PUBLIC_PRESET.maxRadiusMiles, PUBLIC_PRESET.maxRadiusMiles);
    }
    return clampInt(raw ?? 100, 1, 2000, 100);
  }, [qsString]);

  // ✅ UPDATED: default + clamp in public mode
  const maxDays = useMemo(() => {
    const raw = qs.get("days");
    if (PUBLIC_MODE) {
      return clampInt(raw ?? PUBLIC_PRESET.maxDays, 1, PUBLIC_PRESET.maxDays, PUBLIC_PRESET.maxDays);
    }
    return clampInt(raw ?? 5, 1, 30, 5);
  }, [qsString]);

  // Determine if we're in "single pick" mode (P1=P2, including links where one is blank)
  const sameEntityMode = useMemo(() => {
    const p1 = (qs.get("p1") || "").trim();
    const p2 = (qs.get("p2") || "").trim();
    const p1n = p1 || p2;
    const p2n = p2 || p1;
    if (!p1n || !p2n) return false;
    return samePick(p1n, p2n);
  }, [qsString]);

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
    if (!qsString) return;

    const ac = new AbortController();

    setLoading(true);
    fetch(`/api/search?${qsString}`, { cache: "no-store", signal: ac.signal })
      .then((r) => r.json())
      .then((json) => {
        if (ac.signal.aborted) return;
        setData(json);
      })
      .catch((e: any) => {
        if (e?.name === "AbortError") return;
        setData({ error: e?.message || "Search failed" });
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [qsString]);

  const occurrencesRaw = useMemo(() => data?.occurrences || [], [data]);

  // If P1=P2 and API yields no occurrences but does return fallback schedules,
  // convert schedule → occurrences client-side using the same days/radius logic.
  const occurrencesEffective = useMemo(() => {
    const occ = Array.isArray(occurrencesRaw) ? occurrencesRaw : [];
    if (occ.length) return occ;

    if (!sameEntityMode) return occ;

    const schedules = data?.fallback?.schedules;
    if (!Array.isArray(schedules) || schedules.length === 0) return occ;

    const scheduleEvents = Array.isArray(schedules[0]?.events) ? schedules[0].events : [];
    return buildSinglePickOccurrencesFromSchedule({
      events: scheduleEvents,
      maxDays,
      radiusMiles,
    });
  }, [occurrencesRaw, sameEntityMode, data, maxDays, radiusMiles]);

  const occurrencesSorted = useMemo(() => {
    const source = Array.isArray(occurrencesEffective) ? occurrencesEffective : [];

    const enriched = source.map((occ: any, idx: number) => {
      const eventsDeduped = dedupeEventsWithinOccurrence(occ.events);

      const main = [...eventsDeduped]
        .filter((e) => !!eventUrl(e))
        .sort((a, b) => eventSortKey(a) - eventSortKey(b));

      const mainDates = uniqueSortedDates(main);
      const firstMain = mainDates[0] ?? null;
      const sortKey = firstMain ? Number(String(firstMain).replace(/-/g, "")) : 99999999;

      const coverage = occurrenceCoverageCountFromMainEvents(main);

      return {
        ...occ,
        __idx: idx,
        __coverage: coverage,
        __earliestMainKey: sortKey,
      };
    });

    enriched.sort((a: any, b: any) => {
      const ak = a.__earliestMainKey ?? 99999999;
      const bk = b.__earliestMainKey ?? 99999999;
      if (ak !== bk) return ak - bk;
      return (b.__coverage ?? 0) - (a.__coverage ?? 0);
    });

    return enriched;
  }, [occurrencesEffective]);

  const occCount = occurrencesSorted.length;

  const hasSearched = useMemo(() => {
    const p1 = (qs.get("p1") || "").trim();
    const p2 = (qs.get("p2") || "").trim();
    const p3 = (qs.get("p3") || "").trim();
    return !!(p1 || p2 || p3);
  }, [qsString]);

  const errMsg = data?.error || null;

  // ✅ NEW: stronger “P1 and P2 are both filled and different” check
  const p1Filled = useMemo(() => !!(qs.get("p1") || "").trim(), [qsString]);
  const p2Filled = useMemo(() => !!(qs.get("p2") || "").trim(), [qsString]);

  const hasFallbackSchedules =
    Array.isArray(data?.fallback?.schedules) && (data?.fallback?.schedules?.length || 0) >= 2;

  const shouldShowNoOverlapModal =
    hasSearched &&
    !loading &&
    !errMsg &&
    occCount === 0 &&
    p1Filled &&
    p2Filled &&
    !sameEntityMode &&
    hasFallbackSchedules;

  // ✅ NEW: auto-open the modal when we hit the “no overlap” condition
  useEffect(() => {
    if (shouldShowNoOverlapModal) setShowNoOverlapModal(true);
    else setShowNoOverlapModal(false);
  }, [shouldShowNoOverlapModal]);

  // ✅ NEW: ESC to close
  useEffect(() => {
    if (!showNoOverlapModal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowNoOverlapModal(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showNoOverlapModal]);

  async function fetchNearbyPopularOnce(params: {
    occKey: string;
    anchor: { lat: number; lng: number };
    startYMD: string;
    endYMD: string;
    excludeIds: string[];
  }) {
    const { occKey, anchor, startYMD, endYMD, excludeIds } = params;

    setPopularCacheByOcc((prev) => {
      const cur = prev[occKey];
      if (cur?.loading || cur?.loaded) return prev;
      return { ...prev, [occKey]: { loading: true, loaded: false, events: [] } };
    });

    try {
      const res = await fetch("/api/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: anchor.lat,
          lng: anchor.lng,
          startDate: startYMD,
          endDate: endYMD,
          radiusMiles,
          limit: 10,
          excludeIds,
        }),
      });

      const json = await res.json();

      const events =
        (Array.isArray(json?.events) && json.events) ||
        (Array.isArray(json?.popular) && json.popular) ||
        (Array.isArray(json?.nearby) && json.nearby) ||
        (Array.isArray(json?.results) && json.results) ||
        (Array.isArray(json?._embedded?.events) && json._embedded.events) ||
        [];

      const deduped = dedupeNearbyPopularEvents(events);

      setPopularCacheByOcc((prev) => ({
        ...prev,
        [occKey]: { loading: false, loaded: true, events: deduped },
      }));
    } catch (e: any) {
      setPopularCacheByOcc((prev) => ({
        ...prev,
        [occKey]: {
          loading: false,
          loaded: true,
          events: [],
          error: e?.message || "Failed to load nearby events",
        },
      }));
    }
  }

  function toggleOtherPopular(
    occKey: string,
    canFetchNearby: boolean,
    anchor: any,
    startYMD: string | null,
    endYMD: string | null,
    excludeIds: string[]
  ) {
    setShowPopularByOcc((prev) => {
      const next = !prev[occKey];

      if (next && canFetchNearby && anchor && startYMD && endYMD) {
        const entry = popularCacheByOcc[occKey];
        if (!(entry?.loaded || entry?.loading)) {
          fetchNearbyPopularOnce({ occKey, anchor, startYMD, endYMD, excludeIds });
        }
      }

      return { ...prev, [occKey]: next };
    });
  }

  /* -------------------- Share helpers -------------------- */

  function isMobileUA() {
    const ua = (navigator.userAgent || "").toLowerCase();
    return /android|iphone|ipad|ipod/.test(ua);
  }

  function isWindowsUA() {
    const ua = (navigator.userAgent || "").toLowerCase();
    return ua.includes("windows");
  }

  function pickCheckmarkGlyph() {
    if (isMobileUA()) return "✅";
    if (isWindowsUA()) return "✓";
    return "✅";
  }

  function formatShortRange(start: string, end: string) {
    const s = parseYMDToUTC(start);
    const e = parseYMDToUTC(end);
    if (!s || !e) return formatRangePretty(start, end);

    const sm = fmtUTC(s, { month: "short" });
    const em = fmtUTC(e, { month: "short" });
    const sd = fmtUTC(s, { day: "numeric" });
    const ed = fmtUTC(e, { day: "numeric" });
    const sy = fmtUTC(s, { year: "numeric" });
    const ey = fmtUTC(e, { year: "numeric" });

    if (start === end) return `${sm} ${sd}, ${sy}`;
    if (sy === ey) {
      if (sm === em) return `${sm} ${sd} - ${ed}, ${sy}`;
      return `${sm} ${sd} - ${em} ${ed}, ${sy}`;
    }
    return `${sm} ${sd}, ${sy} - ${em} ${ed}, ${ey}`;
  }

  async function shareOccurrence(params: {
    occKey: string;
    cityState: string | null;
    startYMD: string;
    endYMD: string;
    fallbackTitles: string[];
    eventsForLookup: any[];
  }) {
    const { occKey, cityState, startYMD, endYMD, fallbackTitles, eventsForLookup } = params;

    const url = `${window.location.origin}/results?${qsString}#${occKey}`;

    const raw = [qs.get("p1"), qs.get("p2"), qs.get("p3")];
    let pickNames: string[] = [];

    for (const r of raw) {
      const parsed = parsePickParam(r);
      if (!parsed) continue;

      if (parsed.label) {
        pickNames.push(parsed.label);
        continue;
      }

      if (parsed.kind === "artist" && parsed.id) {
        const resolved = lookupAttractionNameById(eventsForLookup, parsed.id);
        if (resolved) pickNames.push(resolved);
      }
    }

    if (pickNames.length === 0 && Array.isArray(fallbackTitles) && fallbackTitles.length) {
      pickNames = fallbackTitles.slice(0, 3);
    }

    const mark = pickCheckmarkGlyph();
    const loc = cityState || "Location TBD";
    const range = formatShortRange(startYMD, endYMD);

    const body = [
      "Hear me out ...",
      "",
      ...pickNames.map((n) => `${mark} ${n}`),
      "",
      loc,
      range,
      "",
      "... we should totally go! right!?",
      "",
      url,
    ].join("\n");

    if (isMobileUA() && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: "EventStack", text: body });
        return;
      } catch {}
    }

    try {
      await navigator.clipboard.writeText(body);
      showToast("Share message copied to clipboard");
    } catch {
      window.prompt("Copy and share this:", body);
    }
  }

  function renderOccurrenceBlock(occ: any, keySeed: string) {
    const eventsDeduped = dedupeEventsWithinOccurrence(occ.events);
    const popularDeduped = dedupeNearbyPopularEvents(occ.popular);

    const allEvents = [...eventsDeduped, ...popularDeduped];

    const startMeta = occ?.meta?.startYMD || null;
    const endMeta = occ?.meta?.endYMD || null;

    const { start: startFallback, end: endFallback } = getOccurrenceDateRange(eventsDeduped);

    const start = (startMeta || startFallback) as string;
    const end = (endMeta || endFallback) as string;

    const cityState = getMostCommonCityState(allEvents);
    const country = getMostCommonCountryCode(allEvents);

    const occKey = `${keySeed}-${occ.__idx ?? "x"}`;

    const main = [...eventsDeduped]
      .filter((e) => !!eventUrl(e))
      .sort((a, b) => eventSortKey(a) - eventSortKey(b));

    const mainIds = new Set(main.map(eventId).filter(Boolean) as string[]);

    const mainDates = uniqueSortedDates(main);
    const firstMain = mainDates[0] ?? null;
    const lastMain = mainDates.length ? mainDates[mainDates.length - 1] : null;

    const metaAnchor = occ?.meta?.anchor;
    const anchor =
      metaAnchor?.lat != null && metaAnchor?.lon != null
        ? { lat: Number(metaAnchor.lat), lng: Number(metaAnchor.lon) }
        : getAnchorLatLonFromEvents(eventsDeduped);

    const startYMD: string | null = (occ?.meta?.startYMD || firstMain) ?? null;
    const endYMD: string | null = (occ?.meta?.endYMD || lastMain) ?? null;

    const cacheEntry = popularCacheByOcc[occKey];
    const cachedPopular = Array.isArray(cacheEntry?.events) ? cacheEntry!.events : [];
    const cachedPopularDeduped = dedupeNearbyPopularEvents(cachedPopular);

    const basePopular = (cacheEntry?.loaded ? cachedPopularDeduped : popularDeduped)
      .filter((e: any) => !!eventUrl(e))
      .filter((e: any) => {
        const id = eventId(e);
        return id ? !mainIds.has(id) : true;
      });

    const canFetchNearby = !!(anchor && startYMD && endYMD);
    const hasOtherPopular = basePopular.length > 0 || canFetchNearby;
    const showOtherPopular = !!showPopularByOcc[occKey];

    const checkInYMD = firstMain ? addDaysUTC(firstMain, -1) : null;
    const checkOutYMD = lastMain ? addDaysUTC(lastMain, +1) : null;

    const hotelsUrl =
      cityState && checkInYMD && checkOutYMD
        ? buildExpediaHotelSearchUrl({ destinationLabel: cityState, checkInYMD, checkOutYMD })
        : null;

    const { destIata } = resolveBestDestinationIata({
      preferredCityState: cityState,
      eventsForCandidates: allEvents,
      country,
      airports,
    });

    const flightsUrl =
      originIata && destIata && checkInYMD && checkOutYMD
        ? buildExpediaFlightsOnlyUrl({
            fromIata: originIata,
            toIata: destIata,
            departYMD: checkInYMD,
            returnYMD: checkOutYMD,
          })
        : null;

    const packagesUrl =
      originIata && (destIata || cityState) && checkInYMD && checkOutYMD
        ? buildExpediaFlightHotelPackageUrl({
            fromAirport: originIata,
            destination: destIata || (cityState as string),
            fromDateYMD: checkInYMD,
            toDateYMD: checkOutYMD,
          })
        : null;

    const merged = (
      showOtherPopular
        ? [
            ...main.map((e) => ({ e, pop: false })),
            ...basePopular.map((e: any) => ({ e, pop: true })),
          ]
        : [...main.map((e) => ({ e, pop: false }))]
    ).sort((a, b) => eventSortKey(a.e) - eventSortKey(b.e));

    const coverage = occ.__coverage ?? occurrenceCoverageCountFromMainEvents(main);
    const includesAll3 = selectedPickCount === 3 && coverage === 3;

    return (
      <section id={occKey} key={occKey} className="w-full max-w-5xl mx-auto mb-8">
        <div
          className={cx(
            "rounded-3xl overflow-hidden border shadow-sm bg-white",
            includesAll3 ? "border-red-500/60" : "border-slate-200"
          )}
        >
          <div
            className={cx(
              "relative px-5 py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3",
              includesAll3 ? "bg-red-600 text-white" : "bg-slate-900 text-white"
            )}
          >
            <button
              type="button"
              onClick={() => {
                shareOccurrence({
                  occKey,
                  cityState,
                  startYMD: start,
                  endYMD: end,
                  fallbackTitles: main.map((e: any) => eventTitle(e)),
                  eventsForLookup: allEvents,
                });
              }}
              title="Share this occurrence"
              className="absolute right-4 top-4 sm:hidden rounded-2xl px-4 py-2.5 text-xs font-black tracking-wide bg-white text-slate-900 shadow-lg shadow-black/25 ring-1 ring-white/30 hover:-translate-y-px hover:shadow-xl"
            >
              SHARE
            </button>

            <div className="pr-28 sm:pr-0">
              <div className="text-lg font-extrabold">{formatRangePretty(start, end)}</div>
              <div className="text-xl font-extrabold">{cityState || "Location TBD"}</div>
            </div>

            <div className="mt-3 w-full sm:mt-0 sm:w-auto">
              <div className="flex w-full items-center justify-end gap-2">
                {includesAll3 && (
                  <div className="mr-auto hidden sm:block text-xs font-extrabold px-3 py-2 rounded-xl bg-white/15 border border-white/25">
                    Includes All 3 Selections
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    shareOccurrence({
                      occKey,
                      cityState,
                      startYMD: start,
                      endYMD: end,
                      fallbackTitles: main.map((e: any) => eventTitle(e)),
                      eventsForLookup: allEvents,
                    });
                  }}
                  title="Share this occurrence"
                  className="hidden sm:inline-flex shrink-0 rounded-2xl px-4 py-2.5 text-xs font-black tracking-wide transition bg-white text-slate-900 shadow-lg shadow-black/25 ring-1 ring-white/30 hover:-translate-y-px hover:shadow-xl"
                >
                  SHARE
                </button>
              </div>

              <div className="mt-3 flex w-full flex-wrap items-center justify-center gap-2 sm:mt-2 sm:justify-end">
                <TravelButton
                  label="Hotels"
                  enabled={!!hotelsUrl}
                  title={hotelsUrl ? "Search hotels on Expedia" : "Missing destination or dates"}
                  onClick={() => hotelsUrl && window.open(hotelsUrl, "_blank")}
                />

                <TravelButton
                  label="Flights"
                  enabled={!!flightsUrl}
                  title={
                    flightsUrl
                      ? "Search flights on Expedia"
                      : !hasOriginAirport
                      ? "Add your nearest airport on the search page to enable flights"
                      : "No destination airport found for this occurrence"
                  }
                  onClick={() => {
                    if (!hasOriginAirport) {
                      showToast("Add your nearest airport to enable Flights.");
                      return;
                    }
                    if (!flightsUrl) {
                      showToast("No destination airport found for this occurrence.");
                      return;
                    }
                    window.open(flightsUrl, "_blank");
                  }}
                />

                <TravelButton
                  label="Flight + Hotel"
                  enabled={!!packagesUrl}
                  title={
                    packagesUrl
                      ? "Search flight + hotel packages on Expedia"
                      : !hasOriginAirport
                      ? "Add your nearest airport on the search page to enable packages"
                      : "Missing destination or dates"
                  }
                  onClick={() => {
                    if (!hasOriginAirport) {
                      showToast("Add your nearest airport to enable Flight + Hotel.");
                      return;
                    }
                    if (!packagesUrl) {
                      showToast("Missing destination or dates for packages.");
                      return;
                    }
                    window.open(packagesUrl, "_blank");
                  }}
                />
              </div>
            </div>
          </div>

          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex justify-center">
            {hasOtherPopular ? (
              <button
                type="button"
                onClick={() =>
                  toggleOtherPopular(
                    occKey,
                    canFetchNearby,
                    anchor,
                    startYMD,
                    endYMD,
                    Array.from(mainIds)
                  )
                }
                className="rounded-full px-6 py-2 text-sm font-extrabold border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 active:bg-slate-200"
              >
                {showOtherPopular ? "Hide Popular Events Nearby" : "Show Popular Events Nearby"}
              </button>
            ) : (
              <div className="text-xs text-slate-500">No additional nearby events available.</div>
            )}
          </div>

          <div className="p-4 sm:p-6 space-y-3">
            {merged.map(({ e, pop }: any) => {
              const d = getEventLocalDate(e);
              const t = getEventLocalTime(e);
              const venueLabel = eventVenueCityState(e);

              const popRowBg = "bg-slate-200";
              const popTitle = "text-slate-600";
              const popMeta = "text-slate-600";

              return (
                <div
                  key={eventId(e) || `${eventSortKey(e)}-${normalizeTitleForDedup(eventTitle(e))}`}
                  className={cx(
                    "rounded-2xl border p-4 flex items-center justify-between gap-4",
                    pop ? `border-slate-200 ${popRowBg}` : "border-slate-200 bg-slate-100"
                  )}
                >
                  <div className="min-w-0">
                    <div className={cx("font-extrabold", pop ? popTitle : "text-slate-900")}>
                      {eventTitle(e)}
                      {pop && (
                        <span className="ml-2 text-xs font-extrabold text-slate-500">
                          Popular Nearby
                        </span>
                      )}
                    </div>
                    <div className={cx("mt-1 text-xs", pop ? popMeta : "text-slate-600")}>
                      {(() => {
                        const dateStr = formatEventDateMMMDDYYYY(d);
                        const timeStr = formatEventTimeLower(t);
                        const parts = [dateStr, timeStr, venueLabel].filter(Boolean);
                        return parts.length ? (
                          <div className="truncate">{parts.join(" • ")}</div>
                        ) : null;
                      })()}
                    </div>
                  </div>

                  {eventUrl(e) ? (
                    <a
                      href={eventUrl(e)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-full px-4 py-2 text-xs font-extrabold bg-slate-900 text-white hover:bg-slate-800"
                    >
                      Tickets
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-slate-400">No tickets</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  // ✅ NEW: this is now a true modal overlay (fixed + backdrop)
  function renderNoOverlapSchedulesModal() {
    if (!showNoOverlapModal) return null;

    const schedules = data?.fallback?.schedules;
    if (!Array.isArray(schedules) || schedules.length < 2) return null;

    const rows = buildMergedFallbackScheduleRows(schedules);

    const all = rows.map((r) => r.e);
    const cityState = getMostCommonCityState(all);

    const p1Label = schedules[0]?.label ? String(schedules[0].label) : "P1";
    const p2Label = schedules[1]?.label ? String(schedules[1].label) : "P2";

    return (
      <div className="fixed inset-0 z-50">
        {/* Backdrop */}
        <button
          type="button"
          aria-label="Close schedules"
          className="absolute inset-0 bg-black/50"
          onClick={() => setShowNoOverlapModal(false)}
        />

        {/* Modal */}
        <div className="relative mx-auto mt-10 w-[min(980px,92vw)] max-h-[85vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
          <div className="px-6 py-5 bg-slate-900 text-white">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xl font-extrabold">No overlap occurrences found</div>
                <div className="mt-1 text-sm text-white/80 truncate">
                  Showing both schedules (chronological){cityState ? ` • ${cityState}` : ""}.
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-extrabold">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-sm bg-slate-100 border border-white/30" />
                    <span className="text-white/90">{p1Label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-sm bg-slate-200 border border-white/30" />
                    <span className="text-white/90">{p2Label}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowNoOverlapModal(false)}
                className="shrink-0 rounded-2xl px-4 py-2 text-xs font-black tracking-wide bg-white text-slate-900 shadow-lg shadow-black/25 ring-1 ring-white/30 hover:-translate-y-px hover:shadow-xl"
              >
                CLOSE
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-3 overflow-auto max-h-[calc(85vh-112px)]">
            {rows.length === 0 ? (
              <div className="rounded-2xl bg-white shadow-md p-6 text-center">
                <h2 className="text-lg font-semibold text-slate-800">No Results Found</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Try adjusting your days, radius, or selections.
                </p>
              </div>
            ) : (
              rows.map((r, idx) => {
                const e = r.e;
                const d = getEventLocalDate(e);
                const t = getEventLocalTime(e);
                const venueLabel = eventVenueCityState(e);

                // P1 light, P2 darker
                const rowBg = r.src === "p2" ? "bg-slate-200" : "bg-slate-100";
                const titleColor = r.src === "p2" ? "text-slate-700" : "text-slate-900";
                const metaColor = r.src === "p2" ? "text-slate-700" : "text-slate-600";

                return (
                  <div
                    key={
                      eventId(e) ||
                      `${eventSortKey(e)}-${normalizeTitleForDedup(eventTitle(e))}-${idx}`
                    }
                    className={cx(
                      "rounded-2xl border p-4 flex items-center justify-between gap-4",
                      "border-slate-200",
                      rowBg
                    )}
                  >
                    <div className="min-w-0">
                      <div className={cx("font-extrabold", titleColor)}>{eventTitle(e)}</div>
                      <div className={cx("mt-1 text-xs", metaColor)}>
                        {(() => {
                          const dateStr = formatEventDateMMMDDYYYY(d);
                          const timeStr = formatEventTimeLower(t);
                          const parts = [dateStr, timeStr, venueLabel].filter(Boolean);
                          return parts.length ? (
                            <div className="truncate">{parts.join(" • ")}</div>
                          ) : null;
                        })()}
                      </div>
                    </div>

                    {eventUrl(e) ? (
                      <a
                        href={eventUrl(e)}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-full px-4 py-2 text-xs font-extrabold bg-slate-900 text-white hover:bg-slate-800"
                      >
                        Tickets
                      </a>
                    ) : (
                      <span className="shrink-0 text-xs text-slate-400">No tickets</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="text-slate-700 font-extrabold">Loading results...</div>
        </div>
      </main>
    );
  }

  if (errMsg) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="text-red-700 font-extrabold">Search failed: {errMsg}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-full bg-slate-900 text-white px-4 py-2 text-xs font-extrabold shadow-lg">
            {toastMsg}
          </div>
        </div>
      )}

      {/* ✅ NEW: schedule overlay modal */}
      {renderNoOverlapSchedulesModal()}

      <div className="max-w-5xl mx-auto px-4 pt-6 pb-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => router.push(`/?${qsString}`)}
          className="rounded-xl px-4 py-2 text-xs font-extrabold transition border bg-slate-900 text-white hover:bg-slate-800"
          title="Go back and revise your search"
        >
          Revise Search
        </button>
      </div>

      <div className="pb-10">
        {/* If we have 0 occurrences and NO fallback schedules, keep empty-state */}
        {hasSearched && !loading && !errMsg && occCount === 0 && !shouldShowNoOverlapModal && (
          <div className="max-w-xl mx-auto px-4 py-6">
            <div className="rounded-2xl bg-white shadow-md p-6 text-center">
              <h2 className="text-lg font-semibold text-slate-800">No Results Found</h2>
              <p className="mt-2 text-sm text-slate-500">
                Try adjusting your days, radius, or selections.
              </p>
            </div>
          </div>
        )}

        {occurrencesSorted.map((occ: any, idx: number) => renderOccurrenceBlock(occ, `occ-${idx}`))}
      </div>
    </main>
  );
}
