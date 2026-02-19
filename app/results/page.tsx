// FILE: app/results/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "../components/BrandLogo";
import { TAGLINE } from "../../lib/brand";

/* -------------------- Client-side inflight dedupe (prevents dev StrictMode double-fetch) -------------------- */
// React StrictMode in dev does mount → unmount → mount, which will otherwise fire the rows fetch twice.
// This module-scope cache survives the StrictMode remount and guarantees only ONE network call per qs.
type RowsFetchResult = { status: number; json: ApiRowsResponse };
const ROWS_INFLIGHT = new Map<string, Promise<RowsFetchResult>>();
const ROWS_TTL = new Map<string, { ts: number; value: RowsFetchResult }>();
const ROWS_TTL_MS = 15_000;

function nowMs() {
  return Date.now();
}

async function fetchRowsOnce(qs: string): Promise<RowsFetchResult> {
  // short TTL cache (helps back/forward and StrictMode quirks)
  const cached = ROWS_TTL.get(qs);
  if (cached && nowMs() - cached.ts <= ROWS_TTL_MS) return cached.value;

  const inflight = ROWS_INFLIGHT.get(qs);
  if (inflight) return inflight;

  const p = (async () => {
    const res = await fetch(`/api/search?${qs}`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as ApiRowsResponse;
    const out = { status: res.status, json };
    ROWS_TTL.set(qs, { ts: nowMs(), value: out });
    return out;
  })().finally(() => {
    ROWS_INFLIGHT.delete(qs);
  }) as Promise<RowsFetchResult>;

  ROWS_INFLIGHT.set(qs, p);
  return p;
}

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
  hasNearbyMatch?: boolean; // legacy server field (not used for the new flow)
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

function joinedSelectedGenres(sp: ReturnType<typeof useSearchParams>) {
  const sg = sp.getAll("sportsGenres").filter(Boolean);
  const mg = sp.getAll("musicGenres").filter(Boolean);
  return [...sg, ...mg].filter((v, i, arr) => arr.indexOf(v) === i);
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
        "h-5 w-5 shrink-0 rounded border flex items-center justify-center text-[12px] font-black",
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
      className={cx("h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200", open ? "rotate-180" : "rotate-0")}
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

function MiniSpinner() {
  return <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" aria-hidden="true" />;
}

function CheckMark() {
  return (
    <div
      className="h-5 w-5 shrink-0 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[12px] font-black"
      aria-hidden="true"
      title="Yes"
    >
      ✓
    </div>
  );
}

function ThumbsDown() {
  return (
    <span className="text-[16px]" role="img" aria-label="No nearby events" title="No nearby events">
      👎
    </span>
  );
}

function ShrugIcon() {
  return (
    <span className="text-[16px]" role="img" aria-label="Not sure" title="Not sure">
      🤷
    </span>
  );
}

/* -------------------- Nearby check state (existence only) -------------------- */

type NearbyCheckStatus = "idle" | "checking" | "hit" | "miss" | "unsure";

type NearbyCheckState = {
  status: NearbyCheckStatus;
  attempts: number;
  lastError?: string;
  checkedAt?: number;
};

/* -------------------- Networking helpers -------------------- */

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const outerSignal = init.signal;
  const signal = outerSignal ?? controller.signal;

  let t: number | null = null;
  const ownSignal = !outerSignal;

  if (ownSignal) {
    t = window.setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    return await fetch(input, { ...init, signal });
  } finally {
    if (t) window.clearTimeout(t);
  }
}

async function runNearbyCheckWithRetry(opts: {
  makeUrl: () => string;
  signal: AbortSignal;
  maxAttempts: number;
  timeoutMs: number;
  backoffMs: number;
  onAttempt: (attempt: number) => void;
  onFailAttempt: (attempt: number, err: string) => void;
}): Promise<{ exists: boolean } | null> {
  const { makeUrl, signal, maxAttempts, timeoutMs, backoffMs, onAttempt, onFailAttempt } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) return null;

    onAttempt(attempt);

    try {
      const res = await fetchWithTimeout(makeUrl(), { cache: "no-store", signal }, timeoutMs);
      const json = await res.json();

      if (!res.ok || json?.error) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }

      return { exists: !!json?.exists };
    } catch (e: any) {
      if (signal.aborted) return null;

      const msg = String(e?.message || e);
      onFailAttempt(attempt, msg);

      if (attempt === maxAttempts) return null;

      await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }

  return null;
}

