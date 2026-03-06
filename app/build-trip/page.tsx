// FILE: app/build-trip/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AirportPicker, type Airport } from "../components/AirportPicker";
import BrandLogo from "../components/BrandLogo";
import { APP_NAME, TAGLINE } from "../../lib/brand";

/* -------------------- Types -------------------- */

type RowEvent = {
  date?: string | null; // YYYY-MM-DD
  name?: string;
  location?: string; // "City, ST"
  genre?: string | null;
  url?: string | null;
  lat?: number | null;
  lon?: number | null;
  localTime?: string | null; // optional
};

type BuildTripPayload = {
  rowKey?: string;
  tripStyle?: string;

  destIata?: string;
  cityState?: string;

  // Search window (not used for header; header comes from selected events)
  startYMD?: string | null;
  endYMD?: string | null;

  radiusMiles?: number;
  countryCode?: string;

  airport?: string; // origin iata (optional persisted)
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

type CityOpt = {
  id: string;
  label: string; // "Edmonton, AB"
  lat: number;
  lon: number;
  country?: string | null;
  airportIata?: string | null; // "YEG"
};

const LS_SELECTED = "eventstack_selected_events_v1";

/* -------------------- Small utils -------------------- */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function isYMD(s: any): s is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
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
    day: "2-digit",
    year: "numeric",
  }).format(dt);
}

function minMaxYMD(events: RowEvent[]) {
  const dates = events.map((e) => e.date).filter(Boolean) as string[];
  dates.sort();
  return { start: dates[0] || null, end: dates[dates.length - 1] || null };
}

function norm(s: any) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
  return [e.date || "", e.location || "", e.name || "", e.url || ""].join("|");
}

function getSelectedEventIds(): string[] {
  try {
    const raw = localStorage.getItem(LS_SELECTED);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const ids = Object.keys(parsed).filter((k) => parsed[k]);
    ids.sort(); // deterministic
    return ids;
  } catch {
    return [];
  }
}

/* -------------------- “Nearest major city” logic -------------------- */

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.7613; // miles
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
    .filter((p) => typeof p.lat === "number" && typeof p.lon === "number") as Array<{ lat: number; lon: number }>;

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
  // "CA-AB" -> "AB", "US-PA" -> "PA"
  const r = String(region || "").trim();
  if (!r) return "";
  const parts = r.split("-");
  return parts[1] || r;
}

/**
 * Pick an airport near the centroid, preferring large/medium airports.
 * This is a stable proxy for “nearest largest city”.
 */
function pickRepresentativeAirport(events: RowEvent[], airports: Airport[], opts?: { maxMiles?: number }) {
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

  // fallback: nearest airport with no max cap
  let nearest: { ap: Airport; dist: number } | null = null;
  for (const ap of airports || []) {
    if (typeof (ap as any)?.lat !== "number" || typeof (ap as any)?.lon !== "number") continue;
    const dist = haversineMiles(c.lat, c.lon, (ap as any).lat, (ap as any).lon);
    if (!nearest || dist < nearest.dist) nearest = { ap, dist };
  }
  return nearest?.ap || null;
}

/**
 * (Optional) City picker using cities.json. Kept for fallback / future use.
 */
function pickRepresentativeCity(events: RowEvent[], cities: CityOpt[], airports: Airport[], opts?: { maxMiles?: number }) {
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

  window.open(`https://www.expedia.ca/go/hotel/search/Destination?${qs.toString()}`, "_blank", "noopener,noreferrer");
}

