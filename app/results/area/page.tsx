"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { csvToList } from "@/lib/url";

type NormEvent = {
  id: string;
  name: string;
  pillLabel: string | null;
  localDate: string;
  localTime: string | null;
  city: string;
  region: string | null;
  venueName: string | null;
  url: string | null;
};

type ApiResp = {
  mode: "area";
  city: { label: string; lat: number; lon: number };
  startDate: string;
  endDate: string;
  genres: string[];
  count: number;
  events: NormEvent[];
  error?: string;
};

// MUST match build-trip/page.tsx
const LS_SELECTED = "eventstack_selected_events_v1";

// Remember the last area-search signature so we can clear selection when a NEW search starts
const LS_LAST_AREA_QUERY = "eventstack_area_last_query_v1";

function readSelectedMap(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_SELECTED);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeSelectedMap(map: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_SELECTED, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function isSelected(id: string) {
  const map = readSelectedMap();
  return !!map[id];
}

function toggleSelected(id: string) {
  const map = readSelectedMap();
  map[id] = !map[id];
  if (!map[id]) delete map[id];
  writeSelectedMap(map);
  return Object.keys(map).length;
}

function clearSelected() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LS_SELECTED);
  } catch {
    // ignore
  }
}

function countSelected() {
  const map = readSelectedMap();
  return Object.keys(map).length;
}

// ---- B) Area search signature helpers (paste right here) ----

function areaQueryKey(input: {
  cityLabel: string;
  lat: number;
  lon: number;
  start: string;
  end: string;
  radiusMiles: number;
  countryCode: string;
  genres: string[];
}) {
  const g = [...(input.genres || [])].map(String).map((s) => s.trim()).filter(Boolean).sort().join(",");
  return [
    String(input.cityLabel || "").trim(),
    String(input.lat || ""),
    String(input.lon || ""),
    String(input.start || "").trim(),
    String(input.end || "").trim(),
    String(input.radiusMiles || ""),
    String(input.countryCode || "").trim(),
    g,
  ].join("|");
}

function readLastAreaQueryKey() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(LS_LAST_AREA_QUERY) || "";
  } catch {
    return "";
  }
}

function writeLastAreaQueryKey(key: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_LAST_AREA_QUERY, key);
  } catch {
    // ignore
  }
}