/* -------------------- Page -------------------- */

const AUTO_SCAN_INITIAL = 20;
const SESSION_CACHE_PREFIX = "eventstack_nearby_v2";
const NEARBY_MAX_ATTEMPTS = 2;
const NEARBY_TIMEOUT_MS = 12000;

export default function ResultsPage() {
  const router = useRouter();
  const sp = useSearchParams();

  function extractDisplayName(raw: string | null) {
    if (!raw) return "";
    const parts = raw.split(":");
    return parts.slice(3).join(":") || parts.slice(2).join(":") || parts[1] || "";
  }

  const primaryName = extractDisplayName(sp.get("primaryId"));
  const secondaryName = extractDisplayName(sp.get("secondaryId"));

  const selectedGenres = useMemo(() => joinedSelectedGenres(sp), [sp]);
  const hasPrimary = hasNonEmpty(primaryName);
  const hasSecondary = hasNonEmpty(secondaryName);
  const hasP1AndP2 = hasPrimary && hasSecondary;

  const wantsGenres = hasAnySelectedGenres(sp);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<PrimaryRow[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const [scanningRowKey, setScanningRowKey] = useState<string | null>(null);
  const userInteractedRef = useRef(false);

  const [selectedByRow, setSelectedByRow] = useState<Record<string, Record<string, boolean>>>({});

  const [matchingByRow, setMatchingByRow] = useState<Record<string, RowEvent[]>>({});
  const [matchingLoadingByRow, setMatchingLoadingByRow] = useState<Record<string, boolean>>({});
  const [matchingErrByRow, setMatchingErrByRow] = useState<Record<string, string | null>>({});

  const [nearbyByRow, setNearbyByRow] = useState<Record<string, NearbyCheckState>>({});
  const nearbyCacheRef = useRef<Map<string, NearbyCheckState>>(new Map());

  // Separate abort controllers: scan runner vs openRow check
  const scanAbortRef = useRef<AbortController | null>(null);
  const openRowAbortRef = useRef<AbortController | null>(null);

  // Row DOM refs for "scan on view"
  const rowElByKeyRef = useRef<Map<string, HTMLElement>>(new Map());

  // Scan queue (sequential)
  const scanQueueRef = useRef<string[]>([]);
  const queuedSetRef = useRef<Set<string>>(new Set());
  const scanRunnerActiveRef = useRef(false);

  // sessionStorage persistence (write-through, debounced)
  const persistTimerRef = useRef<number | null>(null);

  function stopAllWork() {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;

    openRowAbortRef.current?.abort();
    openRowAbortRef.current = null;

    setScanningRowKey(null);

    scanQueueRef.current = [];
    queuedSetRef.current = new Set();
    scanRunnerActiveRef.current = false;
  }

  useEffect(() => {
    return () => stopAllWork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /* -------------------- Fetch rows (ONE per navigation) -------------------- */

  // Capture qs once for this mount; module-level inflight cache prevents StrictMode remount duplicates.
  const qsRef = useRef<string | null>(null);
  if (qsRef.current === null) {
    const q = new URLSearchParams(sp.toString());
    q.set("mode", "rows");
    q.delete("computeNearbyMatch");
    qsRef.current = q.toString();
  }

  useEffect(() => {
    stopAllWork();

    let alive = true;
    const qs = qsRef.current!;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const { status, json } = await fetchRowsOnce(qs);
        if (!alive) return;

        if (status < 200 || status >= 300 || json?.error) {
          setRows([]);
          setErr(json?.error || `Request failed (${status})`);
          setLoading(false);
          return;
        }

        setRows(Array.isArray(json?.rows) ? json.rows : []);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setRows([]);
        setErr(String(e?.message || e));
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // 🔒 intentionally empty deps: one fetch per mount/navigation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------- Cache signature -------------------- */

  const nearbySignature = useMemo(() => {
    const radiusMiles = sp.get("radiusMiles") || "";
    const music = sp.getAll("musicGenres").filter(Boolean).sort();
    const sports = sp.getAll("sportsGenres").filter(Boolean).sort();
    return JSON.stringify({ radiusMiles, music, sports });
  }, [sp]);

  function cacheKeyForRow(rowKey: string) {
    return `${rowKey}::${nearbySignature}`;
  }

  function sessionKeyForSignature(sig: string) {
    return `${SESSION_CACHE_PREFIX}::${sig}`;
  }

  function loadPersistedCache(sig: string): Record<string, NearbyCheckState> {
    try {
      const raw = sessionStorage.getItem(sessionKeyForSignature(sig));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      return parsed as Record<string, NearbyCheckState>;
    } catch {
      return {};
    }
  }

  function schedulePersist(sig: string, snapshot: Record<string, NearbyCheckState>) {
    try {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => {
        try {
          sessionStorage.setItem(sessionKeyForSignature(sig), JSON.stringify(snapshot));
        } catch {
          // ignore
        }
      }, 250);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!wantsGenres) return;

    const persisted = loadPersistedCache(nearbySignature);

    for (const [rowKey, st] of Object.entries(persisted)) {
      nearbyCacheRef.current.set(cacheKeyForRow(rowKey), st);
    }

    setNearbyByRow((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const st = persisted[r.rowKey];
        if (st) next[r.rowKey] = st;
      }
      return next;
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearbySignature, wantsGenres, rows]);

  /* -------------------- Nearby existence check (YES/NO/UNSURE) -------------------- */

  function buildExistsUrlForRow(row: PrimaryRow) {
    const lat = row.anchor?.lat;
    const lon = row.anchor?.lon;
    const start = row.windowStart || null;
    const end = row.windowEnd || null;

    const q = new URLSearchParams();
    q.set("start", start || "");
    q.set("end", end || "");
    q.set("lat", String(lat));
    q.set("lon", String(lon));
    q.set("exists", "1");

    const radiusMiles = sp.get("radiusMiles");
    if (radiusMiles) q.set("radiusMiles", radiusMiles);

    for (const g of sp.getAll("musicGenres")) q.append("musicGenres", g);
    for (const g of sp.getAll("sportsGenres")) q.append("sportsGenres", g);

    return `/api/trip-matches?${q.toString()}`;
  }

  function rowHasRequiredInputsForNearby(row: PrimaryRow) {
    if (!wantsGenres) return false;
    const lat = row.anchor?.lat;
    const lon = row.anchor?.lon;
    const start = row.windowStart || null;
    const end = row.windowEnd || null;
    return lat != null && lon != null && !!start && !!end;
  }

  async function computeNearbyStateForRow(row: PrimaryRow, signal: AbortSignal): Promise<NearbyCheckState> {
    if (!wantsGenres) return { status: "miss", attempts: 0 };
    if (!rowHasRequiredInputsForNearby(row)) return { status: "miss", attempts: 0 };

    let lastErr = "";

    const result = await runNearbyCheckWithRetry({
      makeUrl: () => buildExistsUrlForRow(row),
      signal,
      maxAttempts: NEARBY_MAX_ATTEMPTS,
      timeoutMs: NEARBY_TIMEOUT_MS,
      backoffMs: 700,
      onAttempt: (attempt) => {
        setNearbyByRow((prev) => ({
          ...prev,
          [row.rowKey]: {
            status: "checking",
            attempts: attempt,
            lastError: prev[row.rowKey]?.lastError,
            checkedAt: prev[row.rowKey]?.checkedAt,
          },
        }));
      },
      onFailAttempt: (attempt, err2) => {
        lastErr = err2;
        setNearbyByRow((prev) => ({
          ...prev,
          [row.rowKey]: {
            status: "checking",
            attempts: attempt,
            lastError: err2,
            checkedAt: prev[row.rowKey]?.checkedAt,
          },
        }));
      },
    });

    if (signal.aborted) return { status: "idle", attempts: 0 };

    if (!result) {
      return {
        status: "unsure",
        attempts: NEARBY_MAX_ATTEMPTS,
        lastError: lastErr || "unknown",
        checkedAt: Date.now(),
      };
    }

    return {
      status: result.exists ? "hit" : "miss",
      attempts: NEARBY_MAX_ATTEMPTS,
      lastError: undefined,
      checkedAt: Date.now(),
    };
  }

  function setAndCacheNearby(rowKey: string, st: NearbyCheckState) {
    const ck = cacheKeyForRow(rowKey);
    nearbyCacheRef.current.set(ck, st);
    setNearbyByRow((prev) => ({ ...prev, [rowKey]: st }));
  }

  /* -------------------- Full list fetch (ONLY on-demand for rows that are "hit") -------------------- */

  async function fetchGenreMatchingForRow(row: PrimaryRow) {
    const rowKey = row.rowKey;

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

  /* -------------------- Scan queue runner (sequential, bounded retries) -------------------- */

  function enqueueRowScan(rowKey: string) {
    if (!wantsGenres) return;

    const ck = cacheKeyForRow(rowKey);
    if (nearbyCacheRef.current.get(ck)) return;

    const st = nearbyByRow[rowKey]?.status;
    if (st === "hit" || st === "miss" || st === "unsure") return;

    if (queuedSetRef.current.has(rowKey)) return;

    queuedSetRef.current.add(rowKey);
    scanQueueRef.current.push(rowKey);
    ensureScanRunner();
  }

  function ensureScanRunner() {
    if (scanRunnerActiveRef.current) return;
    scanRunnerActiveRef.current = true;

    // cancel any previous scan runner
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    setScanningRowKey(null);

    const ac = new AbortController();
    scanAbortRef.current = ac;

    (async () => {
      try {
        while (scanQueueRef.current.length) {
          if (ac.signal.aborted) return;

          const rowKey = scanQueueRef.current.shift()!;
          queuedSetRef.current.delete(rowKey);

          const row = rows.find((x) => x.rowKey === rowKey);
          if (!row) continue;

          const ck = cacheKeyForRow(rowKey);
          const cached = nearbyCacheRef.current.get(ck);
          if (cached) {
            setNearbyByRow((prev) => ({ ...prev, [rowKey]: cached }));
            continue;
          }

          setScanningRowKey(rowKey);

          const st = await computeNearbyStateForRow(row, ac.signal);
          if (ac.signal.aborted) return;

          setAndCacheNearby(rowKey, st);

          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      } finally {
        setScanningRowKey(null);
        scanRunnerActiveRef.current = false;

        if (scanQueueRef.current.length) {
          queueMicrotask(() => {
            if (!scanRunnerActiveRef.current) ensureScanRunner();
          });
        }
      }
    })();
  }

  useEffect(() => {
    if (!wantsGenres) return;
    if (!rows.length) return;

    const first = rows.slice(0, AUTO_SCAN_INITIAL);
    for (const r of first) enqueueRowScan(r.rowKey);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, wantsGenres, nearbySignature]);

  useEffect(() => {
    if (!wantsGenres) return;
    if (!rows.length) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          if (!ent.isIntersecting) continue;
          const el = ent.target as HTMLElement;
          const rk = el?.dataset?.rowkey;
          if (!rk) continue;
          enqueueRowScan(rk);
        }
      },
      { root: null, threshold: 0.15 }
    );

    for (const r of rows) {
      const el = rowElByKeyRef.current.get(r.rowKey);
      if (el) obs.observe(el);
    }

    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, wantsGenres, nearbySignature]);

  useEffect(() => {
    if (!wantsGenres) return;
    if (!rows.length) return;

    const snapshot: Record<string, NearbyCheckState> = {};
    for (const r of rows) {
      const st = nearbyByRow[r.rowKey];
      if (!st) continue;
      if (st.status === "idle") continue;
      snapshot[r.rowKey] = st;
    }

    schedulePersist(nearbySignature, snapshot);
  }, [nearbyByRow, nearbySignature, wantsGenres, rows]);

  /* -------------------- Derived UI state -------------------- */

  const hasAnyRows = rows.length > 0;
  const p1Count = rows.length;

  const overlapCount = useMemo(() => {
    const rs = rows ?? [];
    return rs.filter((r) => !!r.hasCrossover).length;
  }, [rows]);

  const visibleRows = rows;

  /* -------------------- Render -------------------- */

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Brand bar */}
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-4 lg:max-w-3xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BrandLogo />
              <div className="min-w-0">
                <div className="text-base font-black tracking-tight text-slate-900">Results</div>
                <div className="text-xs text-slate-600">{TAGLINE}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                stopAllWork();
                router.push("/");
              }}
              className="shrink-0 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-extrabold text-slate-800 hover:bg-slate-50"
            >
              Revise search
            </button>
          </div>
        </div>
      </div>

      {/* Content column */}
      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-3xl lg:py-10">
        {loading && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
            <div>Loading…</div>
          </div>
        )}

        {!loading && err && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800 shadow-sm">{err}</div>
        )}

        {!loading && !err && !hasAnyRows && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
            No primary events found for this search.
          </div>
        )}

        {!loading && !err && hasAnyRows && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-300 bg-slate-200 p-6 text-center shadow-sm">
              <div className="space-y-3">
                <div className="text-lg sm:text-xl font-semibold text-slate-900 leading-relaxed">
                  We found{" "}
                  <span className="inline-block rounded-xl bg-slate-900 px-3 py-1 text-xl sm:text-2xl font-black text-white shadow-sm">
                    {p1Count}
                  </span>{" "}
                  {primaryName} events
                  {hasSecondary ? (
                    <>
                      ,{" "}
                      <span className="inline-block rounded-xl bg-slate-900 px-3 py-1 text-xl sm:text-2xl font-black text-white shadow-sm">
                        {overlapCount}
                      </span>{" "}
                      of which overlap{overlapCount === 1 ? "s" : ""} with a nearby {secondaryName} event.
                    </>
                  ) : (
                    "."
                  )}
                </div>

                {hasSecondary && overlapCount > 0 && (
                  <div className="text-xs font-medium text-slate-700">
                    Overlap events are shaded grey for quick visual reference.
                  </div>
                )}
              </div>
            </div>

            {visibleRows.map((r) => {
              const isOpen = expandedKey === r.rowKey;
              const a: RowEvent = r.anchor || {};

              const aHasDate = hasNonEmpty(a.date);
              const aHasLoc = hasNonEmpty(a.location);

              const secondary = Array.isArray(r.secondaryEvents) ? r.secondaryEvents : [];
              const matching = matchingByRow[r.rowKey] || [];
              const matchingLoading = !!matchingLoadingByRow[r.rowKey];
              const matchingErr = matchingErrByRow[r.rowKey] || null;

              const inlineSpinner = isOpen && wantsGenres && matchingLoading;

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
                userInteractedRef.current = true;
                setExpandedKey(r.rowKey);

                setSelectedByRow((prev) => {
                  if (prev[r.rowKey]) return prev;
                  const rowMap: Record<string, boolean> = {};
                  rowMap[eventKey(a)] = true;
                  for (const se of secondary) rowMap[eventKey(se)] = true;
                  return { ...prev, [r.rowKey]: rowMap };
                });

                if (!wantsGenres) return;

                const ck = cacheKeyForRow(r.rowKey);
                const cached = nearbyCacheRef.current.get(ck) || nearbyByRow[r.rowKey];

                if (cached?.status === "hit") {
                  await fetchGenreMatchingForRow(r);
                  return;
                }
                if (cached?.status === "miss") return;
                if (cached?.status === "unsure") return;

                // bounded check on open (cancellable)
                openRowAbortRef.current?.abort();
                openRowAbortRef.current = new AbortController();

                const ac = openRowAbortRef.current;
                const st = await computeNearbyStateForRow(r, ac.signal);
                if (ac.signal.aborted) return;

                setAndCacheNearby(r.rowKey, st);
                if (st.status === "hit") await fetchGenreMatchingForRow(r);
              }

              const nearbyState: NearbyCheckState = nearbyByRow[r.rowKey] || { status: "idle", attempts: 0 };
              const blurred = wantsGenres && (nearbyState.status === "idle" || nearbyState.status === "checking");

              return (
                <div
                  key={r.rowKey}
                  data-rowkey={r.rowKey}
                  ref={(el) => {
                    if (el) rowElByKeyRef.current.set(r.rowKey, el);
                    else rowElByKeyRef.current.delete(r.rowKey);
                  }}
                  className={cx(
                    "overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm",
                    isOpen ? "ring-2 ring-slate-900/10" : ""
                  )}
                >
                  {/* Header click area */}
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
                      "w-full cursor-pointer select-none px-4 py-4 transition sm:px-5",
                      isOpen ? "bg-slate-900 text-white" : r.hasCrossover ? "bg-slate-200 ring-1 ring-slate-300" : "bg-white"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        {(aHasDate || aHasLoc) && (
                          <div className={cx("text-sm font-extrabold", isOpen ? "text-slate-100" : "text-slate-900")}>
                            {aHasDate ? prettyYMD(a.date) : null}
                            {aHasDate && aHasLoc ? " — " : null}
                            {aHasLoc ? a.location : null}
                          </div>
                        )}

                        <div className={cx("mt-1 truncate text-base font-semibold", isOpen ? "text-white" : "text-slate-800")}>
                          {a.name || "Untitled event"}
                        </div>

                        {!isOpen && r.hasCrossover && hasP1AndP2 && (
                          <div className="mt-2 inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                            {secondaryName} event nearby
                          </div>
                        )}

                        {!isOpen && wantsGenres && (
                          <div
                            className={cx(
                              "mt-2 flex items-center gap-2 text-[12px] font-normal",
                              isOpen ? "text-slate-100" : "text-slate-700",
                              blurred ? "blur-[2px] opacity-60" : ""
                            )}
                          >
                            <span className="leading-tight">
                              {selectedGenres.map((g, i) => (
                                <React.Fragment key={g}>
                                  <span className="font-bold italic">{g}</span>
                                  {i < selectedGenres.length - 1 && " or "}
                                </React.Fragment>
                              ))}{" "}
                              events nearby?
                            </span>

                            {nearbyState.status === "hit" ? (
                              <CheckMark />
                            ) : nearbyState.status === "miss" ? (
                              <ThumbsDown />
                            ) : nearbyState.status === "unsure" ? (
                              <ShrugIcon />
                            ) : (
                              <MiniSpinner />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="pt-0.5 flex items-center gap-2">
                        {inlineSpinner && <MiniSpinner />}
                        <ChevronDown open={isOpen} />
                      </div>
                    </div>
                  </div>

                  {/* Expanded area */}
                  {isOpen && (
                    <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
                      {wantsGenres &&
                        (nearbyState.status === "idle" ||
                          nearbyState.status === "checking" ||
                          nearbyState.status === "unsure") && (
                          <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold text-slate-700">
                            {nearbyState.status === "checking"
                              ? `Checking for nearby genre matches… (attempt ${Math.max(1, nearbyState.attempts)}/${NEARBY_MAX_ATTEMPTS})`
                              : nearbyState.status === "unsure"
                              ? "Not sure after trying twice."
                              : "Nearby genre matches haven’t been checked yet (scan is still running)."}
                          </div>
                        )}

                      {matchingErr && (
                        <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] font-semibold text-rose-800">
                          Matching events unavailable: {matchingErr}
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
                            <React.Fragment key={`${kind}:${eventKey(e)}`}>
                              <button
                                type="button"
                                onClick={() => toggleSelected(r.rowKey, e)}
                                className={cx(
                                  "w-full rounded-2xl border px-3.5 py-3 text-left transition sm:px-4",
                                  selected ? "ring-2 ring-slate-900" : "",
                                  primary
                                    ? "bg-slate-100 border-slate-200"
                                    : secondaryKind
                                    ? "bg-white border-slate-200"
                                    : "bg-white border-slate-200 hover:bg-slate-50"
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex flex-1 items-start gap-3 pr-2">
                                    <div className="pt-0.5">
                                      <CheckBoxPill selected={selected} />
                                    </div>

                                    <div className="min-w-0 flex-1">
                                      {(hasDate || hasLoc) && (
                                        <div className="text-[12px] font-bold tracking-wide text-slate-700">
                                          {hasDate ? prettyYMD(e.date) : null}
                                          {hasDate && hasLoc ? " — " : null}
                                          {hasLoc ? e.location : null}
                                        </div>
                                      )}

                                      <div className="text-sm font-extrabold text-slate-900">{e.name || "Untitled event"}</div>
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

                              {primary && wantsGenres && nearbyState.status === "miss" && (
                                <div className="mt-2 text-sm text-slate-600">
                                  No{" "}
                                  {selectedGenres.length > 0 ? (
                                    selectedGenres.map((g, i) => (
                                      <React.Fragment key={g}>
                                        <span className="font-semibold italic">{g}</span>
                                        {i < selectedGenres.length - 1 ? " or " : ""}
                                      </React.Fragment>
                                    ))
                                  ) : (
                                    <span className="font-semibold italic">selected</span>
                                  )}{" "}
                                  events found nearby.
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>

                      <div className="mt-5">
                        <button
                          type="button"
                          onClick={buildTrip}
                          className="h-12 w-full rounded-2xl bg-slate-900 text-sm font-extrabold text-white shadow-sm hover:bg-slate-800"
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
    </main>
  );
}