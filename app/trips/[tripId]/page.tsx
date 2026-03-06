// FILE: app/trips/[tripId]/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import BrandLogo from "@/app/components/BrandLogo";
import type { TripDoc, SelectedEvent } from "@/lib/trips/types";

/** Local preference key for departure airport */
const LS_DEPART_IATA = "eventstack_departure_iata_v1";

/** ---------- helpers ---------- */

function ymdToDate(ymd: string) {
  const [y, m, d] = String(ymd).split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function formatYmd(ymd: string) {
  const dt = ymdToDate(ymd);
  if (!dt) return ymd;
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTimeHHMM(localTime: string | null | undefined) {
  if (!localTime) return "";
  const s = String(localTime).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : "";
}

function safeTitleCityBits(ev: SelectedEvent) {
  const parts = [ev.city, ev.region].filter(Boolean);
  return parts.join(", ");
}

function groupEventsByDay(events: SelectedEvent[]) {
  const map = new Map<string, SelectedEvent[]>();
  for (const ev of events || []) {
    const key = ev.localDate || "TBD";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ev);
  }

  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === "TBD" && b === "TBD") return 0;
    if (a === "TBD") return 1;
    if (b === "TBD") return -1;
    return a.localeCompare(b);
  });

  return keys.map((k) => {
    const list = (map.get(k) || []).slice().sort((a, b) => {
      const ta = formatTimeHHMM(a.localTime);
      const tb = formatTimeHHMM(b.localTime);
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return ta.localeCompare(tb);
    });
    return { day: k, events: list };
  });
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** ---------- component ---------- */

type ApiGetResp =
  | { ok: true; trip: TripDoc }
  | { ok: false; error: string; debug?: any };

