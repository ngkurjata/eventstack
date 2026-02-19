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
};

type BuildTripPayload = {
  rowKey?: string;
  airport?: string;
  anchor?: RowEvent;
  events?: RowEvent[];

  cityState?: string;

  // Event dates (for header + sharing)
  startYMD?: string | null;
  endYMD?: string | null;

  // Travel dates (for Expedia autopopulate)
  checkinYMD?: string | null;
  checkoutYMD?: string | null;

  fallbackTitles?: string[];
};

/* -------------------- Small utils -------------------- */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function safeParseData(raw: string | null): BuildTripPayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function normCityState(s: any) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim()
    .toLowerCase();
}

function pickDisplayCityState(citiesInOrder: string[]) {
  const cleaned = (citiesInOrder || []).map((x) => String(x || "").trim()).filter(Boolean);
  const uniq: string[] = [];
  const seen = new Set<string>();

  for (const c of cleaned) {
    const k = normCityState(c);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
  }

  if (uniq.length === 0) return "Your trip";
  if (uniq.length === 1) return uniq[0];
  return `${uniq[0]} Area`;
}

function mostCommon(items: string[]) {
  const counts = new Map<string, number>();
  for (const x of items) counts.set(x, (counts.get(x) || 0) + 1);
  let best = "";
  let bestN = 0;
  for (const [k, n] of counts.entries()) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

function computeMetroAnchorFallback(cityLabels: string[]) {
  const parsed = cityLabels.map((lbl) => parseCityRegion(lbl));
  const regions = parsed.map((p) => p.region).filter(Boolean);
  const topRegion = mostCommon(regions);

  if (topRegion) {
    const citiesInRegion = parsed
      .filter((p) => p.region === topRegion)
      .map((p) => p.city)
      .filter(Boolean);
    const topCity = mostCommon(citiesInRegion);
    if (topCity) return { metroName: topCity, metroLabel: `${topCity}, ${topRegion}` };
  }

  const topCity = mostCommon(parsed.map((p) => p.city).filter(Boolean));
  if (topCity) {
    const region = parsed.find((p) => p.city === topCity)?.region || "";
    return { metroName: topCity, metroLabel: region ? `${topCity}, ${region}` : topCity };
  }

  return { metroName: "Your trip", metroLabel: "Your trip" };
}

/* -------------------- Geo metro anchoring -------------------- */

function isFiniteNum(x: any): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 3958.7613;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return R * c;
}

function regionShort(region: string) {
  const r = String(region || "");
  return r.includes("-") ? r.split("-")[1] : r;
}

function airportMetroLabel(a: Airport) {
  const rs = regionShort((a as any).region);
  const city = String((a as any).city || "").trim();
  if (!city) return a.iata;
  return [city, rs].filter(Boolean).join(", ");
}

