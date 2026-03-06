// FILE: app/trips/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "../components/BrandLogo";
import { useSaveTrip } from "@/lib/trips/useSaveTrip";
import type { TripDraft, TripEvent } from "@/lib/trips/saveTrip";

type ApiEvent = {
  id: string;
  name: string;
  localDate: string | null;
  localTime: string | null;
  city: string;
  region: string;
  venueName: string;
  url: string | null;
  matchedFavorites: string[];
  pillLabel: string;
};

type ApiTrip = {
  id: string;
  dest: { label: string; lat: number; lon: number };
  windowStart: string;
  windowEnd: string;
  tripDays: number;
  radiusMiles: number;
  score: number;
  breakdown: Record<string, number>;
  sampleEvents: Array<{
    date: string;
    name: string;
    location: string;
    favKey: string;
    url: string | null;
  }>;
  reasons: string[];
  openUrl: string;
};

type TripBucket = {
  label: string;
  minCoverage: number;
  trips: ApiTrip[];
};

type TripsResp = {
  ok?: boolean;
  error?: string;
  warning?: string;
  count?: number;
  trips?: ApiTrip[];
  buckets?: TripBucket[];
  dateRange?: { start?: string; end?: string; tripDays?: number };
  debug?: any;
};

type EventsResp = {
  count?: number;
  events?: ApiEvent[];
  error?: string;
  debug?: any;
};

function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function flattenBuckets(buckets: TripBucket[] | undefined): ApiTrip[] {
  const out: ApiTrip[] = [];
  for (const b of buckets || []) {
    for (const t of b.trips || []) out.push(t);
  }
  return out;
}

/**
 * Your curated “major / popular” cities order (best = earliest).
 * Used only for UI labeling (dominant market name on the card).
 */
const POPULAR_CITIES_ORDER: string[] = [
  "New York City",
  "Los Angeles",
  "Chicago",
  "San Francisco",
  "Washington",
  "Las Vegas",
  "Miami",
  "Boston",
  "Seattle",
  "New Orleans",
  "Vancouver",
  "Toronto",
  "Montreal",
  "Orlando",
  "Honolulu",
  "San Diego",
  "Austin",
  "Philadelphia",
  "Atlanta",
  "Nashville",
  "Charleston",
  "Quebec City",
  "Calgary",
  "Edmonton",
  "Ottawa",
  "Tampa",
  "San Antonio",
  "Portland",
  "Sacramento",
  "Detroit",
  "Cancun",
  "Salt Lake City",
  "Charlotte",
];

function normCityName(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.]/g, "")
    .replace(/\b(dc)\b/g, "dc");
}

const POPULAR_CITY_RANK = new Map<string, number>(
  POPULAR_CITIES_ORDER.map((c, i) => [normCityName(c), i])
);

function extractCityFromLocation(location: string): string | null {
  // Typical: "Venue • City, ST" or "City, ST"
  const s = String(location || "").trim();
  if (!s) return null;

  const part = s.includes("•") ? s.split("•").pop()!.trim() : s;
  const cityPart = part.includes(",") ? part.split(",")[0].trim() : part.trim();
  if (!cityPart) return null;

  // Normalize common “Washington, DC” handling:
  if (normCityName(cityPart) === "washington") return "Washington";
  return cityPart;
}

function pickMajorCityLabel(t: ApiTrip): string {
  const candidates: string[] = [];

  // 1) sampleEvents locations (no extra API calls)
  for (const se of t.sampleEvents || []) {
    const c = extractCityFromLocation(se.location);
    if (c) candidates.push(c);
  }

  // 2) also consider the seed label
  if (t?.dest?.label) {
    const seedCity = extractCityFromLocation(t.dest.label) || t.dest.label;
    if (seedCity) candidates.push(seedCity);
  }

  let best: { rank: number; label: string } | null = null;

  for (const c of candidates) {
    const key = normCityName(c);
    const rank = POPULAR_CITY_RANK.get(key);
    if (rank === undefined) continue;
    if (!best || rank < best.rank) best = { rank, label: c };
  }

  // If none are in the popular list, fall back to seed label
  return best?.label || t.dest.label;
}

