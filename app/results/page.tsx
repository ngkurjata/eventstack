// FILE: app/results/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type TripEvent = {
  date?: string | null;
  name?: string;
  location?: string;
  genre?: string | null;
  score?: number | null;
  url?: string | null;
};

type PotentialTrip = {
  tripKey?: string;
  startYMD?: string | null;
  endYMD?: string | null;
  locations?: string[];
  events?: TripEvent[];
};

type ApiResponse = {
  count?: number;
  potentialTrips?: PotentialTrip[];
  error?: string;
  debug?: any;
};

type MatchEvent = {
  id: string;
  name: string;
  url?: string | null;
  dateLocal?: string | null;
  venue?: string | null;
  city?: string | null;
  region?: string | null;
  segment?: "music" | "sports" | "other";
  genre?: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(x)));
}

/* -------------------- Date formatting -------------------- */

function parseYMDToUTC(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

const fmtUTC = (dt: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(dt);

function prettyYMD(ymd: string | null | undefined) {
  if (!ymd) return "—";
  const dt = parseYMDToUTC(ymd);
  if (!dt) return String(ymd);
  const m = fmtUTC(dt, { month: "short" });
  const d = fmtUTC(dt, { day: "2-digit" });
  const y = fmtUTC(dt, { year: "numeric" });
  return `${m} ${d}, ${y}`;
}

function addDaysYMD(ymd: string, delta: number): string {
  const dt = parseYMDToUTC(ymd);
  if (!dt) return ymd;
  dt.setUTCDate(dt.getUTCDate() + delta);
  const y = String(dt.getUTCFullYear());
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateTimeLocal(s?: string | null) {
  if (!s) return "Date TBD";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* -------------------- Expedia links (simple) -------------------- */

function buildExpediaHotelSearchUrl(opts: {
  destinationLabel: string; // "Anaheim, CA"
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

function ymdToDMY(ymd: string): string | null {
  const dt = parseYMDToUTC(ymd);
  if (!dt) return null;
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(dt.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
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
          ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800"
          : "bg-white text-slate-400 border-slate-200 cursor-not-allowed"
      )}
    >
      {label}
    </button>
  );
}

/* -------------------- Trip-matches helpers -------------------- */

function getTripLatLon(trip: PotentialTrip): { lat: number; lon: number } | null {
  const t: any = trip as any;

  const candidates: Array<[any, any]> = [
    [t.lat, t.lon],
    [t.latitude, t.longitude],
    [t.centerLat, t.centerLon],
    [t.center?.lat, t.center?.lon],
    [t.center?.latitude, t.center?.longitude],
    [t.coords?.lat, t.coords?.lon],
    [t.coords?.latitude, t.coords?.longitude],
    [t.location?.lat, t.location?.lon],
    [t.location?.latitude, t.location?.longitude],
  ];

  for (const [a, b] of candidates) {
    const lat = Number(a);
    const lon = Number(b);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return null;
}

// Hard rule: never show "Other" (or unsegmented) in matching events.
function keepOnlyMusicAndSportsMatches(evs: MatchEvent[]): MatchEvent[] {
  return (evs || []).filter((e) => e?.segment === "music" || e?.segment === "sports");
}

function Section({ title, items }: { title: string; items: MatchEvent[] }) {
  return (
    <div>
      <div className="text-xs font-black tracking-wide text-slate-600 uppercase">{title}</div>
      <div className="mt-2 divide-y rounded-xl border border-slate-200 bg-white">
        {items.map((e) => (
          <div key={e.id} className="px-3 py-2 text-sm">
            <div className="font-extrabold text-slate-900">{e.name}</div>
            <div className="text-slate-600">
              {formatDateTimeLocal(e.dateLocal)} · {e.venue || "Venue TBD"} · {e.city || ""}
              {e.region ? `, ${e.region}` : ""}
              {e.genre ? ` · ${e.genre}` : ""}
            </div>
            {e.url ? (
              <a
                className="inline-block mt-1 text-slate-900 underline font-extrabold"
                href={e.url}
                target="_blank"
                rel="noreferrer"
              >
                Tickets
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==================== PAGE ==================== */

export default function ResultsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const qs = useMemo(() => new URLSearchParams(sp.toString()), [sp]);
  const qsString = useMemo(() => qs.toString(), [qs]);

  const originIata = (qs.get("origin") || "").trim().toUpperCase();
  const hasOriginAirport = /^[A-Z]{3}$/.test(originIata);

  const tripDays = useMemo(() => clampInt(qs.get("tripDays"), 1, 30, 7), [qsString]);

  const radiusMiles = useMemo(() => {
    if (tripDays <= 3) return 60;
    if (tripDays <= 5) return 120;
    return 180;
  }, [tripDays]);

  const musicGenres = useMemo(
    () => qs.getAll("musicGenres").map((s) => s.trim()).filter(Boolean),
    [qsString]
  );
  const sportsGenres = useMemo(
    () => qs.getAll("sportsGenres").map((s) => s.trim()).filter(Boolean),
    [qsString]
  );

  // ✅ New rule: if no filters selected, matching events should be empty (always)
  const wantsAnyMatchingFilters = useMemo(
    () => musicGenres.length + sportsGenres.length > 0,
    [musicGenres, sportsGenres]
  );

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  function showToast(msg: string) {
    setToastMsg(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2200);
  }

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [matchesByKey, setMatchesByKey] = useState<Record<string, MatchEvent[]>>({});
  const [matchesLoadingByKey, setMatchesLoadingByKey] = useState<Record<string, boolean>>({});
  const [matchesErrorByKey, setMatchesErrorByKey] = useState<Record<string, string | null>>({});

  async function loadMatchesForTrip(tripKey: string, trip: PotentialTrip) {
    // ✅ NEW: if no interests selected, do not call /api/trip-matches; return empty
    if (!wantsAnyMatchingFilters) {
      setMatchesByKey((prev) => ({ ...prev, [tripKey]: [] }));
      setMatchesErrorByKey((prev) => ({ ...prev, [tripKey]: null }));
      setMatchesLoadingByKey((prev) => ({ ...prev, [tripKey]: false }));
      return;
    }

    if (matchesByKey[tripKey] || matchesLoadingByKey[tripKey]) return;

    const coords = getTripLatLon(trip);
    if (!coords) {
      showToast("This trip is missing coordinates (lat/lon). Update /api/search to include them per trip.");
      setMatchesErrorByKey((prev) => ({ ...prev, [tripKey]: "Missing lat/lon for this trip." }));
      return;
    }

    const primaryDay =
      Array.isArray((trip as any)?.events) && (trip as any).events[0]?.date
        ? String((trip as any).events[0].date)
        : trip.startYMD || "";

    if (!primaryDay) {
      showToast("This trip is missing a primary event date.");
      setMatchesErrorByKey((prev) => ({ ...prev, [tripKey]: "Missing primary event date for this trip." }));
      return;
    }

    const windowDays = tripDays <= 3 ? 1 : tripDays <= 5 ? 2 : 3;

    const start = addDaysYMD(primaryDay, -windowDays);
    const end = addDaysYMD(primaryDay, +windowDays);

    const p = new URLSearchParams();
    p.set("start", start);
    p.set("end", end);
    p.set("lat", String(coords.lat));
    p.set("lon", String(coords.lon));
    p.set("radiusMiles", String(radiusMiles));
    for (const g of musicGenres) p.append("musicGenres", g);
    for (const g of sportsGenres) p.append("sportsGenres", g);

    setMatchesLoadingByKey((prev) => ({ ...prev, [tripKey]: true }));
    setMatchesErrorByKey((prev) => ({ ...prev, [tripKey]: null }));

    try {
      const res = await fetch(`/api/trip-matches?${p.toString()}`, { cache: "no-store" });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 300) || "[empty body]"}`);
      }
      if (!res.ok) throw new Error(json?.error || `Failed (${res.status})`);

      const raw = Array.isArray(json?.events) ? (json.events as MatchEvent[]) : [];

      // ✅ HARD RULE: never show "Other" in matching events
      const evs = keepOnlyMusicAndSportsMatches(raw);

      setMatchesByKey((prev) => ({ ...prev, [tripKey]: evs }));
    } catch (e: any) {
      setMatchesErrorByKey((prev) => ({ ...prev, [tripKey]: e?.message || "Failed to load matching events" }));
    } finally {
      setMatchesLoadingByKey((prev) => ({ ...prev, [tripKey]: false }));
    }
  }

  useEffect(() => {
    if (!qsString) return;

    const ac = new AbortController();
    setLoading(true);

    (async () => {
      try {
        console.log("RESULTS qsString:", qsString);
console.log("RESULTS sportsGenres parsed:", sportsGenres);
        
        const res = await fetch(`/api/search?${qsString}`, {
          cache: "no-store",
          signal: ac.signal,
        });

        const text = await res.text();

        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 300) || "[empty body]"}`);
        }

        if (!res.ok) {
          throw new Error(json?.error || `Search failed (${res.status})`);
        }

        if (!ac.signal.aborted) {
          setData(json);
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setData({ error: e?.message || "Search failed" });
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => ac.abort();
  }, [qsString]);

  const errMsg = data?.error || null;

  const trips = useMemo(() => {
    const t = data?.potentialTrips;
    return Array.isArray(t) ? t : [];
  }, [data]);

  const count = trips.length;

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="text-slate-800 font-extrabold">Loading results…</div>
        </div>
      </main>
    );
  }

  if (errMsg) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="text-red-700 font-extrabold">Search failed: {errMsg}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-full bg-slate-900 text-white px-4 py-2 text-xs font-extrabold shadow-lg">
            {toastMsg}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 pt-6 pb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-extrabold text-slate-700">
          Trips: <span className="text-slate-900">{count}</span>{" "}
          <span className="text-slate-400 font-black">(tripDays={tripDays}, radiusMiles={radiusMiles})</span>
        </div>

        <button
          type="button"
          onClick={() => router.push(`/?${qsString}`)}
          className="rounded-xl px-4 py-2 text-xs font-extrabold transition border bg-white text-slate-900 border-slate-200 hover:bg-slate-100"
          title="Go back and revise your search"
        >
          Revise Search
        </button>
      </div>

      {count === 0 ? (
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="rounded-2xl bg-white border border-slate-200 p-6">
            <div className="text-slate-900 font-extrabold">No Results</div>
            <div className="mt-2 text-sm text-slate-600">
              Your API returned 0 potentialTrips. If you think that’s wrong, open{" "}
              <span className="font-mono">/api/search?{qsString}</span> and check the debug counts.
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto px-4 pb-10 space-y-6">
          {trips.map((trip, idx) => {
            const key = trip.tripKey || `${trip.startYMD || "x"}-${trip.endYMD || "x"}-${idx}`;
            const locs = Array.isArray(trip.locations) ? trip.locations : [];
            const destinationLabel = locs[0] || "";

            const checkIn = trip.startYMD || null;
            const checkOut = trip.endYMD || null;

            const hotelsUrl =
              destinationLabel && checkIn && checkOut
                ? buildExpediaHotelSearchUrl({
                    destinationLabel,
                    checkInYMD: checkIn,
                    checkOutYMD: checkOut,
                  })
                : null;

            const flightsUrl =
              hasOriginAirport && checkIn && checkOut
                ? buildExpediaFlightsOnlyUrl({
                    fromIata: originIata,
                    toIata: "LAX",
                    departYMD: checkIn,
                    returnYMD: checkOut,
                  })
                : null;

            const events = Array.isArray(trip.events) ? trip.events : [];

            const isExpanded = expandedKey === key;
            const matches = matchesByKey[key] || null;
            const matchesLoading = !!matchesLoadingByKey[key];
            const matchesErr = matchesErrorByKey[key] || null;

            const coords = getTripLatLon(trip);

            // ✅ Require filters to expand
            const canExpand = !!coords && !!trip.startYMD && !!trip.endYMD && wantsAnyMatchingFilters;

            const music = (matches || []).filter((e) => e.segment === "music");
            const sports = (matches || []).filter((e) => e.segment === "sports");

            return (
              <section key={key} className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 bg-slate-900 text-white flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-lg font-extrabold">
                      {prettyYMD(trip.startYMD)} → {prettyYMD(trip.endYMD)}
                    </div>
                    <div className="text-sm font-bold text-white/80">
                      {locs.length ? locs.join(" • ") : "Location TBD"}
                    </div>

                    <div className="mt-3">
                      <button
                        type="button"
                        disabled={!canExpand}
                        onClick={() => {
                          if (!canExpand) {
                            if (!coords) showToast("Trip missing lat/lon. Update /api/search to include coordinates per trip.");
                            else if (!wantsAnyMatchingFilters) showToast("Select at least one filter (Music/Sports) to show matching events.");
                            else showToast("Trip is missing dates.");
                            return;
                          }
                          const next = isExpanded ? null : key;
                          setExpandedKey(next);
                          if (next) loadMatchesForTrip(key, trip);
                        }}
                        className={cx(
                          "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-extrabold border transition",
                          canExpand
                            ? "bg-white text-slate-900 border-white/40 hover:bg-white/90"
                            : "bg-white/10 text-white/50 border-white/15 cursor-not-allowed"
                        )}
                        title={
                          canExpand
                            ? "Show additional events that match your selected filters"
                            : !coords
                            ? "Disabled: this trip has no coordinates (lat/lon)"
                            : !wantsAnyMatchingFilters
                            ? "Disabled: select at least one filter (Music/Sports)"
                            : "Disabled: missing dates"
                        }
                      >
                        {isExpanded ? "Hide matching events" : "Show matching events"}
                      </button>

                      {!canExpand && (
                        <div className="mt-2 text-[11px] text-white/60">
                          {!coords
                            ? (
                              <>
                                To enable this, return lat/lon for each trip from <span className="font-mono">/api/search</span>.
                              </>
                            )
                            : !wantsAnyMatchingFilters
                            ? "Select at least one Music/Sports filter to enable matching events."
                            : "This trip is missing dates."}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <TravelButton
                      label="Hotels"
                      enabled={!!hotelsUrl}
                      title={hotelsUrl ? "Search hotels on Expedia" : "Missing destination/dates"}
                      onClick={() => hotelsUrl && window.open(hotelsUrl, "_blank")}
                    />
                    <TravelButton
                      label="Flights"
                      enabled={!!flightsUrl}
                      title={
                        flightsUrl
                          ? "Search flights on Expedia (placeholder destination IATA)"
                          : !hasOriginAirport
                          ? "Add origin airport to enable flights (origin=XXX)"
                          : "Missing dates"
                      }
                      onClick={() => {
                        if (!hasOriginAirport) return showToast("Add origin=IATA to enable flights.");
                        if (!flightsUrl) return showToast("Flights link unavailable.");
                        window.open(flightsUrl, "_blank");
                      }}
                    />
                    <TravelButton
                      label="Flight + Hotel"
                      enabled={false}
                      title="Disabled on debug page (we'll re-enable after results are stable)"
                      onClick={() => {}}
                    />
                  </div>
                </div>

                <div className="p-4 sm:p-5 overflow-x-auto">
                  <table className="min-w-[860px] w-full border-separate border-spacing-0">
                    <thead>
                      <tr className="text-left text-xs font-extrabold text-slate-600">
                        <th className="py-2 pr-3 border-b border-slate-200">Date</th>
                        <th className="py-2 pr-3 border-b border-slate-200">Event</th>
                        <th className="py-2 pr-3 border-b border-slate-200">Location</th>
                        <th className="py-2 pr-3 border-b border-slate-200">Genre</th>
                        <th className="py-2 pr-0 border-b border-slate-200 text-right">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((ev, j) => {
                        const d = ev.date || "";
                        const name = ev.name || "";
                        const loc = ev.location || "";
                        const genre = ev.genre || "";
                        const score = Number(ev.score ?? 0);

                        return (
                          <tr key={`${key}-${j}`} className="text-sm text-slate-800">
                            <td className="py-2 pr-3 border-b border-slate-100 font-semibold whitespace-nowrap">
                              {prettyYMD(d)}
                            </td>

                            <td className="py-2 pr-3 border-b border-slate-100 min-w-[360px]">
                              {ev.url ? (
                                <a
                                  href={ev.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-extrabold text-slate-900 hover:underline"
                                >
                                  {name}
                                </a>
                              ) : (
                                <span className="font-extrabold">{name}</span>
                              )}
                            </td>

                            <td className="py-2 pr-3 border-b border-slate-100">{loc}</td>
                            <td className="py-2 pr-3 border-b border-slate-100">{genre || "—"}</td>
                            <td className="py-2 pr-0 border-b border-slate-100 text-right font-extrabold">
                              {Number.isFinite(score) ? score : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {isExpanded && (
                    <div className="mt-5">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-sm font-extrabold text-slate-900">
                            Matching events (within {radiusMiles} miles)
                          </div>
                          <div className="text-[11px] text-slate-600">
                            Filters:{" "}
                            {musicGenres.length ? `Music=${musicGenres.join(", ")}` : "Music=None"} ·{" "}
                            {sportsGenres.length ? `Sports=${sportsGenres.join(", ")}` : "Sports=None"}
                          </div>
                        </div>

                        {matchesLoading && <div className="mt-3 text-sm text-slate-600">Loading matches…</div>}

                        {!matchesLoading && matchesErr && (
                          <div className="mt-3 text-sm text-red-700 font-bold">{matchesErr}</div>
                        )}

                        {!matchesLoading && !matchesErr && matches && matches.length === 0 && (
                          <div className="mt-3 text-sm text-slate-600">
                            No additional events matched your filters for this trip window.
                          </div>
                        )}

                        {!matchesLoading && !matchesErr && matches && matches.length > 0 && (
                          <div className="mt-4 space-y-5">
                            {music.length > 0 && <Section title={`Music (${music.length})`} items={music} />}
                            {sports.length > 0 && <Section title={`Sports (${sports.length})`} items={sports} />}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 text-[11px] text-slate-500">
                    Key: <span className="font-mono">{key}</span>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