function computeMetroFromGeo(events: RowEvent[], airports: Airport[]) {
  const pts = events
    .map((e) => ({ lat: e.lat, lon: e.lon }))
    .filter((p) => isFiniteNum(p.lat) && isFiniteNum(p.lon)) as Array<{ lat: number; lon: number }>;

  if (pts.length === 0) return null;

  const centroid = pts.reduce(
    (acc, p) => {
      acc.lat += p.lat;
      acc.lon += p.lon;
      return acc;
    },
    { lat: 0, lon: 0 }
  );

  centroid.lat /= pts.length;
  centroid.lon /= pts.length;

  const candidates = airports.filter((a) => isFiniteNum(a.lat) && isFiniteNum(a.lon));
  if (candidates.length === 0) return null;

  let best: Airport | null = null;
  let bestMiles = Infinity;

  for (const a of candidates) {
    const d = haversineMiles(
      { lat: centroid.lat, lon: centroid.lon },
      { lat: a.lat as number, lon: a.lon as number }
    );
    if (d < bestMiles) {
      bestMiles = d;
      best = a;
    }
  }

  if (!best) return null;

  return {
    airport: best,
    metroName: String((best as any).city || "").trim() || best.iata,
    metroLabel: airportMetroLabel(best),
    pointsUsed: pts.length,
  };
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
  const qs = new URLSearchParams();
  qs.set("rooms", "1");
  qs.set("adults", "1");
  if (destination) qs.set("destination", destination);
  if (checkinYMD) qs.set("startDate", checkinYMD);
  if (checkoutYMD) qs.set("endDate", checkoutYMD);
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

  if (o && d && dep) qs.set("leg1", `from:${o},to:${d},departure:${dep}TANYT`);
  if (o && d && ret) qs.set("leg2", `from:${d},to:${o},departure:${ret}TANYT`);

  const url = `https://www.expedia.com/Flights-Search?${qs.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function openExpediaFlightHotelBundle(originIata: string, destination: string, departYMD: string | null, returnYMD: string | null) {
  const o = String(originIata || "").trim().toUpperCase();
  const d = String(destination || "").trim();

  if (!departYMD || !returnYMD || !o || !d) return;

  const qs = new URLSearchParams();
  qs.set("FromAirport", o);
  qs.set("Destination", d);
  qs.set("NumRoom", "1");
  qs.set("NumAdult", "1");

  const url = `https://www.expedia.com/go/package/search/FlightHotel/${departYMD}/${returnYMD}?${qs.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

/* -------------------- Page -------------------- */

export default function BuildTripPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const data = useMemo(() => safeParseData(sp.get("data")), [sp]);

  const events: RowEvent[] = useMemo(() => {
    return Array.isArray(data?.events) ? (data?.events as RowEvent[]) : [];
  }, [data]);

  const cities = useMemo(() => uniqueCitiesInOrder(events), [events]);
  const displayCityState = useMemo(() => pickDisplayCityState(cities), [cities]);

  const { start, end } = useMemo(() => minMaxYMD(events), [events]);
  const checkin = useMemo(() => addDaysUTC(start, -1), [start]);
  const checkout = useMemo(() => addDaysUTC(end, +1), [end]);

  const eventStart = start; // first event date
  const eventEnd = end; // last event date

  const [airports, setAirports] = useState<Airport[]>([]);
  const initialAirport = useMemo(() => String(data?.airport || "").toUpperCase(), [data]);
  const [airportIata, setAirportIata] = useState<string>(initialAirport);
  const [copiedToast, setCopiedToast] = useState(false);

  useEffect(() => setAirportIata(initialAirport), [initialAirport]);

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

  const metroGeo = useMemo(() => computeMetroFromGeo(events, airports), [events, airports]);

  const metro = useMemo(() => {
    if (metroGeo) {
      return {
        metroName: metroGeo.metroName,
        metroLabel: metroGeo.metroLabel,
        destIata: metroGeo.airport.iata,
      };
    }
    const fallback = computeMetroAnchorFallback(cities);
    return { ...fallback, destIata: "" };
  }, [metroGeo, cities]);

  const destinationQuery = useMemo(() => metro.metroLabel || "", [metro]);
  const hasOrigin = Boolean(airportIata && airportIata.trim());

  const payloadForShare: BuildTripPayload = useMemo(() => {
    return {
      ...(data || {}),
      airport: airportIata,
      events,
      cityState: displayCityState,
      // For displaying/sharing (event dates)
      startYMD: eventStart,
      endYMD: eventEnd,
      // Travel dates (for deep links)
      checkinYMD: checkin,
      checkoutYMD: checkout,
      fallbackTitles: events.map((e) => e?.name).filter(Boolean) as string[],
    };
  }, [data, airportIata, events, displayCityState, checkin, checkout, eventStart, eventEnd]);

  if (!data) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto w-full max-w-md px-4 py-10 lg:max-w-3xl">
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
            <div className="text-sm font-black">Missing or invalid trip data.</div>
            <div className="mt-2 text-sm font-semibold text-rose-700">
              Go back to results and rebuild your trip selection.
            </div>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-5 h-11 w-full rounded-2xl bg-slate-900 text-sm font-extrabold text-white hover:bg-slate-800"
            >
              Back to search
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Brand bar */}
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-4 lg:max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
<BrandLogo />
              <div className="min-w-0">
                <div className="text-base font-black tracking-tight text-slate-900 truncate">
                  Build trip
                </div>
                <div className="text-xs text-slate-600 truncate">
  {TAGLINE}
