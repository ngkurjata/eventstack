// FILE: app/results/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* -------------------- Types -------------------- */

type RowEvent = {
  date?: string | null;
  name?: string;
  location?: string;
  genre?: string | null;
  url?: string | null;
  lat?: number | null;
  lon?: number | null;
};

type PrimaryRow = {
  rowKey: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  anchor: RowEvent;
  hasCrossover: boolean;
  secondaryEvents?: RowEvent[];
};

type ApiRowsResponse = {
  count?: number;
  rows?: PrimaryRow[];
  error?: string;
  debug?: any;
};

type TripMatchesEvent = {
  id: string;
  tmID?: string | null;
  name: string;
  url?: string | null;
  dateLocal?: string | null;
  venue?: string | null;
  city?: string | null;
  region?: string | null;
  segment?: string | null;
  genre?: string | null;
};

type ApiTripMatchesResponse = {
  events?: TripMatchesEvent[];
  error?: string;
  debug?: any;
};

type Kind = "secondary" | "matching";
type AllKind = "primary" | Kind;

/* -------------------- Small utils -------------------- */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function parseYMDToUTC(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function fmtUTC(dt: Date, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(dt);
}

function prettyYMD(ymd?: string | null) {
  if (!ymd) return "—";
  const dt = parseYMDToUTC(ymd);
  if (!dt) return String(ymd);
  const m = fmtUTC(dt, { month: "short" });
  const d = fmtUTC(dt, { day: "2-digit" });
  const y = fmtUTC(dt, { year: "numeric" });
  return `${m} ${d}, ${y}`;
}

function eventKey(e: RowEvent) {
  return [e.date || "", e.location || "", e.name || "", e.url || ""].join("|");
}

function eventIdentityKey(e: RowEvent) {
  const url = String(e?.url || "").trim();
  if (url) return `url:${url}`;

  const date = String(e?.date || "").slice(0, 10);
  const name = String(e?.name || "").trim().toLowerCase();
  const loc = String(e?.location || "").trim().toLowerCase();

  return `sig:${date}|${name}|${loc}`;
}

function slimEvent(e: any): RowEvent {
  return {
    date: e?.date ?? null,
    name: e?.name ?? "",
    location: e?.location ?? "",
    genre: e?.genre ?? null,
    url: e?.url ?? null,
  };
}

function hasAnySelectedGenres(sp: ReturnType<typeof useSearchParams>) {
  const mg = sp.getAll("musicGenres").filter(Boolean);
  const sg = sp.getAll("sportsGenres").filter(Boolean);
  return mg.length + sg.length > 0;
}

function hasNonEmpty(v: any) {
  return !!(v != null && String(v).trim());
}

/* -------------------- UI bits -------------------- */

function CheckBoxPill({ selected }: { selected: boolean }) {
  return (
    <div
      className={cx(
        "h-4.5 w-4.5 sm:h-5 sm:w-5 shrink-0 rounded border flex items-center justify-center text-[11px] sm:text-[12px] font-black",
        selected ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300 text-transparent"
      )}
      aria-hidden
    >
      ✓
    </div>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={cx(
        "h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200",
        open ? "rotate-180" : "rotate-0"
      )}
    >
      <path
        d="M5.25 7.75L10 12.5l4.75-4.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------- Page -------------------- */

export default function ResultsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<PrimaryRow[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const [selectedByRow, setSelectedByRow] = useState<Record<string, Record<string, boolean>>>({});

  const [matchingByRow, setMatchingByRow] = useState<Record<string, RowEvent[]>>({});
  const [matchingLoadingByRow, setMatchingLoadingByRow] = useState<Record<string, boolean>>({});
  const [matchingErrByRow, setMatchingErrByRow] = useState<Record<string, string | null>>({});

  function isSelected(rowKey: string, e: RowEvent) {
    const k = eventKey(e);
    return !!selectedByRow[rowKey]?.[k];
  }

  function toggleSelected(rowKey: string, e: RowEvent) {
    const k = eventKey(e);
    setSelectedByRow((prev) => {
      const rowMap = { ...(prev[rowKey] || {}) };
      rowMap[k] = !rowMap[k];
      return { ...prev, [rowKey]: rowMap };
    });
  }

  const qs = useMemo(() => {
    const q = new URLSearchParams(sp.toString());
    q.set("mode", "rows");
    return q.toString();
  }, [sp]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);

      try {
        const res = await fetch(`/api/search?${qs}`, { cache: "no-store" });
        const json = (await res.json()) as ApiRowsResponse;

        if (cancelled) return;

        if (!res.ok || json?.error) {
          setRows([]);
          setErr(json?.error || `Request failed (${res.status})`);
          setLoading(false);
          return;
        }

        setRows(Array.isArray(json?.rows) ? json.rows : []);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setRows([]);
        setErr(String(e?.message || e));
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [qs]);

  async function fetchGenreMatchingForRow(row: PrimaryRow) {
    const rowKey = row.rowKey;

    const wantsGenres = hasAnySelectedGenres(sp);
    if (!wantsGenres) {
      setMatchingByRow((prev) => ({ ...prev, [rowKey]: [] }));
      setMatchingErrByRow((prev) => ({ ...prev, [rowKey]: null }));
      return;
    }

    if (matchingByRow[rowKey]) return;
    if (matchingLoadingByRow[rowKey]) return;

    const lat = row.anchor?.lat;
    const lon = row.anchor?.lon;
    if (lat == null || lon == null) {
      setMatchingByRow((prev) => ({ ...prev, [rowKey]: [] }));
      setMatchingErrByRow((prev) => ({
        ...prev,
        [rowKey]: "No venue coordinates available for this primary event, so genre matching can’t be computed.",
      }));
      return;
    }

    const start = row.windowStart || null;
    const end = row.windowEnd || null;
    if (!start || !end) {
      setMatchingByRow((prev) => ({ ...prev, [rowKey]: [] }));
      setMatchingErrByRow((prev) => ({ ...prev, [rowKey]: "Missing windowStart/windowEnd for this row." }));
      return;
    }

    setMatchingLoadingByRow((prev) => ({ ...prev, [rowKey]: true }));
    setMatchingErrByRow((prev) => ({ ...prev, [rowKey]: null }));

    try {
      const q = new URLSearchParams();
      q.set("start", start);
      q.set("end", end);
      q.set("lat", String(lat));
      q.set("lon", String(lon));

      const radiusMiles = sp.get("radiusMiles");
      if (radiusMiles) q.set("radiusMiles", radiusMiles);

      for (const g of sp.getAll("musicGenres")) q.append("musicGenres", g);
      for (const g of sp.getAll("sportsGenres")) q.append("sportsGenres", g);

      const res = await fetch(`/api/trip-matches?${q.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as ApiTripMatchesResponse;

      if (!res.ok || json?.error) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }

      const raw = Array.isArray(json?.events) ? json.events : [];

      const blocked = new Set<string>();
      blocked.add(eventIdentityKey(row.anchor));
      for (const se of Array.isArray(row.secondaryEvents) ? row.secondaryEvents : []) {
        blocked.add(eventIdentityKey(se));
      }

      const seen = new Set<string>();

      const mapped: RowEvent[] = raw
        .map((e) => {
          const date = (e?.dateLocal || "").slice(0, 10) || null;
          const location = [e?.city, e?.region].filter(Boolean).join(", ") || "";
          return {
            date,
            name: e?.name || "Event",
            location,
            genre: e?.genre ?? null,
            url: e?.url ?? null,
          } as RowEvent;
        })
        .filter((ev) => {
          if (!hasNonEmpty(ev.date)) return false;

          const idk = eventIdentityKey(ev);
          if (blocked.has(idk)) return false;
          if (seen.has(idk)) return false;
          seen.add(idk);
          return true;
        });

      setMatchingByRow((prev) => ({ ...prev, [rowKey]: mapped }));
      setMatchingErrByRow((prev) => ({ ...prev, [rowKey]: null }));
    } catch (e: any) {
      setMatchingByRow((prev) => ({ ...prev, [rowKey]: [] }));
      setMatchingErrByRow((prev) => ({ ...prev, [rowKey]: String(e?.message || e) }));
    } finally {
      setMatchingLoadingByRow((prev) => ({ ...prev, [rowKey]: false }));
    }
  }

  const hasAnyRows = rows.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="text-base sm:text-lg font-black tracking-tight text-slate-900">Results</div>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-2xl bg-slate-900 px-3.5 py-2 text-[11px] sm:text-xs font-black tracking-wide text-white hover:bg-slate-800"
        >
          Revise search
        </button>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 text-sm text-slate-700">
          Loading…
        </div>
      )}

      {!loading && err && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 sm:p-6 text-sm text-rose-800">{err}</div>
      )}

      {!loading && !err && !hasAnyRows && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 text-sm text-slate-700">
          No primary events found for this search.
        </div>
      )}

      {!loading && !err && hasAnyRows && (
        <div className="space-y-3">
          {rows.map((r) => {
            const isOpen = expandedKey === r.rowKey;
            const a: RowEvent = r.anchor || {};

            const aHasDate = hasNonEmpty(a.date);
            const aHasLoc = hasNonEmpty(a.location);

            const secondary = Array.isArray(r.secondaryEvents) ? r.secondaryEvents : [];
            const matching = matchingByRow[r.rowKey] || [];
            const matchingLoading = !!matchingLoadingByRow[r.rowKey];
            const matchingErr = matchingErrByRow[r.rowKey] || null;

            const allEvents: { kind: AllKind; e: RowEvent }[] = [
              { kind: "primary" as const, e: a },
              ...secondary.map((e) => ({ kind: "secondary" as const, e })),
              ...matching.map((e) => ({ kind: "matching" as const, e })),
            ].sort((x, y) => (x.e?.date || "").localeCompare(y.e?.date || ""));

            function buildTrip() {
              const selectedKeys = selectedByRow[r.rowKey] || {};
              const allSelectable = allEvents.map((x) => x.e);
              const picked = allSelectable.filter((ev) => selectedKeys[eventKey(ev)]);

              const finalPicked = (picked.length ? picked : [a]).map(slimEvent);

              const payload = { rowKey: r.rowKey, anchor: slimEvent(a), events: finalPicked };
              const encoded = encodeURIComponent(JSON.stringify(payload));
              window.open(`/build-trip?data=${encoded}`, "_blank", "noopener,noreferrer");
            }

            async function openRow() {
              setExpandedKey(r.rowKey);

              setSelectedByRow((prev) => {
                if (prev[r.rowKey]) return prev;

                const rowMap: Record<string, boolean> = {};
                rowMap[eventKey(a)] = true;
                for (const se of secondary) rowMap[eventKey(se)] = true;

                return { ...prev, [r.rowKey]: rowMap };
              });

              await fetchGenreMatchingForRow(r);
            }

            return (
              <div
                key={r.rowKey}
                className={cx(
                  "rounded-2xl border border-slate-200 overflow-hidden",
                  isOpen ? "bg-slate-200 shadow-sm" : "bg-white"
                )}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => (isOpen ? setExpandedKey(null) : openRow())}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      isOpen ? setExpandedKey(null) : openRow();
                    }
                  }}
                  className={cx(
                    "w-full text-left px-4 py-3.5 sm:py-4 sm:px-5 transition cursor-pointer select-none flex items-start justify-between gap-4",
                    isOpen ? (r.hasCrossover ? "bg-slate-300" : "bg-transparent") : r.hasCrossover ? "bg-slate-100" : "bg-white"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    {(aHasDate || aHasLoc) && (
                      <div className="text-sm sm:text-base font-extrabold text-slate-900">
                        {aHasDate ? prettyYMD(a.date) : null}
                        {aHasDate && aHasLoc ? " — " : null}
                        {aHasLoc ? a.location : null}
                      </div>
                    )}

                    <div className="mt-0.5 text-base sm:text-lg font-semibold text-slate-800 truncate">
                      {a.name || "Untitled event"}
                    </div>

                    {isOpen && (
                      <div className="mt-3 text-center text-xs sm:text-sm font-semibold tracking-wide text-slate-600">
                        Select the events you’d like to include in a trip.
                      </div>
                    )}
                  </div>

                  <div className="pt-0.5">
                    <ChevronDown open={isOpen} />
                  </div>
                </div>

                {isOpen && (
                  <div className="px-4 py-4 sm:px-5 bg-white border-t border-slate-200">
                    {(matchingLoading || matchingErr) && (
                      <div
                        className={cx(
                          "mb-3 rounded-2xl border px-4 py-3 text-[11px] sm:text-xs font-semibold",
                          matchingErr ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-slate-50 text-slate-700"
                        )}
                      >
                        {matchingErr ? `Matching events unavailable: ${matchingErr}` : "Loading matching events…"}
                      </div>
                    )}

                    <div className="space-y-2">
                      {allEvents.map(({ kind, e }) => {
                        const primary = kind === "primary";
                        const secondaryKind = kind === "secondary";
                        const selected = isSelected(r.rowKey, e);

                        const hasDate = hasNonEmpty(e.date);
                        const hasLoc = hasNonEmpty(e.location);

                        return (
                          <button
                            key={`${kind}:${eventKey(e)}`}
                            type="button"
                            onClick={() => toggleSelected(r.rowKey, e)}
                            className={cx(
                              "w-full text-left rounded-2xl border px-3.5 py-3 sm:px-4 sm:py-3 transition",
                              selected ? "ring-2 ring-slate-900" : "",
                              primary
                                ? "bg-slate-200 border-slate-300"
                                : secondaryKind
                                ? "bg-slate-100 border-slate-300"
                                : "bg-white border-slate-200 hover:bg-slate-50"
                            )}
                          >
                            <div className="flex items-start gap-3 justify-between">
                              <div className="flex items-start gap-3 flex-1 pr-3">
                                <div className="pt-0.5">
                                  <CheckBoxPill selected={selected} />
                                </div>

                                <div className="min-w-0 flex-1">
                                  {(hasDate || hasLoc) && (
                                    <div className="text-[12px] sm:text-[13px] font-bold tracking-wide text-slate-700">
                                      {hasDate ? prettyYMD(e.date) : null}
                                      {hasDate && hasLoc ? " — " : null}
                                      {hasLoc ? e.location : null}
                                    </div>
                                  )}

                                  <div className="text-sm sm:text-base font-extrabold text-slate-900">
                                    {e.name || "Untitled event"}
                                  </div>
                                </div>
                              </div>

                              <div className="shrink-0">
                                {primary ? (
                                  <div className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                                    Primary
                                  </div>
                                ) : secondaryKind ? (
                                  <div className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                                    Secondary
                                  </div>
                                ) : (
                                  <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-700">
                                    {e.genre ? e.genre : "Matching"}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-5 sm:mt-6 flex justify-center">
                      <button
                        type="button"
                        onClick={buildTrip}
                        className="rounded-2xl bg-slate-900 px-7 py-2.5 sm:px-8 sm:py-3 text-sm font-black text-white hover:bg-slate-800"
                      >
                        Build trip
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
