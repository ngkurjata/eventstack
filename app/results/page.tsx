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

function formatEventDateMMMDD(d: string | null) {
  const dt = d ? parseYMDToUTC(d) : null;
  if (!dt) return "";
  const mm = fmtUTC(dt, { month: "short" });
  const dd = fmtUTC(dt, { day: "2-digit" });
  return `${mm} ${dd}`;
}

function formatEventTime(t: string | null) {
  if (!t) return "";
  const m = /^(\d{2}):(\d{2})/.exec(t);
  if (!m) return t;
  let hh = +m[1];
  const mm = m[2];
  const ampm = hh >= 12 ? "PM" : "AM";
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${mm} ${ampm}`;
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
    const key = id || `${eventSortKey(e)}|${eventVenueKey(e)}|${normalizeTitleForDedup(eventTitle(e))}`;
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
    const key = id || `${eventSortKey(e)}|${eventVenueKey(e)}|${normalizeTitleForDedup(eventTitle(e))}`;
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

function MergedSchedules({
  schedules,
}: {
  schedules: Array<{ label: string; events: any[] }>;
}) {
  const merged = useMemo(() => {
    const out: Array<{ e: any; which: number; label: string }> = [];
    schedules.forEach((s, idx) => {
      (s.events || []).forEach((e) => out.push({ e, which: idx, label: s.label }));
    });
    out.sort((a, b) => eventSortKey(a.e) - eventSortKey(b.e));
    return out;
  }, [schedules]);

  return (
    <div className="p-4 sm:p-6 space-y-3">
      {merged.map(({ e, which, label }) => {
        const d = getEventLocalDate(e);
        const t = getEventLocalTime(e);
        const venueLabel = eventVenueCityState(e);

        const badgeClass =
          which === 0
            ? "bg-blue-50 text-blue-800 border-blue-200"
            : "bg-emerald-50 text-emerald-800 border-emerald-200";

        return (
          <div
            key={eventId(e) || `${eventSortKey(e)}-${normalizeTitleForDedup(eventTitle(e))}-${which}`}
            className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cx(
                    "shrink-0 inline-flex items-center px-2 py-1 rounded-full border text-xs font-extrabold",
                    badgeClass
                  )}
                >
                  {label}
                </span>
                <div className="font-extrabold text-slate-900 truncate">{eventTitle(e)}</div>
              </div>

              <div className="mt-2 text-xs text-slate-600 flex flex-wrap items-center gap-2">
                {d && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full bg-slate-50 border border-slate-200 font-extrabold">
                    {formatEventDateMMMDD(d)}
                  </span>
                )}
                {t && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full bg-slate-50 border border-slate-200 font-extrabold">
                    {formatEventTime(t)}
                  </span>
                )}
                {venueLabel && <span className="truncate">{venueLabel}</span>}
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
  );
}

/* ==================== PAGE ==================== */

export default function ResultsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const qs = useMemo(() => stripDeprecatedParams(sp), [sp]);

  const originIata = (qs.get("origin") || "").trim().toUpperCase();
  const hasOriginAirport = /^[A-Z]{3}$/.test(originIata);

  const selectedPickCount = useMemo(() => {
    const ids = [qs.get("p1"), qs.get("p2"), qs.get("p3")]
      .map((x) => (x || "").trim())
      .filter(Boolean);
    return ids.length;
  }, [qs]);

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [airports, setAirports] = useState<Airport[]>([]);
  const [showPopularByOcc, setShowPopularByOcc] = useState<Record<string, boolean>>({});

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

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

  const [popularCacheByOcc, setPopularCacheByOcc] = useState<Record<string, PopularCacheEntry>>({});

  const radiusMiles = useMemo(() => {
    const n = Number(qs.get("radiusMiles") || 100);
    return Number.isFinite(n) ? n : 100;
  }, [qs]);

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
    setLoading(true);
    fetch(`/api/search?${qs.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [qs]);

  const occurrencesRaw = useMemo(() => data?.occurrences || [], [data]);

const fallbackMode = data?.fallback?.mode || null;
const fallbackSchedules = data?.fallback?.schedules || null;

  const occurrencesSorted = useMemo(() => {
    const enriched = occurrencesRaw.map((occ: any, idx: number) => {
      const eventsDeduped = dedupeEventsWithinOccurrence(occ.events);
      const main = [...eventsDeduped]
        .filter((e) => !!eventUrl(e))
        .sort((a, b) => eventSortKey(a) - eventSortKey(b));

      const mainDates = uniqueSortedDates(main);
      const firstMain = mainDates[0] ?? null;
      const sortKey = firstMain ? Number(String(firstMain).replace(/-/g, "")) : 99999999;
      const coverage = occurrenceCoverageCountFromMainEvents(main);

      const entityOnly = occ?.meta?.mode === "ENTITY_ONLY";
      const entitySortKey = entityOnly
        ? firstMain
          ? Number(String(firstMain).replace(/-/g, ""))
          : 0
        : sortKey;

      return {
        ...occ,
        __idx: idx,
        __coverage: coverage,
        __earliestMainKey: entitySortKey,
      };
    });

    enriched.sort((a: any, b: any) => {
      const ak = a.__earliestMainKey ?? 99999999;
      const bk = b.__earliestMainKey ?? 99999999;
      if (ak !== bk) return ak - bk;
      return (b.__coverage ?? 0) - (a.__coverage ?? 0);
    });

    return enriched;
  }, [occurrencesRaw]);

  const occCount = occurrencesSorted.length;

  const hasSearched = useMemo(() => {
    const p1 = (qs.get("p1") || "").trim();
    const p2 = (qs.get("p2") || "").trim();
    const p3 = (qs.get("p3") || "").trim();
    return !!(p1 || p2 || p3);
  }, [qs]);

  const errMsg = data?.error || null;

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

  /* -------------------- Share helpers (Step 1/2/3) -------------------- */

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

  function pickDisplayNameFromParam(p: string | null): string | null {
    const s = (p || "").trim();
    if (!s) return null;

    const decoded = s.replace(/\+/g, " ");
    const parts = decoded
      .split(":")
      .map((x) => x.trim())
      .filter(Boolean);

    if (!parts.length) return null;

    const last = parts[parts.length - 1];

    if (/^K[0-9A-Za-z]{8,}$/.test(last)) return null;

    return last;
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
  }) {
    const { occKey, cityState, startYMD, endYMD, fallbackTitles } = params;

    const url = `${window.location.origin}/results?${qs.toString()}#${occKey}`;

    let pickNames = [qs.get("p1"), qs.get("p2"), qs.get("p3")]
      .map(pickDisplayNameFromParam)
      .filter(Boolean) as string[];

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

    if (isMobileUA() && navigator.share) {
      try {
        await navigator.share({ title: "EventStack", text: body });
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
    const isEntityOnly = occ?.meta?.mode === "ENTITY_ONLY";
    const entityName = (occ?.meta?.entityName || "").trim() || null;

    const eventsDeduped = dedupeEventsWithinOccurrence(occ.events);
    const popularDeduped = dedupeNearbyPopularEvents(occ.popular);

    const allEvents = [...eventsDeduped, ...popularDeduped];

    // Prefer meta dates (ENTITY_ONLY uses meta.startYMD/endYMD from API) then fallback
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
      !isEntityOnly && cityState && checkInYMD && checkOutYMD
        ? buildExpediaHotelSearchUrl({ destinationLabel: cityState, checkInYMD, checkOutYMD })
        : null;

    const { destIata } = resolveBestDestinationIata({
      preferredCityState: cityState,
      eventsForCandidates: allEvents,
      country,
      airports,
    });

    const flightsUrl =
      !isEntityOnly &&
      originIata &&
      /^[A-Z]{3}$/.test(originIata) &&
      destIata &&
      checkInYMD &&
      checkOutYMD
        ? buildExpediaFlightsOnlyUrl({
            fromIata: originIata,
            toIata: destIata,
            departYMD: checkInYMD,
            returnYMD: checkOutYMD,
          })
        : null;

    const packagesUrl =
      !isEntityOnly &&
      originIata &&
      /^[A-Z]{3}$/.test(originIata) &&
      (destIata || cityState) &&
      checkInYMD &&
      checkOutYMD
        ? buildExpediaFlightHotelPackageUrl({
            fromAirport: originIata,
            destination: destIata || (cityState as string),
            fromDateYMD: checkInYMD,
            toDateYMD: checkOutYMD,
          })
        : null;

    // ENTITY_ONLY should never show "Popular Nearby" controls
    const merged = (
      !isEntityOnly && showOtherPopular
        ? [...main.map((e) => ({ e, pop: false })), ...basePopular.map((e: any) => ({ e, pop: true }))]
        : [...main.map((e) => ({ e, pop: false }))]
    ).sort((a, b) => eventSortKey(a.e) - eventSortKey(b.e));

    const coverage = occ.__coverage ?? occurrenceCoverageCountFromMainEvents(main);
    const includesAll3 = !isEntityOnly && selectedPickCount === 3 && coverage === 3;

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
            {/* SHARE button (hide in ENTITY_ONLY) */}
            {!isEntityOnly && (
              <button
                type="button"
                onClick={() => {
                  shareOccurrence({
                    occKey,
                    cityState,
                    startYMD: start,
                    endYMD: end,
                    fallbackTitles: main.map((e: any) => eventTitle(e)),
                  });
                }}
                title="Share this occurrence"
                className="absolute right-4 top-4 sm:hidden rounded-2xl px-4 py-2.5 text-xs font-black tracking-wide bg-white text-slate-900 shadow-lg shadow-black/25 ring-1 ring-white/30 hover:-translate-y-px hover:shadow-xl"
              >
                SHARE
              </button>
            )}

            <div className="pr-28 sm:pr-0">
              {isEntityOnly ? (
                <>
                  <div className="text-xs font-extrabold text-white/80">Full schedule</div>
                  <div className="text-xl font-extrabold">{entityName || "Selected entity"}</div>
                </>
              ) : (
                <>
                  <div className="text-lg font-extrabold">{formatRangePretty(start, end)}</div>
                  <div className="text-xl font-extrabold">{cityState || "Location TBD"}</div>
                </>
              )}
            </div>

            <div className="mt-3 w-full sm:mt-0 sm:w-auto">
              <div className="flex w-full items-center justify-end gap-2">
                {includesAll3 && (
                  <div className="mr-auto hidden sm:block text-xs font-extrabold px-3 py-2 rounded-xl bg-white/15 border border-white/25">
                    Includes All 3 Selections
                  </div>
                )}

                {/* Desktop SHARE (hide in ENTITY_ONLY) */}
                {!isEntityOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      shareOccurrence({
                        occKey,
                        cityState,
                        startYMD: start,
                        endYMD: end,
                        fallbackTitles: main.map((e: any) => eventTitle(e)),
                      });
                    }}
                    title="Share this occurrence"
                    className="hidden sm:inline-flex shrink-0 rounded-2xl px-4 py-2.5 text-xs font-black tracking-wide transition bg-white text-slate-900 shadow-lg shadow-black/25 ring-1 ring-white/30 hover:-translate-y-px hover:shadow-xl"
                  >
                    SHARE
                  </button>
                )}
              </div>

              {/* Travel buttons (hide in ENTITY_ONLY) */}
              {!isEntityOnly && (
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
              )}
            </div>
          </div>

          {/* Popular Nearby toggle row (hide in ENTITY_ONLY) */}
          {!isEntityOnly && (
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex justify-center">
              {hasOtherPopular ? (
                <button
                  type="button"
                  onClick={() =>
                    toggleOtherPopular(occKey, canFetchNearby, anchor, startYMD, endYMD, Array.from(mainIds))
                  }
className="rounded-full px-6 py-2 text-sm font-extrabold border border-slate-300 bg-white text-slate-900 hover:bg-slate-100 active:bg-slate-200"
                >
                  {showOtherPopular ? "Hide Popular Events Nearby" : "Show Popular Events Nearby"}
                </button>
              ) : (
                <div className="text-xs text-slate-500">No additional nearby events available.</div>
              )}
            </div>
          )}

          <div className="p-4 sm:p-6 space-y-3">
            {merged.map(({ e, pop }: any) => {
              const d = getEventLocalDate(e);
              const t = getEventLocalTime(e);
              const venueLabel = eventVenueCityState(e);

              return (
                <div
                  key={eventId(e) || `${eventSortKey(e)}-${normalizeTitleForDedup(eventTitle(e))}`}
                  className={cx(
                    "rounded-2xl border p-4 flex items-center justify-between gap-4",
                    pop ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-100"
                  )}
                >
                  <div className="min-w-0">
                    <div className={cx("font-extrabold", pop ? "text-slate-500" : "text-slate-900")}>
                      {eventTitle(e)}
                      {!isEntityOnly && pop && (
                        <span className="ml-2 text-xs font-extrabold text-slate-400">Popular Nearby</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-600 flex flex-wrap items-center gap-2">
                      {d && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-white border border-slate-200 font-extrabold">
                          {formatEventDateMMMDD(d)}
                        </span>
                      )}
                      {t && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-white border border-slate-200 font-extrabold">
                          {formatEventTime(t)}
                        </span>
                      )}
                      {venueLabel && <span className="truncate">{venueLabel}</span>}
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

            {/* If ENTITY_ONLY somehow returns no events, show a clearer message */}
            {isEntityOnly && merged.length === 0 && (
              <div className="text-sm text-slate-600 font-extrabold">
                No upcoming ticketed events found for this entity.
              </div>
            )}
          </div>
        </div>
      </section>
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

      <div className="max-w-5xl mx-auto px-4 pt-6 pb-3 flex items-center justify-between">
        <div className="text-sm text-slate-600 font-extrabold">Occurrences: {occCount}</div>

        <button
          type="button"
          onClick={() => router.push(`/?${qs.toString()}`)}
          className="rounded-xl px-4 py-2 text-xs font-extrabold transition border bg-slate-900 text-white hover:bg-slate-800"
          title="Go back and revise your search"
        >
          Revise Search
        </button>
      </div>

      <div className="pb-10">
        {/* Fallback merged schedules when there is no overlap */}
{hasSearched &&
  !loading &&
  !errMsg &&
  occurrencesSorted.length === 0 &&
  fallbackMode === "NO_OVERLAP_SCHEDULES" &&
  Array.isArray(fallbackSchedules) && (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-slate-900 text-white">
          <div className="text-lg font-extrabold">No overlap found</div>
          <div className="text-sm text-white/80 font-bold">
            Here are both schedules merged in date order:
          </div>
        </div>

        <MergedSchedules schedules={fallbackSchedules} />
      </div>
    </div>
  )}

{/* Default message when there is no overlap and no fallback payload */}
{hasSearched &&
  !loading &&
  !errMsg &&
  occurrencesSorted.length === 0 &&
  !(fallbackMode === "NO_OVERLAP_SCHEDULES" && Array.isArray(fallbackSchedules)) && (
    <div className="max-w-5xl mx-auto px-4 py-10 text-slate-700 font-extrabold">
      Your selected teams/artists don't cross paths within the provided number of days and radius. Keep searching!
    </div>
  )}

        {occurrencesSorted.map((occ: any, idx: number) => renderOccurrenceBlock(occ, `occ-${idx}`))}
      </div>
    </main>
  );
}