export default function AreaResultsPage() {
  const sp = useSearchParams();
  const router = useRouter();

  const cityLabel = sp.get("cityLabel") || "";
  const lat = Number(sp.get("lat") || "");
  const lon = Number(sp.get("lon") || "");
  const start = (sp.get("start") || "").trim();
  const end = (sp.get("end") || "").trim();
  const radiusMiles = Number(sp.get("radiusMiles") || "90");
  const countryCode = sp.get("countryCode") || "US,CA";
  const genres = csvToList(sp.get("genres"));

  // ✅ REQUIRED by build-trip: destIata
  // Make sure results/area URL includes airportIata=XXX
  const airportIata = (sp.get("airportIata") || "").trim().toUpperCase();

  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
  // Build a signature for this specific search
  const key = areaQueryKey({
    cityLabel,
    lat,
    lon,
    start,
    end,
    radiusMiles,
    countryCode,
    genres,
  });

  const last = readLastAreaQueryKey();

  // If the search changed, wipe previous selections
  if (last && last !== key) {
    clearSelected();
  }

  // Remember this search
  writeLastAreaQueryKey(key);

  // Update UI count
  setSelectedCount(countSelected());

}, [cityLabel, lat, lon, start, end, radiusMiles, countryCode, genres]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);

      try {
        const r = await fetch("/api/search/area", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            city: { label: cityLabel, lat, lon },
            startDate: start,
            endDate: end,
            genres,
            radiusMiles,
            countryCode,
          }),
        });

        const j = (await r.json()) as ApiResp;
        if (!r.ok) throw new Error((j as any)?.error || "Failed");

        if (!cancelled) setResp(j);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [cityLabel, lat, lon, start, end, radiusMiles, countryCode, sp]);

  const events = resp?.events || [];

  const header = useMemo(() => {
    const g = genres.length ? genres.join(", ") : "All";
    const c = cityLabel || "Unknown city";
    const s = start || "—";
    const e = end || "—";
    const a = airportIata ? ` • dest ${airportIata}` : "";
    return `${c} • ${s} → ${e} • ${g} • radius ${radiusMiles}mi${a}`;
  }, [cityLabel, start, end, genres, radiusMiles, airportIata]);

  function onToggle(e: NormEvent) {
    const nextCount = toggleSelected(e.id);
    setSelectedCount(nextCount);
  }

  function onClear() {
    clearSelected();
    setSelectedCount(0);
  }

  function onBuildTrip() {
  // ✅ Match build-trip’s contract: destIata + start/end (+ optional radius/country)
  const q = new URLSearchParams();
  q.set("tripStyle", "A");
  q.set("destIata", airportIata);
  q.set("start", start);
  q.set("end", end);
  q.set("radiusMiles", String(radiusMiles));
  q.set("countryCode", countryCode);

  // NEW: tell build-trip to consume the selection and then clear it
  q.set("resetSel", "1");

  router.push(`/build-trip?${q.toString()}`);
}

  const canBuild =
    selectedCount > 0 &&
    airportIata.length === 3 &&
    /^\d{4}-\d{2}-\d{2}$/.test(start) &&
    /^\d{4}-\d{2}-\d{2}$/.test(end);

  return (
    <div
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: 24,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Area Results</h1>
          <div style={{ opacity: 0.75, marginTop: 6 }}>{header}</div>
          {!airportIata && (
            <div style={{ marginTop: 6, color: "crimson", fontSize: 12 }}>
              Missing airportIata in URL. Add <code>airportIata=XXX</code> so Build Trip has a destination.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Selected: <b>{selectedCount}</b>
          </div>

          <button onClick={onClear} style={{ padding: "10px 12px" }}>
            Clear
          </button>

          <button
            onClick={onBuildTrip}
            disabled={!canBuild}
            style={{
              padding: "10px 12px",
              background: "#111",
              color: "#fff",
              borderRadius: 10,
              opacity: canBuild ? 1 : 0.5,
              cursor: canBuild ? "pointer" : "not-allowed",
              border: "none",
            }}
            title={!canBuild ? "Need destIata (airportIata), valid dates, and at least 1 selected event" : "Build Trip"}
          >
            Build Trip
          </button>
        </div>
      </div>

      {loading && <div style={{ marginTop: 16 }}>Loading…</div>}
      {err && <div style={{ marginTop: 16, color: "crimson" }}>{err}</div>}

      {!loading && !err && (
        <div style={{ marginTop: 16 }}>
          <div style={{ opacity: 0.8, marginBottom: 10 }}>
            Showing <b>{events.length}</b> deduped events.
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {events.map((e) => {
              const checked = isSelected(e.id);

              return (
                <div key={e.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 700 }}>{e.name}</div>

                        {e.pillLabel ? (
                          <span
                            style={{
                              fontSize: 12,
                              lineHeight: "18px",
                              padding: "2px 8px",
                              borderRadius: 999,
                              border: "1px solid #e5e5e5",
                              background: "#fafafa",
                              opacity: 0.9,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {e.pillLabel}
                          </span>
                        ) : null}
                      </div>

                      <div style={{ opacity: 0.75, marginTop: 4 }}>
                        {e.localDate}
                        {e.localTime ? ` • ${e.localTime}` : ""} • {e.city}
                        {e.region ? `, ${e.region}` : ""} • {e.venueName || "Venue"}
                      </div>

                      {e.url && (
                        <div style={{ marginTop: 6 }}>
                          <a href={e.url} target="_blank" rel="noreferrer">
                            Tickets
                          </a>
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="checkbox" checked={checked} onChange={() => onToggle(e)} />
                        Add
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {events.length === 0 && <div style={{ marginTop: 16, opacity: 0.7 }}>No events found.</div>}
        </div>
      )}
    </div>
  );
}