export default function TripPage() {
  const router = useRouter();
  const params = useParams();

  // Robustly read params.tripId (string | string[] | undefined)
  const tripId =
    typeof params?.tripId === "string"
      ? params.tripId
      : Array.isArray(params?.tripId)
      ? params.tripId[0]
      : "";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [trip, setTrip] = useState<TripDoc | null>(null);

  const [departIata, setDepartIata] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // load local preference
  useEffect(() => {
    try {
      const v = String(localStorage.getItem(LS_DEPART_IATA) || "")
        .trim()
        .toUpperCase();
      if (v) setDepartIata(v);
    } catch {}
  }, []);

  // fetch trip
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!tripId) {
        setTrip(null);
        setErr("Missing tripId.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr(null);

      try {
        const res = await fetch(
          `/api/trips/get?tripId=${encodeURIComponent(tripId)}`,
          { method: "GET", cache: "no-store" }
        );

        const j = (await res.json().catch(() => null)) as ApiGetResp | null;

        if (cancelled) return;

        if (!res.ok || !j || (j as any).ok === false) {
          setTrip(null);
          const msg =
            j && typeof (j as any).error === "string"
              ? (j as any).error
              : `Failed to load trip (${res.status}).`;
          setErr(msg);
          setLoading(false);
          return;
        }

        setTrip((j as any).trip as TripDoc);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setTrip(null);
        setErr(e?.message || "Network error loading trip.");
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const grouped = useMemo(() => groupEventsByDay(trip?.events || []), [trip?.events]);

  const title = useMemo(() => {
    const hb = trip?.homeBase || "HomeBase";
    const start = trip?.startDate ? formatYmd(trip.startDate) : "Start";
    const end = trip?.endDate ? formatYmd(trip.endDate) : "End";
    return `${hb} • ${start} → ${end}`;
  }, [trip?.homeBase, trip?.startDate, trip?.endDate]);

  function onDepartChange(v: string) {
    const next = String(v || "").trim().toUpperCase();
    setDepartIata(next);
    try {
      if (next) localStorage.setItem(LS_DEPART_IATA, next);
      else localStorage.removeItem(LS_DEPART_IATA);
    } catch {}
  }

  async function onCopyLink() {
    const url = window.location.href;
    const ok = await copyToClipboard(url);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <button
            className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800"
            onClick={() => router.push("/")}
            title="Back"
          >
            ← Back
          </button>
          <BrandLogo />
          <div className="w-[68px]" />
        </div>

        <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs text-neutral-400">Trip</div>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
              <div className="mt-1 text-sm text-neutral-400">
                Trip ID: <span className="font-mono text-neutral-300">{tripId || "—"}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:items-end">
              <button
                className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
                onClick={onCopyLink}
                disabled={!tripId}
                title={!tripId ? "TripId missing" : "Copy link"}
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
              <div className="text-xs text-neutral-400">Share this URL to load this trip.</div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-xs text-neutral-400">Departure airport (local preference)</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={departIata}
                  onChange={(e) => onDepartChange(e.target.value)}
                  placeholder="e.g. YVR"
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-sm text-neutral-100 outline-none focus:border-neutral-600"
                />
                <button
                  className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800"
                  onClick={() => onDepartChange("")}
                  title="Clear"
                >
                  Clear
                </button>
              </div>
              <div className="mt-2 text-xs text-neutral-500">
                Stored in this browser only. (Trip link stays shareable.)
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="text-xs text-neutral-400">Summary</div>
              <div className="mt-2 text-sm">
                <div>
                  Events: <span className="font-semibold">{trip?.events?.length ?? 0}</span>
                </div>
                <div className="mt-1">
                  Days:{" "}
                  <span className="font-semibold">
                    {trip?.startDate && trip?.endDate
                      ? `${formatYmd(trip.startDate)} → ${formatYmd(trip.endDate)}`
                      : "—"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  (No BCD logic here yet — just renders saved TripDoc.)
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="text-sm font-semibold text-neutral-200">Events (grouped by day)</h2>

          {loading ? (
            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-sm text-neutral-300">
              Loading trip…
            </div>
          ) : err ? (
            <div className="mt-3 rounded-2xl border border-red-900/50 bg-red-950/30 p-5 text-sm text-red-200">
              {err}
            </div>
          ) : !trip ? (
            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-sm text-neutral-300">
              Trip not found.
            </div>
          ) : (trip.events?.length ?? 0) === 0 ? (
            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-sm text-neutral-300">
              No events saved in this trip.
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              {grouped.map(({ day, events }) => (
                <section key={day} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      {day === "TBD" ? "Date TBD" : formatYmd(day)}
                    </div>
                    <div className="text-xs text-neutral-400">
                      {events.length} event{events.length === 1 ? "" : "s"}
                    </div>
                  </div>

                  <div className="mt-3 divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
                    {events.map((ev) => (
                      <div key={ev.id} className="p-4">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-neutral-100">{ev.name}</div>
                            <div className="mt-1 text-xs text-neutral-400">
                              {formatTimeHHMM(ev.localTime) ? (
                                <span className="font-mono">{formatTimeHHMM(ev.localTime)}</span>
                              ) : (
                                <span className="font-mono text-neutral-500">--:--</span>
                              )}
                              <span className="mx-2 text-neutral-700">•</span>
                              <span>{safeTitleCityBits(ev)}</span>
                              {ev.venueName ? (
                                <>
                                  <span className="mx-2 text-neutral-700">•</span>
                                  <span className="text-neutral-300">{ev.venueName}</span>
                                </>
                              ) : null}
                            </div>

                            {(ev.pillGenre || (ev.matchedGenres && ev.matchedGenres.length > 0)) && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {ev.pillGenre ? (
                                  <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200">
                                    {ev.pillGenre}
                                  </span>
                                ) : null}
                                {(ev.matchedGenres || []).slice(0, 4).map((g) => (
                                  <span
                                    key={g}
                                    className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-400"
                                  >
                                    {g}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="mt-2 flex shrink-0 gap-2 sm:mt-0 sm:pl-4">
                            {ev.url ? (
                              <a
                                href={ev.url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs hover:bg-neutral-800"
                              >
                                Ticketmaster
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="mt-10 pb-10 text-center text-xs text-neutral-600">
          EventStack • trips are shareable via URL • departure airport is local-only preference
        </div>
      </div>
    </main>
  );
}