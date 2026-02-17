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
};

type PrimaryRow = {
  rowKey: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  anchor: RowEvent;
  hasCrossover: boolean;
  secondaryEvents?: RowEvent[];
  matchingEvents?: RowEvent[];
};

type ApiRowsResponse = {
  count?: number;
  rows?: PrimaryRow[];
  error?: string;
  debug?: any;
};

type Kind = "secondary" | "matching";
type BucketItem = { kind: Kind; e: RowEvent };

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

function isBefore(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  return a < b;
}

/** Stable-ish key for selection + dedupe on UI side */
function eventKey(e: RowEvent) {
  return [e.date || "", e.location || "", e.name || "", e.url || ""].join("|");
}

/** Keep the build-trip URL small (avoid passing __raw) */
function slimEvent(e: any): RowEvent {
  return {
    date: e?.date ?? null,
    name: e?.name ?? "",
    location: e?.location ?? "",
    genre: e?.genre ?? null,
    url: e?.url ?? null,
  };
}

/* -------------------- Components -------------------- */

function CheckBoxPill({ selected }: { selected: boolean }) {
  return (
    <div
      className={cx(
        "h-5 w-5 shrink-0 rounded border flex items-center justify-center text-[12px] font-black",
        selected ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300 text-transparent"
      )}
      aria-hidden
    >
      ✓
    </div>
  );
}

