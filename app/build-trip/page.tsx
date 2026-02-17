// FILE: app/build-trip/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

// ✅ Use the same picker you use on app/page.tsx
import { AirportPicker, type Airport } from "../components/AirportPicker";

/* -------------------- Types -------------------- */

type RowEvent = {
  date?: string | null; // YYYY-MM-DD
  name?: string;
  location?: string; // "City, ST"
  genre?: string | null;
  url?: string | null; // ticketmaster link
};

type BuildTripPayload = {
  rowKey?: string;
  airport?: string; // origin IATA saved from results page
  anchor?: RowEvent;
  events?: RowEvent[];
};

/* -------------------- Helpers -------------------- */

function safeParseData(raw: string | null): BuildTripPayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

function firstEventCityWithAirportIata(events: RowEvent[], airports: Airport[]) {
  for (const e of events) {
    const { city, region } = parseCityRegion(e.location);
    if (!city) continue;

    const iata = findDestIataFromCity(airports, city, region);
    if (iata) return { city, region, iata };
  }
  return { city: "", region: "", iata: "" };
}

function eventKey(e: RowEvent) {
  return [e.date || "", e.location || "", e.name || "", e.url || ""].join("|");
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

function parseCityRegion(loc?: string | null) {
  const raw = String(loc || "").trim();
  if (!raw) return { city: "", region: "" };
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const city = parts[0] || raw;
  const region = parts[1] || "";
  return { city, region };
}

function norm(s: any) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pickPrimaryDestination(events: RowEvent[]) {
  // Choose the most common "City, ST" across selected events; fallback to first event
  const counts = new Map<string, number>();
  for (const e of events) {
    const loc = String(e.location || "").trim();
    if (!loc) continue;
    counts.set(loc, (counts.get(loc) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [k, n] of counts.entries()) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  const chosen = best || String(events?.[0]?.location || "").trim();
  const { city, region } = parseCityRegion(chosen);
  const q = [city, region].filter(Boolean).join(", ");
  return { city, region, q };
}

/**
 * Find a destination IATA based on city (+ optional region) using your airports.min.json.
 * Prefers:
 *  - exact city+region match
 *  - else exact city match
 *  - else none
 */
function findDestIataFromCity(airports: Airport[], city: string, region: string) {
  const c = norm(city);
  const r = norm(region);

  if (!c) return "";

  const exactCityRegion = airports.find(
    (a) => norm((a as any).city) === c && r && norm((a as any).region) === r && norm(a.iata)
  );
  if (exactCityRegion?.iata) return String(exactCityRegion.iata).toUpperCase();

  const exactCity = airports.find((a) => norm((a as any).city) === c && norm(a.iata));
  if (exactCity?.iata) return String(exactCity.iata).toUpperCase();

  return "";
}

/**
 * Browser-safe base64url encode for arbitrary unicode JSON:
 * - utf8 -> bytes -> binary string -> btoa -> base64url
 */
function b64urlEncodeJson(obj: any) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);

  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);

  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildShareUrl(payload: BuildTripPayload) {
  // Your share/page.tsx reads query param "o"
  const encoded = encodeURIComponent(b64urlEncodeJson(payload));
  return `/share?o=${encoded}`;
}

/* -------------------- Expedia booking links -------------------- */

function ymdToExpediaMDY(ymd: string | null) {
  // Expedia Flights-Search commonly uses M/D/YYYY in the leg strings.
  if (!ymd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return "";
  const mm = String(parseInt(m[2], 10)); // remove leading 0
  const dd = String(parseInt(m[3], 10));
  const yyyy = m[1];
  return `${mm}/${dd}/${yyyy}`;
}

function openExpediaHotels(destination: string, checkinYMD: string | null, checkoutYMD: string | null) {
  const qs = new URLSearchParams();
  qs.set("rooms", "1");
  qs.set("adults", "1");
  if (destination) qs.set("destination", destination);
  if (checkinYMD) qs.set("startDate", checkinYMD);
  if (checkoutYMD) qs.set("endDate", checkoutYMD);
  // Some Expedia variants also accept d1/d2; optional but harmless
  if (checkinYMD) qs.set("d1", checkinYMD);
  if (checkoutYMD) qs.set("d2", checkoutYMD);

  const url = `https://www.expedia.com/Hotel-Search?${qs.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
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

  // Expedia expects these "leg" strings
  // Example format: leg1=from:ICT,to:YVR,departure:2/16/2026TANYT  :contentReference[oaicite:1]{index=1}
  if (o && d && dep) qs.set("leg1", `from:${o},to:${d},departure:${dep}TANYT`);
  if (o && d && ret) qs.set("leg2", `from:${d},to:${o},departure:${ret}TANYT`);

  const url = `https://www.expedia.com/Flights-Search?${qs.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function openExpediaFlightHotelBundle(originIata: string, destination: string, departYMD: string | null, returnYMD: string | null) {
  const qs = new URLSearchParams();
  qs.set("packageType", "fh"); // flight + hotel bundle
  qs.set("tripType", "ROUND_TRIP");
  qs.set("adults", "1");
  qs.set("cabinClass", "COACH");
  qs.set("directFlights", "false");
  qs.set("partialStay", "false");
  qs.set("searchProduct", "hotel");

  if (destination) qs.set("destination", destination);
  if (departYMD) qs.set("startDate", departYMD);
  if (returnYMD) qs.set("endDate", returnYMD);
  if (originIata) {
    // Expedia often accepts origin as a string; IATA-only is usually fine,
    // but if you want richer origin text later, you can store the full label.
    qs.set("origin", originIata.toUpperCase());
  }

  // Hotel-Search bundle URL pattern exists widely with packageType=fh :contentReference[oaicite:2]{index=2}
  const url = `https://www.expedia.com/Hotel-Search?${qs.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

/* -------------------- Page -------------------- */

export default function BuildTripPage() {
  const sp = useSearchParams();

  const data = useMemo(() => safeParseData(sp.get("data")), [sp]);
  const initialAirport = String(data?.airport || "").toUpperCase();

  const [airports, setAirports] = useState<Airport[]>([]);
  const [airportIata, setAirportIata] = useState<string>(initialAirport);

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

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
          Missing or invalid trip data.
        </div>
      </div>
    );
  }

  const events: RowEvent[] = Array.isArray(data.events) ? data.events : [];
  const { start, end } = minMaxYMD(events);

  // Hotel/flight dates: 1 day before first event and 1 day after last event
  const checkin = addDaysUTC(start, -1);
  const checkout = addDaysUTC(end, +1);

  // Destination: most common city/state among selected events (fallback to first)
  const dest = pickPrimaryDestination(events);

  // Destination airport (IATA): first city in events with an airport (using chosen dest city)
const destAirport = useMemo(() => {
  return firstEventCityWithAirportIata(events, airports);
}, [events, airports]);

const destIata = destAirport.iata;

  const payloadForShare: BuildTripPayload = {
    ...data,
    airport: airportIata,
    events,
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="text-lg font-black tracking-tight text-slate-900">Your trip</div>

        <button
          type="button"
          onClick={() => {
            const shareUrl = buildShareUrl(payloadForShare);
            const full = `${window.location.origin}${shareUrl}`;
            navigator.clipboard?.writeText(full).catch(() => {});
          }}
          className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
          title="Copy share link"
        >
          Share
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-black text-slate-600">Destination</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{dest.q || "—"}</div>

            <div className="mt-2 text-xs font-semibold text-slate-600">
              Events: {fmtYMDPretty(start)} → {fmtYMDPretty(end)}
            </div>

            <div className="mt-1 text-xs font-semibold text-slate-600">
              Hotel/flight dates: {fmtYMDPretty(checkin)} → {fmtYMDPretty(checkout)}
            </div>

            <div className="mt-1 text-[11px] font-bold text-slate-500">
Destination airport: {destIata ? destIata : "— (no event city matched an airport)"}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-black text-slate-600">Departure airport</div>
            <div className="mt-3">
              <AirportPicker
                airports={airports}
                valueIata={airportIata}
                onPick={(iata) => setAirportIata(String(iata || "").toUpperCase())}
                placeholder="Type city or IATA (e.g., Kelowna or YLW)"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {events.map((e) => (
            <div key={eventKey(e)} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">
                    {fmtYMDPretty(e.date || null)} · {e.location || "Location TBD"}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-800">{e.name || "Untitled event"}</div>
                </div>

                {e.url ? (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-2xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800"
                  >
                    Tickets
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => {
              // Flights destination: use IATA if found, else fall back to city query (less ideal but workable)
              const destForFlights = destIata || dest.q;
              openExpediaFlights(airportIata, destForFlights, checkin, checkout);
            }}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-50"
          >
            Flights (Expedia)
          </button>

          <button
            type="button"
            onClick={() => openExpediaHotels(dest.q, checkin, checkout)}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-50"
          >
            Hotels (Expedia)
          </button>

          <button
            type="button"
            onClick={() => openExpediaFlightHotelBundle(airportIata, dest.q, checkin, checkout)}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800"
          >
            Flight + Hotel (Expedia)
          </button>
        </div>
      </div>
    </div>
  );
}