</div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => router.push("/")}
                className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-extrabold text-slate-800 hover:bg-slate-50"
                title="Search again"
              >
                Search
              </button>

              <button
                type="button"
                onClick={async () => {
                  const homeUrl = "https://eventstack.vercel.app/";
                  const city = payloadForShare.cityState || "Trip location";

                  const startYMD = payloadForShare.startYMD || null;
                  const endYMD = payloadForShare.endYMD || null;

                  const startText = fmtYMDPretty(startYMD);
                  const endText = fmtYMDPretty(endYMD);

                  const dateLine =
                    startYMD && endYMD
                      ? startYMD === endYMD
                        ? startText
                        : `${startText} - ${endText}`
                      : startText || endText || "";

                  const titlesArr = (payloadForShare.fallbackTitles || [])
                    .filter(Boolean)
                    .map(String)
                    .slice(0, 3);

                  const cityBold = `*${city}*`;

                  const shareTextShort = [
                    "Check out what I found at EventStack!",
                    "",
                    cityBold,
                    "",
                    dateLine,
                    "",
                    ...titlesArr.map((t) => `✅ ${t}`),
                    "",
                    "We should definitely plan a trip!",
                    "",
                    `${homeUrl}`,
                  ]
                    .filter((v) => v !== null && v !== undefined)
                    .join("\n");

                  try {
                    if (navigator.share) {
                      await navigator.share({
                        title: "EventStack trip idea",
                        text: shareTextShort,
                      });
                      return;
                    }
                  } catch {
                    // user canceled OR share failed — fall back below
                  }

                  const textMessage = shareTextShort;

                  const htmlMessage = `
                    <div style="font-family: Arial, sans-serif; line-height: 1.35;">
                      <p style="margin:0 0 10px 0;"><strong>Hear me out…</strong> we should do this trip:</p>
                      <p style="margin:0 0 10px 0;">
                        <strong>${escapeHtml(city)}</strong><br/>
                        ${escapeHtml(dateLine)}
                      </p>
                      ${
                        titlesArr.length
                          ? `<p style="margin:0 0 10px 0;">${titlesArr
                              .map((t) => `✅ ${escapeHtml(t)}`)
                              .join("<br/>")}</p>`
                          : ""
                      }
                      <p style="margin:0;">
                        <a href="${homeUrl}" style="font-weight:700; text-decoration:none;">
                          Check out EventStack!
                        </a><br/>
                        <span style="color:#64748b; font-size:12px;">${escapeHtml(homeUrl)}</span>
                      </p>
                    </div>
                  `;

                  try {
                    await navigator.clipboard.write([
                      new ClipboardItem({
                        "text/html": new Blob([htmlMessage], { type: "text/html" }),
                        "text/plain": new Blob([textMessage], { type: "text/plain" }),
                      }),
                    ]);
                    setCopiedToast(true);
                    setTimeout(() => setCopiedToast(false), 2000);
                  } catch {
                    try {
                      await navigator.clipboard.writeText(textMessage);
                      setCopiedToast(true);
                      setTimeout(() => setCopiedToast(false), 2000);
                    } catch {
                      // clipboard blocked
                    }
                  }
                }}
                className="rounded-2xl bg-slate-900 px-3.5 py-2 text-[11px] font-extrabold text-white hover:bg-slate-800"
                title="Share this trip"
              >
                Share
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-3xl lg:py-10">
        {/* Summary card */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="text-center">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">
              {displayCityState}
            </h1>

            <div className="mt-3 text-base font-extrabold text-slate-800 sm:text-lg">
              {fmtYMDPretty(eventStart)} → {fmtYMDPretty(eventEnd)}
            </div>

            <div className="mt-2 text-xs text-slate-500">
              Travel dates for booking: {fmtYMDPretty(checkin)} → {fmtYMDPretty(checkout)}
            </div>
          </div>
        </section>

        {/* Events card */}
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 text-center">
            <div className="text-xl font-extrabold tracking-tight text-slate-900">Events</div>
            <div className="mt-1 text-xs text-slate-500">Tickets open in a new tab.</div>
          </div>

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
        </section>

        {/* Travel / Booking card */}
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="text-center">
            <div className="text-xl font-extrabold tracking-tight text-slate-900">
              Travel & Booking
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Choose your origin airport, then book via Expedia.
            </div>

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
                  const destForFlights = metro.destIata || destinationQuery;
                  openExpediaFlights(airportIata, destForFlights, checkin, checkout);
                }}
                className={cx(
                  "h-12 rounded-2xl px-4 text-sm font-extrabold transition",
                  hasOrigin
                    ? "bg-slate-900 text-white hover:bg-slate-800"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                )}
              >
                Flights
              </button>

              <button
                type="button"
                disabled={!hasOrigin}
                onClick={() => {
                  if (!hasOrigin) return;
                  openExpediaFlightHotelBundle(airportIata, destinationQuery, checkin, checkout);
                }}
                className={cx(
                  "h-12 rounded-2xl px-4 text-sm font-extrabold transition",
                  hasOrigin
                    ? "bg-slate-900 text-white hover:bg-slate-800"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                )}
              >
                Packages
              </button>
            </div>
          </div>
        </section>

        <div className="pb-6 pt-6 text-center text-xs text-slate-500">
  {APP_NAME} • {TAGLINE}
</div>
      </div>

      {/* Clipboard Toast */}
      {copiedToast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-black text-white shadow-xl">
            Link copied ✓
          </div>
        </div>
      )}
    </main>
  );
}