function ExpandedEventRow({
  kind,
  e,
  selected,
  onToggle,
}: {
  kind: Kind;
  e: RowEvent;
  selected: boolean;
  onToggle: () => void;
}) {
  const isSecondary = kind === "secondary";

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cx(
        "w-full text-left rounded-2xl border px-4 py-3 transition",
        selected ? "ring-2 ring-slate-900" : "",
        isSecondary ? "border-slate-300 bg-slate-100" : "border-slate-200 bg-white",
        "hover:bg-slate-50"
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CheckBoxPill selected={selected} />

          <div className="min-w-[110px] text-xs font-black text-slate-900">
            {prettyYMD(e.date || null)}
          </div>

          <div className="text-xs font-extrabold text-slate-700">{e.location || "Location TBD"}</div>

          {isSecondary && (
            <div className="rounded-xl bg-slate-900 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white">
              Secondary
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <div className="text-xs font-semibold text-slate-900">{e.name || "Untitled event"}</div>

          {e.url && (
            <a
              href={e.url}
              target="_blank"
              rel="noreferrer"
              onClick={(ev) => ev.stopPropagation()}
              className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-50"
            >
              Open
            </a>
          )}
        </div>
      </div>
    </button>
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

  // Selection + airport state (per expanded row)
  const [selectedByRow, setSelectedByRow] = useState<Record<string, Record<string, boolean>>>({});
  const [airportByRow, setAirportByRow] = useState<Record<string, string>>({});

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

  const hasAnyRows = rows.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {/* Top bar */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="text-lg font-black tracking-tight text-slate-900">Results</div>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-black tracking-wide text-white hover:bg-slate-800"
        >
          Revise search
        </button>
      </div>

      {/* States */}
      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">Loading…</div>
      )}

      {!loading && err && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">{err}</div>
      )}

      {!loading && !err && !hasAnyRows && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          No primary events found for this search.
        </div>
      )}

      {/* Primary rows */}
      {!loading && !err && hasAnyRows && (
        <div className="space-y-3">
          {rows.map((r) => {
            const isOpen = expandedKey === r.rowKey;
            const a = r.anchor || {};
            const aDate = a.date || null;

            const secondary = Array.isArray(r.secondaryEvents) ? r.secondaryEvents : [];
            const matching = Array.isArray(r.matchingEvents) ? r.matchingEvents : [];

            const before: BucketItem[] = [];
            const after: BucketItem[] = [];

            for (const e of secondary) {
              const d = e?.date || null;
              (isBefore(d, aDate) ? before : after).push({ kind: "secondary", e });
            }
            for (const e of matching) {
              const d = e?.date || null;
              (isBefore(d, aDate) ? before : after).push({ kind: "matching", e });
            }

            before.sort((x, y) => (x.e?.date || "").localeCompare(y.e?.date || ""));
            after.sort((x, y) => (x.e?.date || "").localeCompare(y.e?.date || ""));

            const airport = airportByRow[r.rowKey] || "";

            function buildTrip() {
              const selectedKeys = selectedByRow[r.rowKey] || {};

              const allSelectable = [...before.map((x) => x.e), a, ...after.map((x) => x.e)];
              const picked = allSelectable.filter((ev) => selectedKeys[eventKey(ev)]);
              const finalPicked = (picked.length ? picked : [a]).map(slimEvent);

              const payload = {
                rowKey: r.rowKey,
                airport: airport.trim(),
                anchor: slimEvent(a),
                events: finalPicked,
              };

              const encoded = encodeURIComponent(JSON.stringify(payload));
              window.open(`/build-trip?data=${encoded}`, "_blank", "noopener,noreferrer");
            }

            function openRow() {
              setExpandedKey(r.rowKey);

              // default select anchor on first open
              setSelectedByRow((prev) => {
                if (prev[r.rowKey]) return prev;
                const k = eventKey(a);
                return { ...prev, [r.rowKey]: { [k]: true } };
              });
            }

            return (
              <div
                key={r.rowKey}
                className={cx("rounded-2xl border border-slate-200", isOpen ? "bg-slate-200 shadow-sm" : "bg-white")}
              >
                {/* EXPANDED HEADER */}
                {isOpen && (
                  <div className="px-4 pt-4 sm:px-5">
                    <div className="rounded-2xl border border-slate-300 bg-white/70 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-black text-slate-900">
                            Select the events you’re interested in, enter an airport, then build your trip.
                          </div>
                          <div className="mt-1 text-xs font-semibold text-slate-600">
                            Tip: click events in the list to toggle selection (including the primary event).
                          </div>
                        </div>

                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                          <input
                            value={airport}
                            onChange={(e) => setAirportByRow((prev) => ({ ...prev, [r.rowKey]: e.target.value }))}
                            placeholder="Airport (e.g., YYZ)"
                            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-slate-900 sm:w-48"
                          />

                          <button
                            type="button"
                            onClick={buildTrip}
                            className="rounded-2xl bg-slate-900 px-5 py-2 text-sm font-black text-white hover:bg-slate-800"
                          >
                            Build trip
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* EXPANDED: BEFORE */}
                {isOpen && before.length > 0 && (
                  <div className="px-4 py-3 sm:px-5">
                    <div className="space-y-2">
                      {before.map(({ kind, e }, idx) => (
                        <ExpandedEventRow
                          key={`${kind}-b-${idx}-${e.url || e.name || ""}`}
                          kind={kind}
                          e={e}
                          selected={isSelected(r.rowKey, e)}
                          onToggle={() => toggleSelected(r.rowKey, e)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* PRIMARY ROW (div, not button => avoids nested button error) */}
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
                    "w-full text-left px-4 py-4 sm:px-5 transition cursor-pointer select-none",
                    isOpen ? (r.hasCrossover ? "bg-slate-300" : "bg-transparent") : r.hasCrossover ? "bg-slate-100" : "bg-white",
                    isOpen ? "rounded-t-2xl" : "rounded-2xl"
                  )}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      {/* Anchor checkbox */}
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggleSelected(r.rowKey, a);
                        }}
                        className="shrink-0"
                        aria-label={isSelected(r.rowKey, a) ? "Unselect primary event" : "Select primary event"}
                      >
                        <CheckBoxPill selected={isSelected(r.rowKey, a)} />
                      </button>

                      <div className="min-w-[110px] text-sm font-black text-slate-900">{prettyYMD(a.date || null)}</div>

                      <div className="text-sm font-extrabold text-slate-700">{a.location || "Location TBD"}</div>
                    </div>

                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <div className="text-sm font-semibold text-slate-900">{a.name || "Untitled event"}</div>

                      {a.url && (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(ev) => ev.stopPropagation()}
                          className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-50"
                        >
                          Open
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 text-[11px] font-semibold text-slate-600">
                    {r.hasCrossover ? "Secondary favorite nearby — click to expand" : "Click to expand"}
                  </div>
                </div>

                {/* EXPANDED: AFTER */}
                {isOpen && after.length > 0 && (
                  <div className="px-4 py-3 sm:px-5">
                    <div className="space-y-2">
                      {after.map(({ kind, e }, idx) => (
                        <ExpandedEventRow
                          key={`${kind}-a-${idx}-${e.url || e.name || ""}`}
                          kind={kind}
                          e={e}
                          selected={isSelected(r.rowKey, e)}
                          onToggle={() => toggleSelected(r.rowKey, e)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {isOpen && before.length === 0 && after.length === 0 && (
                  <div className="px-4 py-4 text-sm text-slate-700 sm:px-5">
                    No matching events for the selected filters in this window.
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