function normFavKey(s: string) {
  const x = String(s || "").trim().toUpperCase();
  if (x === "F1" || x.includes("F1") || x.includes("FAVORITE 1")) return "F1";
  if (x === "F2" || x.includes("F2") || x.includes("FAVORITE 2")) return "F2";
  if (x === "G1" || x.includes("G1") || x.includes("GENRE 1")) return "G1";
  if (x === "G2" || x.includes("G2") || x.includes("GENRE 2")) return "G2";
  return x;
}

function hasBothF1F2(t: ApiTrip): boolean {
  // Prefer sampleEvents favKey (most reliable for “included in trip”)
  const keys = new Set<string>();
  for (const se of t.sampleEvents || []) keys.add(normFavKey(se.favKey));

  if (keys.has("F1") && keys.has("F2")) return true;

  // Fallback: breakdown key names (if they use F1/F2 naming)
  const bd = t.breakdown || {};
  const bdKeys = Object.keys(bd).map((k) => normFavKey(k));
  const bdHasF1 = bdKeys.includes("F1") && (bd["F1"] ?? 1) > 0;
  const bdHasF2 = bdKeys.includes("F2") && (bd["F2"] ?? 1) > 0;
  if (bdHasF1 && bdHasF2) return true;

  // Final fallback: “2+ favorites present” (still useful highlight if naming differs)
  const favLike = Object.entries(bd).filter(([k, v]) => v > 0 && /(^|\b)F\d\b|favorite/i.test(k));
  return favLike.length >= 2;
}

function weekdayLabelFromYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(dt);
}

function formatMonthDayFromYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(dt);
}

