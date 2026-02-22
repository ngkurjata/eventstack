// FILE: app/buckets/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "../components/BrandLogo";
import { TAGLINE } from "../../lib/brand";

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
  matchCount?: number;
  hasNearbyMatch?: boolean;
};

type Bucket = {
  bucketIndex: number;
  bucketStart: string;
  bucketEnd: string;
  score: number;
  anchorCount: number;
  crossoverCount: number;
  genreMatchCount: number;
  secondaryCount: number;
  rows: PrimaryRow[];
};

type ApiBucketsResponse = {
  bucketDays?: number;
  horizonDays?: number;
  count?: number;
  buckets?: Bucket[];
  error?: string;
  debug?: any;
};

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

function hasNonEmpty(v: any) {
  return !!(v != null && String(v).trim());
}

function extractDisplayName(raw: string | null) {
  if (!raw) return "";
  const parts = raw.split(":");
  return parts.slice(3).join(":") || parts.slice(2).join(":") || parts[1] || "";
}

/* -------------------- Client-side inflight dedupe -------------------- */

type BucketsFetchResult = { status: number; json: ApiBucketsResponse };
const BUCKETS_INFLIGHT = new Map<string, Promise<BucketsFetchResult>>();
const BUCKETS_TTL = new Map<string, { ts: number; value: BucketsFetchResult }>();
const BUCKETS_TTL_MS = 15_000;

function nowMs() {
  return Date.now();
}

