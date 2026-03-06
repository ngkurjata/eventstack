"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "../components/BrandLogo";
import { useSaveTrip } from "@/lib/trips/useSaveTrip";
import type { TripDraft, TripEvent } from "@/lib/trips/saveTrip";

/* -------------------- Types -------------------- */

type ApiEvent = {
  id: string;
  name: string;
  localDate: string | null;
  localTime: string | null;
  city: string;
  region: string;
  venueName: string;
  url: string | null;

  matchedFavorites: string[]; // ids
  pillLabel: string; // readable label for UI
};

type ApiResp = {
  count?: number;
  events?: ApiEvent[];
  error?: string;
  debug?: any;
};

type Airport = {
  iata: string;
  name: string;
  city: string;
  region: string;
  country: string;
  lat: number | null;
  lon: number | null;
};

const LS_SELECTED = "eventstack_selected_events_v1";

/* -------------------- Utils -------------------- */

function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function fmtRange(start: string, end: string) {
  return `${start} → ${end}`;
}

function pillText(g: string) {
  return String(g || "").trim().toUpperCase();
}

function parseNum(s: string | null) {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* -------------------- Page -------------------- */

export default function EventsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const spStr = sp.toString();
  const params = useMemo(() => new URLSearchParams(spStr), [spStr]);

  const tripStyle = String(params.get("tripStyle") || "A").trim().toUpperCase();
  const destCityLabel = String(params.get("destCityLabel") || "").trim();

  const qLat = parseNum(params.get("lat"));
  const qLon = parseNum(params.get("lon"));
  const destIata = String(params.get("destIata") || "").trim().toUpperCase();

  // NOTE: home base can be named a few different ways depending on your earlier pages.
  // Prefer explicit "homeBase", then fall back to "homeIata" or "originIata".
  const homeBase = String(
    params.get("homeBase") || params.get("homeIata") || params.get("originIata") || ""
  )
    .trim()
    .toUpperCase();

  const start = String(params.get("start") || "").trim();
  const end = String(params.get("end") || "").trim();

  const radiusMiles = String(params.get("radiusMiles") || "120").trim() || "120";
  const countryCode = String(params.get("countryCode") || "US,CA").trim() || "US,CA";

  const favorites = useMemo(
    () => params.getAll("favorites").map((s) => String(s).trim()).filter(Boolean),
    [params]
  );

  // Airports fallback
  const [airports, setAirports] = useState<Airport[]>([]);
  const [airportsError, setAirportsError] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [events, setEvents] = useState<ApiEvent[]>([]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  const abortRef = useRef<AbortController | null>(null);

  // Save pipeline
  const { saving, error: saveError, run: runSave } = useSaveTrip();

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }
  function clearSelected() {
    setSelected({});
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_SELECTED);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") setSelected(parsed);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SELECTED, JSON.stringify(selected));
    } catch {}
  }, [selected]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!destIata || destIata.length !== 3) {
        setAirports([]);
        setAirportsError("");
        return;
      }

      setAirportsError("");
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
            country: String(a?.country || "").trim(),
            lat: a?.lat == null ? null : Number(a.lat),
            lon: a?.lon == null ? null : Number(a.lon),
          }))
          .filter((a: Airport) => a.iata.length === 3);

        setAirports(cleaned);
      } catch (e: any) {
        if (cancelled) return;
        setAirports([]);
        setAirportsError(String(e?.message || e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [destIata]);

  const airport = useMemo(() => {
    if (!destIata || airports.length === 0) return null;
    return airports.find((a) => a.iata === destIata) || null;
  }, [destIata, airports]);

  const headerCity = useMemo(() => {
    if (destCityLabel) return destCityLabel;

    if (!airport) return destIata || "Events";
    const regionShort = airport.region && airport.region.includes("-") ? airport.region.split("-")[1] : airport.region;
    const city = airport.city || destIata;
    const r = regionShort || airport.country || "";
    return r ? `${city}, ${r}` : city;
  }, [destCityLabel, airport, destIata]);

  const effectiveLat = useMemo(() => {
    if (qLat != null && qLon != null) return qLat;
    if (airport?.lat != null && airport?.lon != null) return airport.lat;
    return null;
  }, [qLat, qLon, airport]);

  const effectiveLon = useMemo(() => {
    if (qLat != null && qLon != null) return qLon;
    if (airport?.lat != null && airport?.lon != null) return airport.lon;
    return null;
  }, [qLat, qLon, airport]);

  const fetchUrl = useMemo(() => {
    if (effectiveLat == null || effectiveLon == null) return "";

    const qs = new URLSearchParams(spStr);
    qs.set("lat", String(effectiveLat));
    qs.set("lon", String(effectiveLon));
    qs.set("start", start);
    qs.set("end", end);
    if (!qs.get("radiusMiles")) qs.set("radiusMiles", String(radiusMiles || "120"));
    if (!qs.get("countryCode")) qs.set("countryCode", String(countryCode || "US,CA"));

    // Ensure favorites are present (some callers may not include them in spStr rebuilds)
    qs.delete("favorites");
    for (const f of favorites) qs.append("favorites", f);

    return `/api/events?${qs.toString()}`;
  }, [spStr, effectiveLat, effectiveLon, start, end, radiusMiles, countryCode, favorites.join("|")]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setErr("");

      if (tripStyle !== "A" && tripStyle !== "B") {
        setErr("This page is intended for TripStyle A or B.");
        setLoading(false);
        setEvents([]);
        return;
      }

      if (!isYMD(start) || !isYMD(end)) {
        setErr("Missing/invalid start/end date.");
        setLoading(false);
        setEvents([]);
        return;
      }

      if ((favorites || []).length < 1) {
        setErr("Pick at least 1 favorite.");
        setLoading(false);
        setEvents([]);
        return;
      }

      if (effectiveLat == null || effectiveLon == null) {
        if (destIata && destIata.length === 3) {
          setLoading(true);
          return;
        }
        setErr("Missing destination coordinates (lat/lon).");
        setLoading(false);
        setEvents([]);
        return;
      }

      if (!fetchUrl) {
        setErr("Failed to build events request.");
        setLoading(false);
        setEvents([]);
        return;
      }

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const ac = abortRef.current;

      setLoading(true);

      try {
        const res = await fetch(fetchUrl, { cache: "no-store", signal: ac.signal });
        const json = (await res.json().catch(() => ({}))) as ApiResp;

        if (cancelled || ac.signal.aborted) return;

        if (!res.ok || json?.error) {
          setErr(String(json?.error || `Request failed (${res.status})`));
          setEvents([]);
        } else {
          setEvents(Array.isArray(json?.events) ? (json.events as ApiEvent[]) : []);
        }
      } catch (e: any) {
        if (cancelled) return;
        if (String(e?.name || "") === "AbortError") return;
        setErr(String(e?.message || e));
        setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [tripStyle, start, end, effectiveLat, effectiveLon, fetchUrl, destIata, favorites.join("|")]);

  const selectedEventsForSave = useMemo(() => {
    if (!events?.length) return [] as ApiEvent[];
    return events.filter((ev) => !!selected[ev.id]);
  }, [events, selected]);

  const canSaveTrip = useMemo(() => {
    if (!homeBase || homeBase.length !== 3) return false;
    if (!isYMD(start) || !isYMD(end)) return false;
    if (selectedEventsForSave.length === 0) return false;
    return true;
  }, [homeBase, start, end, selectedEventsForSave.length]);

  async function onSaveTrip() {
    if (!canSaveTrip) return;

    const tripEvents: TripEvent[] = selectedEventsForSave.map((ev) => ({
      id: ev.id,
      source: "ticketmaster",
      tmEventId: ev.id, // if your API has a distinct TM id, swap it in here
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
      startDate: start,
      endDate: end,
      events: tripEvents,
    };

    const out = await runSave(draft);
    if (out.ok) {
      router.push(`/trips/${out.tripId}`);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-5 lg:max-w-3xl">
          <div className="flex items-center gap-3">
            <BrandLogo />
            <div className="min-w-0">
              <div className="text-lg font-black tracking-tight text-slate-900 sm:text-xl">{headerCity}</div>
              <div className="text-xs text-slate-600 sm:text-sm">
                {fmtRange(start, end)} • Favorites: {favorites.length ? favorites.length : "—"}
                {homeBase ? ` • Home: ${homeBase}` : ""}
              </div>
              {airportsError ? (
                <div className="mt-2 text-xs text-rose-700">Airports file error: {airportsError}</div>
              ) : null}
              {!homeBase ? (
                <div className="mt-2 text-xs text-amber-700">
                  Missing home airport in URL (expected homeBase/homeIata/originIata). Save Trip will be disabled.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-3xl lg:py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-black tracking-tight text-slate-900">Events in chronological order</div>
              <div className="mt-1 text-xs text-slate-500">Check events to add them to your trip build.</div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-xs font-bold text-slate-600">Selected</div>
              <div className="text-2xl font-black text-slate-900">{selectedCount}</div>
              <button
                type="button"
                onClick={clearSelected}
                className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Clear
              </button>
            </div>
          </div>

          {loading ? (
            <div className="mt-6 flex items-center gap-3 text-slate-600">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              <div className="text-sm">Loading events…</div>
            </div>
          ) : err ? (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{err}</div>
          ) : events.length === 0 ? (
            <div className="mt-6 text-sm text-slate-600">No matching events found.</div>
          ) : (
            <div className="mt-6 space-y-2">
              {events.map((ev) => {
                const checked = !!selected[ev.id];
                const dateLine = `${ev.localDate || "TBA"}${
                  ev.city ? ` — ${ev.city}${ev.region ? `, ${ev.region}` : ""}` : ""
                }`;
                const pill = (ev.pillLabel || "").trim();

                return (
                  <label
                    key={ev.id}
                    className={[
                      "flex items-center justify-between gap-3 rounded-2xl border px-3 py-3",
                      checked ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white",
                    ].join(" ")}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(ev.id)}
                        className="mt-1 h-5 w-5"
                      />

                      <div className="min-w-0">
                        <div className="text-xs text-slate-500">{dateLine}</div>
                        <div className="truncate text-sm font-extrabold text-slate-900">
                          {ev.url ? (
                            <a href={ev.url} target="_blank" rel="noreferrer" className="hover:underline">
                              {ev.name}
                            </a>
                          ) : (
                            ev.name
                          )}
                        </div>
                        {ev.venueName ? <div className="truncate text-xs text-slate-500">{ev.venueName}</div> : null}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {pill ? (
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-black text-slate-900">
                          {pillText(pill)}
                        </span>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {(saveError || !canSaveTrip) && selectedCount > 0 ? (
            <div className="mt-4">
              {saveError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{saveError}</div>
              ) : !homeBase ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Can’t save yet: missing home airport (homeBase/homeIata/originIata) in the URL params.
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => router.push(`/?`)}
              className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>

            <button
              type="button"
              disabled={!canSaveTrip || saving}
              onClick={onSaveTrip}
              className={[
                "flex-1 rounded-2xl px-4 py-3 text-sm font-black",
                !canSaveTrip || saving
                  ? "cursor-not-allowed bg-slate-100 text-slate-400"
                  : "bg-emerald-700 text-white hover:bg-emerald-600",
              ].join(" ")}
              title={!homeBase ? "Missing homeBase/homeIata/originIata in URL" : undefined}
            >
              {saving ? "Saving…" : `Save Trip (${selectedCount})`}
            </button>

            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => {
                if (selectedCount === 0) return;
                router.push(`/build-trip?${spStr}`);
              }}
              className={[
                "flex-1 rounded-2xl px-4 py-3 text-sm font-black",
                selectedCount === 0 ? "cursor-not-allowed bg-slate-100 text-slate-400" : "bg-slate-900 text-white hover:bg-slate-800",
              ].join(" ")}
            >
              Build Trip ({selectedCount})
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}