function openExpediaFlights(originIata: string, destIataOrCity: string, departYMD: string | null, returnYMD: string | null) {
  const o = String(originIata || "").trim().toUpperCase();
  const d = String(destIataOrCity || "").trim().toUpperCase();
  const dep = ymdToExpediaMDY(departYMD);
  const ret = ymdToExpediaMDY(returnYMD);

  const qs = new URLSearchParams();
  qs.set("trip", "roundtrip");
  qs.set("passengers", "adults:1,children:0,infantinlap:N");
  qs.set("mode", "search");

  if (o && d && dep) qs.set("leg1", `from:${o},to:${d},departure:${dep}TANYT`);
  if (o && d && ret) qs.set("leg2", `from:${d},to:${o},departure:${ret}TANYT`);

  window.open(`https://www.expedia.com/Flights-Search?${qs.toString()}`, "_blank", "noopener,noreferrer");
}

function openExpediaFlightHotelBundle(originIata: string, destination: string, departYMD: string | null, returnYMD: string | null) {
  const o = String(originIata || "").trim().toUpperCase();
  const d = String(destination || "").trim();

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
  if (!res.ok) throw new Error(j?.error || `Share failed (${res.status})`);

  const id = j?.id as string;
  if (!id) throw new Error("Share id missing.");

  return `${window.location.origin}/share/${encodeURIComponent(id)}`;
}

async function shareUrl(url: string) {
  const navAny = navigator as any;
  if (navAny?.share) {
    try {
      await navAny.share({
        title: "Trip Plan",
        text: "Here’s the trip page:",
        url,
      });
      return { ok: true, method: "native" as const };
    } catch {
      // user cancelled -> fall through to clipboard
    }
  }

  await navigator.clipboard.writeText(url);
  return { ok: true, method: "clipboard" as const };
}

/* -------------------- Page -------------------- */