export default function TripsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const spStr = sp.toString();
  const params = useMemo(() => new URLSearchParams(spStr), [spStr]);

  // ✅ No inference, no rewriting: Home owns the contract
  const apiTripsQs = spStr;

  const mode = String(params.get("mode") || "").trim().toUpperCase();
  const startParam = String(params.get("start") || "").trim();
  const endParam = String(params.get("end") || "").trim();
  const radiusMiles = String(params.get("radiusMiles") || "120").trim() || "120";
  const countryCode = String(params.get("countryCode") || "US,CA").trim() || "US,CA";

  const homeBase = String(params.get("homeBase") || params.get("homeIata") || params.get("originIata") || "")
    .trim()
    .toUpperCase();

  // ✅ Don’t mutate / re-encode favorites — just read them
  const favoriteIds = useMemo(
    () => params.getAll("favorites").map((x) => String(x || "").trim()).filter(Boolean),
    [params]
  );

  const [loadingTrips, setLoadingTrips] = useState(true);
  const [errTrips, setErrTrips] = useState<string>("");
  const [warning, setWarning] = useState<string>("");

  const [trips, setTrips] = useState<ApiTrip[]>([]);
  const [buckets, setBuckets] = useState<TripBucket[]>([]);
  const [apiDateRange, setApiDateRange] = useState<{ start?: string; end?: string; tripDays?: number } | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [eventsByTrip, setEventsByTrip] = useState<Record<string, ApiEvent[]>>({});
  const [eventsErrByTrip, setEventsErrByTrip] = useState<Record<string, string>>({});
  const [eventsLoadingByTrip, setEventsLoadingByTrip] = useState<Record<string, boolean>>({});

  const [selectedByTrip, setSelectedByTrip] = useState<Record<string, Record<string, boolean>>>({});

  const tripsAbortRef = useRef<AbortController | null>(null);

  const { saving, error: saveError, run: runSave } = useSaveTrip();

  const headerStart = apiDateRange?.start || startParam;
  const headerEnd = apiDateRange?.end || endParam;

  // Sort trips by start date (and keep stable-ish by score as tiebreak)
  const sortedTrips = useMemo(() => {
    return [...trips].sort((a, b) => {
      const c = String(a.windowStart || "").localeCompare(String(b.windowStart || ""));
      if (c !== 0) return c;
      return (b.score || 0) - (a.score || 0);
    });
  }, [trips]);

  const sortedBuckets = useMemo(() => {
    return (buckets || []).map((b) => ({
      ...b,
      trips: [...(b.trips || [])].sort((a, c) => {
        const d = String(a.windowStart || "").localeCompare(String(c.windowStart || ""));
        if (d !== 0) return d;
        return (c.score || 0) - (a.score || 0);
      }),
    }));
  }, [buckets]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setErrTrips("");
      setWarning("");
      setBuckets([]);
      setTrips([]);
      setApiDateRange(null);

      // A and C require dates
      if (mode === "A" || mode === "C") {
        if (!isYMD(startParam) || !isYMD(endParam)) {
          setErrTrips("Missing/invalid start/end date.");
          setLoadingTrips(false);
          return;
        }
      }

      tripsAbortRef.current?.abort();
      const ac = new AbortController();
      tripsAbortRef.current = ac;

      setLoadingTrips(true);
      try {
        const res = await fetch(`/api/trips?${apiTripsQs}`, {
          method: "GET",
          cache: "no-store",
          signal: ac.signal,
        });

        const json = (await res.json().catch(() => ({}))) as TripsResp;
        if (cancelled || ac.signal.aborted) return;

        if (!res.ok || json?.error) {
          setErrTrips(String(json?.error || `Request failed (${res.status})`));
          setTrips([]);
          setBuckets([]);
        } else {
          const b = Array.isArray(json?.buckets) ? json.buckets : [];
          const t = Array.isArray(json?.trips) ? json.trips : [];

          if (b.length) {
            setBuckets(b);
            setTrips(flattenBuckets(b));
          } else {
            setBuckets([]);
            setTrips(t);
          }

          setWarning(String(json?.warning || ""));
          setApiDateRange(json?.dateRange || null);
        }
      } catch (e: any) {
        if (cancelled) return;
        if (String(e?.name || "") === "AbortError") return;
        setErrTrips(String(e?.message || e));
        setTrips([]);
        setBuckets([]);
      } finally {
        if (!cancelled) setLoadingTrips(false);
      }
    })();

    return () => {
      cancelled = true;
      tripsAbortRef.current?.abort();
      tripsAbortRef.current = null;
    };
  }, [apiTripsQs, mode, startParam, endParam]);

  async function loadEventsForTrip(t: ApiTrip) {
    if (eventsByTrip[t.id]?.length) return;

    setEventsLoadingByTrip((p) => ({ ...p, [t.id]: true }));
    setEventsErrByTrip((p) => ({ ...p, [t.id]: "" }));

    try {
      const qs = new URLSearchParams();
      qs.set("lat", String(t.dest.lat));
      qs.set("lon", String(t.dest.lon));
      qs.set("start", t.windowStart);
      qs.set("end", t.windowEnd);
      qs.set("radiusMiles", String(t.radiusMiles || radiusMiles));
      qs.set("countryCode", countryCode);

      for (const f of favoriteIds) qs.append("favorites", f);
      for (const g of params.getAll("musicGenres")) qs.append("musicGenres", g);
      for (const g of params.getAll("sportsGenres")) qs.append("sportsGenres", g);
      for (const g of params.getAll("artsGenres")) qs.append("artsGenres", g);

      const res = await fetch(`/api/events?${qs.toString()}`, { method: "GET", cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as EventsResp;

      if (!res.ok || json?.error) throw new Error(String(json?.error || `Events request failed (${res.status})`));

      const evs = Array.isArray(json?.events) ? json.events : [];
      setEventsByTrip((p) => ({ ...p, [t.id]: evs }));
    } catch (e: any) {
      setEventsErrByTrip((p) => ({ ...p, [t.id]: String(e?.message || e) }));
      setEventsByTrip((p) => ({ ...p, [t.id]: [] }));
    } finally {
      setEventsLoadingByTrip((p) => ({ ...p, [t.id]: false }));
    }
  }

  function toggleExpanded(t: ApiTrip) {
    const next = expandedId === t.id ? null : t.id;
    setExpandedId(next);
    if (next === t.id) loadEventsForTrip(t);
  }

  function toggleSelect(tripId: string, eventId: string) {
    setSelectedByTrip((prev) => {
      const cur = prev[tripId] || {};
      return { ...prev, [tripId]: { ...cur, [eventId]: !cur[eventId] } };
    });
  }

  function clearSelected(tripId: string) {
    setSelectedByTrip((prev) => ({ ...prev, [tripId]: {} }));
  }

  function selectedCount(tripId: string) {
    const map = selectedByTrip[tripId] || {};
    return Object.values(map).filter(Boolean).length;
  }

  async function saveTripFromCard(t: ApiTrip) {
    if (!homeBase || homeBase.length !== 3) {
      alert("Missing Home airport (homeBase). Go back and set your home airport.");
      return;
    }

    const sel = selectedByTrip[t.id] || {};
    const evs = eventsByTrip[t.id] || [];
    const chosen = evs.filter((e) => !!sel[e.id]);
    if (!chosen.length) return;

    const tripEvents: TripEvent[] = chosen.map((ev) => ({
      id: ev.id,
      source: "ticketmaster",
      tmEventId: ev.id,
      name: ev.name,
      url: ev.url,
      localDate: ev.localDate,
      localTime: ev.localTime,
      city: ev.city,
      region: ev.region,
      country: null,
      venueName: ev.venueName,
      lat: null,
      lon: null,
      matchedGenres: Array.isArray(ev.matchedFavorites) ? ev.matchedFavorites : [],
      pillGenre: ev.pillLabel || "",
    }));

    const draft: TripDraft = {
      homeBase,
      startDate: t.windowStart,
      endDate: t.windowEnd,
      events: tripEvents,
    };

    const out = await runSave(draft);
    if (out.ok) router.push(`/trips/${out.tripId}`);
  }

  function TripCard({ t }: { t: ApiTrip }) {
    const expanded = expandedId === t.id;
    const evs = eventsByTrip[t.id] || [];
    const evErr = eventsErrByTrip[t.id] || "";
    const evLoading = !!eventsLoadingByTrip[t.id];
    const selCount = selectedCount(t.id);

    const majorLabel = useMemo(() => pickMajorCityLabel(t), [t]);
    const highlight = useMemo(() => hasBothF1F2(t), [t]);

    const grouped = useMemo(() => {
      const map = new Map<string, ApiEvent[]>();

      for (const ev of evs) {
        const key = ev.localDate || "TBD";
        const arr = map.get(key) || [];
        arr.push(ev);
        map.set(key, arr);
      }

      // Sort each day's events by time (if present)
      for (const [k, arr] of map.entries()) {
        arr.sort((a, b) => (a.localTime || "").localeCompare(b.localTime || ""));
        map.set(k, arr);
      }

      // Sort keys: real dates first, then TBD at end
      const keys = Array.from(map.keys()).sort((a, b) => {
        if (a === "TBD") return 1;
        if (b === "TBD") return -1;
        return a.localeCompare(b); // YYYY-MM-DD sorts lexicographically
      });

      return keys.map((k) => ({
        key: k,
        title: k === "TBD" ? "TBD" : `${weekdayLabelFromYMD(k)} • ${formatMonthDayFromYMD(k)}`,
        events: map.get(k) || [],
      }));
    }, [evs]);

    return (
      <div
        key={t.id}
        className={[
          "rounded-2xl border p-4 transition",
          highlight ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black text-slate-900">{majorLabel}</div>
            <div className="text-xs text-slate-600">
              {t.windowStart} → {t.windowEnd}
              {t.score ? (
                <>
                  {" "}
                  • Score: <span className="font-black">{t.score}</span>
                </>
              ) : null}
            </div>

            {t.reasons?.length ? (
              <div className="mt-1 text-[11px] text-slate-500">
                {t.reasons.slice(0, 2).map((r, i) => (
                  <div key={i}>• {r}</div>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => toggleExpanded(t)}
            className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-800"
          >
            {expanded ? "Hide events" : "Show events"}
          </button>
        </div>

        {/* ✅ Pills with counts on the summary card (F1/F2/G1/G2/etc) */}
        {Object.keys(t.breakdown || {}).length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(t.breakdown || {})
              .filter(([, v]) => Number(v || 0) > 0)
              .map(([k, v]) => (
                <span
                  key={k}
                  className="rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-[11px] font-black text-slate-800"
                >
                  {k}: {v}
                </span>
              ))}
          </div>
        ) : null}

        {/* Optional: subtle callout for F1+F2 */}
        {highlight ? (
          <div className="mt-2 text-[11px] font-black text-indigo-700">⭐ Includes F1 + F2</div>
        ) : null}

        {expanded ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            {evLoading ? (
              <div className="flex items-center gap-3 text-slate-600">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                <div className="text-sm">Loading events…</div>
              </div>
            ) : evErr ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{evErr}</div>
            ) : evs.length === 0 ? (
              <div className="text-sm text-slate-600">No events found for this window.</div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-700">
                    Selected: <span className="font-black">{selCount}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => clearSelected(t.id)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      disabled={saving || selCount === 0}
                      onClick={() => saveTripFromCard(t)}
                      className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Create shareable trip"}
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {grouped.map((g) => (
                    <div key={g.key} className="space-y-2">
                      <div className="px-1 text-xs font-black text-slate-700">{g.title}</div>

                      {g.events.map((e) => {
                        const checked = !!selectedByTrip[t.id]?.[e.id];
                        return (
                          <label
                            key={e.id}
                            className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4"
                              checked={checked}
                              onChange={() => toggleSelect(t.id, e.id)}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-black text-slate-900">
                                {e.url ? (
                                  <a href={e.url} target="_blank" rel="noreferrer" className="hover:underline">
                                    {e.name}
                                  </a>
                                ) : (
                                  e.name
                                )}
                              </div>
                              <div className="text-xs text-slate-600">
                                {(e.localDate || "TBD") + (e.localTime ? ` • ${e.localTime}` : "")} •{" "}
                                {e.venueName || "Venue"} • {e.city}, {e.region}
                              </div>
                              {e.pillLabel ? (
                                <div className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-black text-slate-700">
                                  {e.pillLabel}
                                </div>
                              ) : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-5 lg:max-w-3xl">
          <div className="flex items-center gap-3">
            <BrandLogo />
            <div className="min-w-0">
              <div className="text-lg font-black tracking-tight text-slate-900 sm:text-xl">
                {mode === "A" ? "Your trip" : "Best trips"}
              </div>
              <div className="text-xs text-slate-600 sm:text-sm">
                {headerStart && headerEnd ? (
                  <>
                    {headerStart} → {headerEnd}
                  </>
                ) : (
                  <>Upcoming</>
                )}{" "}
                • Radius: {radiusMiles} mi • {countryCode}
              </div>
              {favoriteIds.length ? (
                <div className="mt-1 text-[11px] text-slate-500">Favorites: {favoriteIds.slice(0, 4).join(" • ")}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-3xl lg:py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          {loadingTrips ? (
            <div className="flex items-center gap-3 text-slate-600">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              <div className="text-sm">Building your trips…</div>
            </div>
          ) : errTrips ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{errTrips}</div>
          ) : buckets.length === 0 && trips.length === 0 ? (
            <div className="text-sm text-slate-600">No trip candidates found.</div>
          ) : (
            <div className="space-y-3">
              {warning ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  {warning}
                </div>
              ) : null}

              {saveError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  {saveError}
                </div>
              ) : null}

              {sortedBuckets.length ? (
                <div className="space-y-4">
                  {sortedBuckets.map((b) => (
                    <div key={b.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-black text-slate-900">{b.label}</div>
                        <div className="text-xs text-slate-600">
                          Min coverage: <span className="font-black">{b.minCoverage}</span>
                        </div>
                      </div>
                      <div className="space-y-3">{(b.trips || []).map((t) => <TripCard key={t.id} t={t} />)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">{sortedTrips.map((t) => <TripCard key={t.id} t={t} />)}</div>
              )}
            </div>
          )}

          <div className="mt-6">
            <button
              type="button"
              onClick={() => router.push(`/`)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}