async function fetchBucketsOnce(qs: string): Promise<BucketsFetchResult> {
  const cached = BUCKETS_TTL.get(qs);
  if (cached && nowMs() - cached.ts <= BUCKETS_TTL_MS) return cached.value;

  const inflight = BUCKETS_INFLIGHT.get(qs);
  if (inflight) return inflight;

  const p = (async () => {
    const res = await fetch(`/api/search?${qs}`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as ApiBucketsResponse;
    const out = { status: res.status, json };
    BUCKETS_TTL.set(qs, { ts: nowMs(), value: out });
    return out;
  })().finally(() => {
    BUCKETS_INFLIGHT.delete(qs);
  }) as Promise<BucketsFetchResult>;

  BUCKETS_INFLIGHT.set(qs, p);
  return p;
}

/* -------------------- Page -------------------- */

export default function BucketsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const primaryName = extractDisplayName(sp.get("primaryId"));
  const secondaryName = extractDisplayName(sp.get("secondaryId"));

  const hasPrimary = hasNonEmpty(primaryName);
  const hasSecondary = hasNonEmpty(secondaryName);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [openBucketIndex, setOpenBucketIndex] = useState<number | null>(null);

  // Build the querystring ONCE per navigation
  const qsRef = useRef<string | null>(null);
  if (qsRef.current === null) {
    const q = new URLSearchParams(sp.toString());

    // force buckets mode
    q.set("mode", "buckets");

    // you can tune these later
    if (!q.get("bucketDays")) q.set("bucketDays", "4");
    if (!q.get("topBuckets")) q.set("topBuckets", "10");

    // default: keep computeNearbyMatch OFF unless user explicitly set it
    // (because it can be slow/costly)
    // If you want it ON when genres selected, flip this logic later.

    qsRef.current = q.toString();
  }

  useEffect(() => {
    let alive = true;
    const qs = qsRef.current!;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const { status, json } = await fetchBucketsOnce(qs);
        if (!alive) return;

        if (status < 200 || status >= 300 || json?.error) {
          setBuckets([]);
          setErr(json?.error || `Request failed (${status})`);
          setLoading(false);
          return;
        }

        setBuckets(Array.isArray(json?.buckets) ? json.buckets : []);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setBuckets([]);
        setErr(String(e?.message || e));
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalBuckets = buckets.length;

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Brand bar */}
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-4 lg:max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BrandLogo />
              <div className="min-w-0">
                <div className="text-base font-black tracking-tight text-slate-900">Buckets</div>
                <div className="text-xs text-slate-600">{TAGLINE}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.push(`/results?${sp.toString()}`)}
                className="shrink-0 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-extrabold text-slate-800 hover:bg-slate-50"
              >
                Rows view
              </button>

              <button
                type="button"
                onClick={() => router.push("/")}
                className="shrink-0 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-extrabold text-slate-800 hover:bg-slate-50"
              >
                Revise search
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-3xl lg:py-10">
        {loading && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
            Loading…
          </div>
        )}

        {!loading && err && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 shadow-sm">
            {err}
          </div>
        )}

        {!loading && !err && totalBuckets === 0 && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
            No buckets returned for this search.
          </div>
        )}

        {!loading && !err && totalBuckets > 0 && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-300 bg-slate-200 p-6 text-center shadow-sm">
              <div className="text-lg sm:text-xl font-semibold text-slate-900 leading-relaxed">
                Top{" "}
                <span className="inline-block rounded-xl bg-slate-900 px-3 py-1 text-xl sm:text-2xl font-black text-white shadow-sm">
                  {totalBuckets}
                </span>{" "}
                date buckets for{" "}
                <span className="font-black">{primaryName || "Primary"}</span>
                {hasSecondary ? (
                  <>
                    {" "}
                    + <span className="font-black">{secondaryName}</span>
                  </>
                ) : null}
              </div>

              <div className="mt-2 text-xs font-medium text-slate-700">
                Each bucket is a fixed 4-day window; buckets are ranked by overlap density.
              </div>
            </div>

            {buckets.map((b) => {
              const open = openBucketIndex === b.bucketIndex;

              return (
                <div
                  key={b.bucketIndex}
                  className={cx(
                    "overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm",
                    open ? "ring-2 ring-slate-900/10" : ""
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setOpenBucketIndex(open ? null : b.bucketIndex)}
                    className={cx(
                      "w-full cursor-pointer select-none px-4 py-4 transition sm:px-5 text-left",
                      open ? "bg-slate-900 text-white" : "bg-white"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className={cx("text-sm font-extrabold", open ? "text-slate-100" : "text-slate-900")}>
                          {prettyYMD(b.bucketStart)} — {prettyYMD(b.bucketEnd)}
                        </div>

                        <div className={cx("mt-1 text-[12px]", open ? "text-slate-100" : "text-slate-700")}>
                          Score <span className="font-black">{Math.round(b.score)}</span> ·{" "}
                          {b.anchorCount} primary · {b.crossoverCount} overlap · {b.secondaryCount} secondary
                          {typeof b.genreMatchCount === "number" ? <> · {b.genreMatchCount} genre-hits</> : null}
                        </div>
                      </div>

                      <div className={cx("shrink-0 rounded-full px-3 py-1 text-[11px] font-black", open ? "bg-white/15" : "bg-slate-100 text-slate-900")}>
                        {b.rows?.length || 0} rows
                      </div>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
                      <div className="space-y-2">
                        {(b.rows || []).map((r) => {
                          const a = r.anchor || {};
                          return (
                            <div
                              key={r.rowKey}
                              className={cx(
                                "rounded-2xl border px-3.5 py-3 sm:px-4",
                                r.hasCrossover ? "bg-slate-200 border-slate-300" : "bg-white border-slate-200"
                              )}
                            >
                              <div className="text-[12px] font-bold tracking-wide text-slate-700">
                                {prettyYMD(a.date)}{a.location ? ` — ${a.location}` : ""}
                              </div>
                              <div className="text-sm font-extrabold text-slate-900">{a.name || "Untitled event"}</div>

                              {r.hasCrossover && hasSecondary && (
                                <div className="mt-2 inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                                  {secondaryName} overlap
                                </div>
                              )}

                              <div className="mt-2">
                                <button
                                  type="button"
                                  onClick={() => router.push(`/results?${sp.toString()}&focusRowKey=${encodeURIComponent(r.rowKey)}`)}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-extrabold text-slate-800 hover:bg-slate-50"
                                >
                                  Open in rows view
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}