export default function BuildTripPage() {
  const router = useRouter();
  const sp = useSearchParams();

  // Optional debug path: /build-trip?data=<encoded payload>
  const dataParam = sp.get("data");
  const dataFromParam = useMemo(() => unwrapBuildTripPayload(safeParseData(dataParam)), [dataParam]);

  // Canonical A-only params
  const tripStyle = (sp.get("tripStyle") || "A").toUpperCase();
  const destIata = (sp.get("destIata") || "").trim().toUpperCase();
  const start = (sp.get("start") || "").trim();
  const end = (sp.get("end") || "").trim();
  const radiusMiles = Number(sp.get("radiusMiles") || 120) || 120;
  const countryCode = (sp.get("countryCode") || "US,CA").trim() || "US,CA";

  const [built, setBuilt] = useState<BuildTripPayload | null>(dataFromParam);
  const [builtLoading, setBuiltLoading] = useState(false);
  const [builtError, setBuiltError] = useState("");

  const [airports, setAirports] = useState<Airport[]>([]);
  const [citiesList, setCitiesList] = useState<CityOpt[]>([]);

  useEffect(() => {
    if (dataFromParam) {
      setBuilt(dataFromParam);
      setBuiltError("");
      setBuiltLoading(false);
    }
  }, [dataFromParam]);

  // A-only build: selected event IDs from localStorage -> POST /api/build-trip
  useEffect(() => {
    if (dataFromParam) return;

    if (tripStyle !== "A" && tripStyle !== "B") {
      setBuilt(null);
      setBuiltError("This page is intended for TripStyle A or B.");
      setBuiltLoading(false);
      return;
    }
    if (!destIata || destIata.length !== 3) {
      setBuilt(null);
      setBuiltError("Missing destination (destIata). Go back and re-run your search.");
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
  }, [dataFromParam, tripStyle, destIata, start, end, radiusMiles, countryCode]);

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

  /* -------------------- Derived values -------------------- */

  const events: RowEvent[] = useMemo(() => {
    const e = built?.events;
    return Array.isArray(e) ? (e as RowEvent[]) : [];
  }, [built]);

  // Airport-derived representative label (preferred)
  const representativeAirport = useMemo(() => {
    if (!events.length) return null;
    if (!airports.length) return null;
    return pickRepresentativeAirport(events, airports, { maxMiles: 250 });
  }, [events, airports]);

  const representativeCityLabel = useMemo(() => {
    if (!representativeAirport) return null;
    const city = String((representativeAirport as any)?.city || "").trim();
    const reg = regionShort((representativeAirport as any)?.region);
    const label = [city, reg].filter(Boolean).join(", ").trim();
    return label || null;
  }, [representativeAirport]);

  // Keep city.json picker as a fallback (optional)
  const representativeCity = useMemo(() => {
    if (!events.length) return null;
    if (!citiesList.length) return null;
    return pickRepresentativeCity(events, citiesList, airports, { maxMiles: 250 });
  }, [events, citiesList, airports]);

  const cities = useMemo(() => uniqueCitiesInOrder(events), [events]);

  const displayCityState = useMemo(() => {
    // 1) Prefer airport-derived “major city”
    if (representativeCityLabel) return representativeCityLabel;

    // 2) Otherwise, use cities.json representative city
    if (representativeCity?.label) return representativeCity.label;

    // 3) Then accept API-provided cityState
    const cs = String(built?.cityState || "").trim();
    if (cs) return cs;

    // 4) Fallback to first city/area label from events
    return pickDisplayCityState(cities);
  }, [representativeCityLabel, representativeCity, built?.cityState, cities]);

  // Header + booking dates MUST use the selected events on THIS trip.
  const { start: minStart, end: minEnd } = useMemo(() => minMaxYMD(events), [events]);

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

  const checkin = useMemo(() => addDaysUTC(eventStart, -1), [eventStart]);
  const checkout = useMemo(() => addDaysUTC(eventEnd, +1), [eventEnd]);

  const initialAirport = useMemo(() => String(built?.airport || "").toUpperCase(), [built]);
  const [airportIata, setAirportIata] = useState<string>(initialAirport);
  useEffect(() => setAirportIata(initialAirport), [initialAirport]);

  // Hotels: use airport-derived label first
  const destinationQuery = useMemo(() => {
    if (representativeCityLabel) return representativeCityLabel;
    if (representativeCity?.label) return representativeCity.label;
    return displayCityState || "";
  }, [representativeCityLabel, representativeCity, displayCityState]);

  // Flights/Packages: prefer IATA for A-only.
  const destinationForAir = useMemo(
    () => (destIata.length === 3 ? destIata : destinationQuery),
    [destIata, destinationQuery]
  );

  const hasOrigin = Boolean(airportIata && airportIata.trim());

  /* -------------------- Share state + handler -------------------- */

  const [shareBusy, setShareBusy] = useState(false);
  const [shareNote, setShareNote] = useState<string>("");

  function buildSharePayload() {
    return {
      ...built,
      airport: airportIata ? String(airportIata).trim().toUpperCase() : built?.airport || "",
      destIata: built?.destIata || destIata,
      radiusMiles: built?.radiusMiles ?? radiusMiles,
      countryCode: built?.countryCode ?? countryCode,
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

  /* -------------------- Render -------------------- */

  const shareDisabled = !built || builtLoading || Boolean(builtError) || shareBusy;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-4 lg:max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BrandLogo />
              <div className="min-w-0">
                <div className="text-base font-black tracking-tight text-slate-900 truncate">Build trip</div>
                <div className="text-xs text-slate-600 truncate">{TAGLINE}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={shareDisabled}
                onClick={onShare}
                className={cx(
                  "rounded-2xl px-3.5 py-2 text-[11px] font-extrabold transition",
                  shareDisabled
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                )}
                title="Share this trip"
              >
                {shareBusy ? "Sharing…" : "Share"}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (window.history.length > 1) router.back();
                  else router.push(`/events?${sp.toString()}`);
                }}
                className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-extrabold text-slate-800 hover:bg-slate-50"
                title="Back to events"
              >
                Events
              </button>

              <button
                type="button"
                onClick={() => router.push("/")}
                className="rounded-2xl bg-slate-900 px-3.5 py-2 text-[11px] font-extrabold text-white hover:bg-slate-800"
                title="Search again"
              >
                Search
              </button>
            </div>
          </div>

          {!!shareNote && <div className="mt-2 text-right text-xs font-semibold text-slate-600">{shareNote}</div>}
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-3xl lg:py-10">
        {builtLoading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              <div className="text-sm font-semibold text-slate-700">Building trip…</div>
            </div>
            <div className="mt-2 text-xs text-slate-500">Using your selected events.</div>
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
                  else router.push(`/events?${sp.toString()}`);
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
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="text-center">
                <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">{displayCityState}</h1>

                <div className="mt-3 text-base font-extrabold text-slate-800 sm:text-lg">
                  {fmtYMDPretty(eventStart)} → {fmtYMDPretty(eventEnd)}
                </div>

                <div className="mt-2 text-xs text-slate-500">
                  Travel dates for booking: {fmtYMDPretty(checkin)} → {fmtYMDPretty(checkout)}
                </div>
              </div>
            </section>

            <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-4 text-center">
                <div className="text-xl font-extrabold tracking-tight text-slate-900">Events</div>
                <div className="mt-1 text-xs text-slate-500">Tickets open in a new tab.</div>
              </div>

              {events.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  No events returned for this trip.
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((e) => {
                    const where = String(e.location || "").trim() || "Location TBD";
                    return (
                      <div
                        key={eventKey(e)}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:bg-slate-50"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-700 sm:text-sm">
                              {fmtYMDPretty(e.date || null)}
                              <span className="mx-2 text-slate-300">•</span>
                              {where}
                            </div>

                            <div className="mt-1 text-sm font-black text-slate-900 sm:text-base">
                              {e.name || "Untitled event"}
                            </div>
                          </div>

                          {e.url ? (
                            <a
                              href={e.url}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 rounded-2xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800 flex items-center justify-center"
                            >
                              Tickets
                            </a>
                          ) : (
                            <div className="shrink-0 rounded-2xl bg-slate-200 px-4 py-2 text-xs font-extrabold text-slate-500 text-center">
                              No link
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="text-center">
                <div className="text-xl font-extrabold tracking-tight text-slate-900">Travel & Booking</div>
                <div className="mt-1 text-xs text-slate-500">Choose your origin airport, then book via Expedia.</div>

                <div className="mx-auto mt-4 w-full sm:max-w-md">
                  <AirportPicker
                    airports={airports}
                    valueIata={airportIata}
                    onPick={(iata) => setAirportIata(String(iata || "").toUpperCase())}
                    placeholder="Type city or IATA (e.g., Kelowna or YLW)"
                  />
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => openExpediaHotels(destinationQuery, checkin, checkout)}
                    className="h-12 rounded-2xl bg-slate-900 px-4 text-sm font-extrabold text-white hover:bg-slate-800"
                  >
                    Hotels
                  </button>

                  <button
                    type="button"
                    disabled={!hasOrigin}
                    onClick={() => {
                      if (!hasOrigin) return;
                      openExpediaFlights(airportIata, destinationForAir, checkin, checkout);
                    }}
                    className={cx(
                      "h-12 rounded-2xl px-4 text-sm font-extrabold transition",
                      hasOrigin ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                    )}
                  >
                    Flights
                  </button>

                  <button
                    type="button"
                    disabled={!hasOrigin}
                    onClick={() => {
                      if (!hasOrigin) return;
                      openExpediaFlightHotelBundle(airportIata, destinationForAir, checkin, checkout);
                    }}
                    className={cx(
                      "h-12 rounded-2xl px-4 text-sm font-extrabold transition",
                      hasOrigin ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                    )}
                  >
                    Packages
                  </button>
                </div>

                <div className="mt-4 text-xs text-slate-500">
                  Tip: hit <span className="font-bold">Share</span> above to text this exact page to a friend.
                </div>
              </div>
            </section>

            <div className="pb-6 pt-6 text-center text-xs text-slate-500">
              {APP_NAME} • {TAGLINE}
            </div>
          </>
        )}
      </div>
    </main>
  );
}