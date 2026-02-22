// FILE: app/trips/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "../components/BrandLogo";

type Trip = {
  id: string;
  dest: { iata: string; label: string; lat: number; lon: number };
  windowStart: string;
  windowEnd: string;
  tripDays: number;
  radiusMiles: number;
  score: number;
  breakdown: Record<string, number>;
  uniqueDays: number;
  totalMatched: number;
  seedAnchorCount: number;
  anchorEvent: { date: string; name: string; genre: string | null; url: string } | null;
  sampleEvents: Array<{
    date: string;
    name: string;
    location: string;
    genre: string | null;
    url: string;
  }>;
  reasons: string[];
  openUrl: string;
};

type ApiResp = {
  ok?: boolean;
  error?: string;
  count?: number;
  trips?: Trip[];
  debug?: any;
};

function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function uniqLower(arr: string[], max = 4) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    const g = String(raw || "").trim();
    if (!g) continue;
    const k = g.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
    if (out.length >= max) break;
  }
  return out;
}

function parseYMDToUtcMs(ymd: string) {
  if (!isYMD(ymd)) return null;
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const ms = Date.UTC(y, m - 1, d);
  return Number.isFinite(ms) ? ms : null;
}

function inclusiveDaySpan(startYMD: string, endYMD: string) {
  const a = parseYMDToUtcMs(startYMD);
  const b = parseYMDToUtcMs(endYMD);
  if (a == null || b == null) return null;
  const diffDays = Math.floor((b - a) / 86400000);
  return diffDays >= 0 ? diffDays + 1 : null;
}

export default function TripsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const spStr = sp.toString();

  const params = useMemo(() => new URLSearchParams(spStr), [spStr]);

  const start = String(params.get("start") || "").trim();
  const end = String(params.get("end") || "").trim();
  const tripDays = String(params.get("tripDays") || "4").trim();
  const radiusMiles = String(params.get("radiusMiles") || "120").trim();
  const countryCode = String(params.get("countryCode") || "US,CA").trim() || "US,CA";

  // Accept genres from ANY supported input shape (UI might pass different ones over time)
  const genreOrderRaw = String(params.get("genreOrder") || "").trim();
  const musicGenres = params.getAll("musicGenres").map((x) => String(x || "").trim());
  const sportsGenres = params.getAll("sportsGenres").map((x) => String(x || "").trim());
  const genresCsv = String(params.get("genres") || "").trim();

  const effectiveGenres = useMemo(() => {
    if (genreOrderRaw) return uniqLower(genreOrderRaw.split(","));
    const combined = uniqLower([...musicGenres, ...sportsGenres]);
    if (combined.length) return combined;
    if (genresCsv) return uniqLower(genresCsv.split(","));
    return [];
  }, [genreOrderRaw, musicGenres.join("|"), sportsGenres.join("|"), genresCsv]);

  const effectiveGenreOrder = effectiveGenres.join(",");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [trips, setTrips] = useState<Trip[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  const fetchUrl = useMemo(() => {
    const qs = new URLSearchParams(spStr);

    // Keep TripStyle B consistent
    qs.set("mode", "B");
    qs.set("tripStyle", "B");

    // Ensure API has a genreOrder (preferred input)
    if (!qs.get("genreOrder") && effectiveGenreOrder) qs.set("genreOrder", effectiveGenreOrder);

    // Hard requirements
    qs.set("start", start);
    qs.set("end", end);
    qs.set("tripDays", tripDays);
    qs.set("radiusMiles", radiusMiles);
    qs.set("countryCode", countryCode);

    return `/api/trips?${qs.toString()}`;
  }, [spStr, start, end, tripDays, radiusMiles, countryCode, effectiveGenreOrder]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setErr("");

      if (!isYMD(start) || !isYMD(end)) {
        setErr("Missing/invalid start/end date.");
        setTrips([]);
        setLoading(false);
        return;
      }

      if (effectiveGenres.length < 1) {
        setErr("TripStyle B requires Genre #1 (at least one genre).");
        setTrips([]);
        setLoading(false);
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
          setTrips([]);
        } else {
          setTrips(Array.isArray(json?.trips) ? (json.trips as Trip[]) : []);
        }
      } catch (e: any) {
        if (cancelled) return;
        if (String(e?.name || "") === "AbortError") return;
        setErr(String(e?.message || e));
        setTrips([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [fetchUrl, start, end, effectiveGenreOrder, effectiveGenres.length]);

  const genre1 = effectiveGenres[0] || "";

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-5 lg:max-w-3xl">
          <div className="flex items-center gap-3">
            <BrandLogo />
            <div className="min-w-0">
              <div className="text-lg font-black tracking-tight text-slate-900 sm:text-xl">
                Best {tripDays}-day trips
              </div>
              <div className="text-xs text-slate-600 sm:text-sm">
                {start} → {end} • Genres: {effectiveGenreOrder || "—"} • Radius: {radiusMiles} mi • {countryCode}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-3xl lg:py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          {loading ? (
            <div className="flex items-center gap-3 text-slate-600">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              <div className="text-sm">
                Building your trips… <span className="text-slate-500">(this can take up to ~1 minute)</span>
              </div>
            </div>
          ) : err ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{err}</div>
          ) : trips.length === 0 ? (
            <div className="text-sm text-slate-600">No trip candidates found.</div>
          ) : (
            <div className="space-y-3">
              {trips.map((t) => {
                const span = inclusiveDaySpan(t.windowStart, t.windowEnd);
                const spanDays = span ?? (Number.isFinite(t.tripDays) ? t.tripDays : Number(tripDays) || 0);

                // Remove the server-provided "Matched events: ..." line since it can be confusing
                const extraReasons =
                  (t.reasons || []).filter((r) => !String(r || "").toLowerCase().startsWith("matched events:")) || [];

const radiusValue =
  t.radiusMiles != null
    ? t.radiusMiles
    : Number.isFinite(Number(radiusMiles))
      ? Number(radiusMiles)
      : 0;

const bullets = [
  genre1 ? `Includes Genre #1 anchor: ${genre1}` : null,
  `Matched events: ${t.totalMatched ?? 0} across ${spanDays} day(s)`,
  `Within ${radiusValue} miles of ${t.dest.label}`,
].filter(Boolean) as string[];

                return (
                  <div key={t.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-black text-slate-900">
                          {t.dest.label} ({t.dest.iata})
                        </div>
                        <div className="text-xs text-slate-600">
                          {t.windowStart} → {t.windowEnd} • Score: <span className="font-black">{t.score}</span>
                        </div>
                        {t.anchorEvent ? (
                          <div className="mt-1 text-xs text-slate-600">
                            Anchor:{" "}
                            <a className="font-bold hover:underline" target="_blank" rel="noreferrer" href={t.anchorEvent.url}>
                              {t.anchorEvent.name}
                            </a>{" "}
                            ({t.anchorEvent.date})
                          </div>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => router.push(t.openUrl)}
                        className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-800"
                      >
                        View events
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(t.breakdown || {}).map(([g, c]) => (
                        <span
                          key={g}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black text-slate-800"
                        >
                          {g}: {c}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 text-xs text-slate-600">
                      {bullets.map((r, i) => (
                        <div key={i}>• {r}</div>
                      ))}
                      {extraReasons
                        .filter((r) => !String(r || "").toLowerCase().startsWith("includes genre #1 anchor:"))
                        .filter((r) => !String(r || "").toLowerCase().startsWith("within "))
                        .slice(0, 2)
                        .map((r, i) => (
                          <div key={`x_${i}`}>• {r}</div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-6">
            <button
              type="button"
              onClick={() => router.push(`/?${spStr}`)}
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