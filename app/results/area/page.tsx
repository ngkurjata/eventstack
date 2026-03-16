"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
  matched?: {
    genres?: string[];
  };
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

const LS_SELECTED = "eventstack_selected_events_v1";
const LS_LAST_AREA_QUERY = "eventstack_area_last_query_v1";

const LEAGUE_FILTERS = new Set(
  [
    "mlb",
    "milb",
    "nba",
    "wnba",
    "nfl",
    "cfl",
    "nhl",
    "ahl",
    "echl",
    "mls",
    "nwsl",
    "ufl",
    "pga",
    "lpga",
    "atp",
    "wta",
    "ncaa",
    "ncaa football",
    "ncaa basketball",
  ].map((x) => x.toLowerCase())
);

const EXCLUDED_GENERIC_FILTERS = new Set(
  [
    "music",
    "sports",
    "arts & theatre",
    "film",
    "miscellaneous",
    "undefined",
  ].map((x) => x.toLowerCase())
);

const DEFAULT_SPORT_FILTERS = [
  "Football",
  "Baseball",
  "Basketball",
  "Hockey",
  "Soccer",
];

const DEFAULT_CONCERT_FILTERS = [
  "Country",
  "Rock",
  "Pop",
  "Alternative",
  "Hip-Hop/Rap",
];

const ALWAYS_VISIBLE_DEFAULTS = [
  ...DEFAULT_SPORT_FILTERS,
  ...DEFAULT_CONCERT_FILTERS,
];

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
  } catch {}
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
  } catch {}
}

function countSelected() {
  const map = readSelectedMap();
  return Object.keys(map).length;
}

function areaQueryKey(input: {
  cityLabel: string;
  lat: number;
  lon: number;
  start: string;
  end: string;
  radiusMiles: number;
  countryCode: string;
}) {
  return [
    String(input.cityLabel || "").trim(),
    String(input.lat || ""),
    String(input.lon || ""),
    String(input.start || "").trim(),
    String(input.end || "").trim(),
    String(input.radiusMiles || ""),
    String(input.countryCode || "").trim(),
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
  } catch {}
}

function isYMD(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatDateRange(start: string, end: string) {
  if (!isYMD(start) || !isYMD(end)) return `${start || "—"} → ${end || "—"}`;

  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);

  const sMonth = s.toLocaleDateString("en-CA", { month: "short" });
  const eMonth = e.toLocaleDateString("en-CA", { month: "short" });
  const sDay = s.getDate();
  const eDay = e.getDate();
  const year = e.getFullYear();

  if (start === end) {
    return `${sMonth} ${sDay}, ${year}`;
  }

  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${sMonth} ${sDay} → ${eDay}, ${year}`;
  }

  return `${sMonth} ${sDay}, ${s.getFullYear()} → ${eMonth} ${eDay}, ${year}`;
}

function formatSectionDate(dateStr: string) {
  if (!isYMD(dateStr)) return dateStr;
  const d = new Date(`${dateStr}T12:00:00`);
  return d
    .toLocaleDateString("en-CA", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    })
    .toUpperCase();
}

function formatTime12h(time: string | null) {
  if (!time) return "";

  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h)) return time;

  const date = new Date();
  date.setHours(h);
  date.setMinutes(m || 0);

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function groupByDate(events: NormEvent[]) {
  const map = new Map<string, NormEvent[]>();
  for (const event of events) {
    const key = event.localDate || "Unknown Date";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(event);
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function normalizeGenreKey(value: string) {
  return String(value || "").trim().toLowerCase();
}

function isLeagueOrGeneric(value: string) {
  const key = normalizeGenreKey(value);
  return LEAGUE_FILTERS.has(key) || EXCLUDED_GENERIC_FILTERS.has(key);
}

function classifyFilterGroup(value: string): "sports" | "concerts" | "other" {
  const key = normalizeGenreKey(value);

  if (DEFAULT_SPORT_FILTERS.some((x) => normalizeGenreKey(x) === key)) return "sports";
  if (DEFAULT_CONCERT_FILTERS.some((x) => normalizeGenreKey(x) === key)) return "concerts";

  return "other";
}

function getEventFilterLabels(e: NormEvent): string[] {
  const raw = Array.isArray(e?.matched?.genres) ? e.matched!.genres! : [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of raw) {
    const val = String(item || "").trim();
    if (!val) continue;
    if (isLeagueOrGeneric(val)) continue;

    const key = normalizeGenreKey(val);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(val);
  }

  if (out.length > 0) return out;

  const fallback = String(e.pillLabel || "").trim();
  if (fallback && !isLeagueOrGeneric(fallback)) return [fallback];

  return [];
}

function pickDisplayPill(e: NormEvent, hiddenGenreKeys: Set<string>): string | null {
  const labels = getEventFilterLabels(e);

  for (const label of labels) {
    if (!hiddenGenreKeys.has(normalizeGenreKey(label))) {
      return label;
    }
  }

  return labels[0] || null;
}

function sortAlpha(filters: string[]) {
  return [...filters].sort((a, b) => a.localeCompare(b));
}

function dedupeGenreList(filters: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const f of filters) {
    const val = String(f || "").trim();
    if (!val) continue;
    const key = normalizeGenreKey(val);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(val);
  }

  return out;
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
  const airportIata = (sp.get("airportIata") || "").trim().toUpperCase();

  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [hiddenGenres, setHiddenGenres] = useState<string[]>([]);
  const [dismissedEventIds, setDismissedEventIds] = useState<string[]>([]);
  const [lastDismissed, setLastDismissed] = useState<NormEvent | null>(null);

  useEffect(() => {
    const key = areaQueryKey({
      cityLabel,
      lat,
      lon,
      start,
      end,
      radiusMiles,
      countryCode,
    });

    const last = readLastAreaQueryKey();

    if (last && last !== key) {
      clearSelected();
    }

    writeLastAreaQueryKey(key);
    setSelectedCount(countSelected());
    setDismissedEventIds([]);
    setLastDismissed(null);
    setHiddenGenres([]);
  }, [cityLabel, lat, lon, start, end, radiusMiles, countryCode]);

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
  }, [cityLabel, lat, lon, start, end, radiusMiles, countryCode]);

  useEffect(() => {
    if (!lastDismissed) return;

    const t = window.setTimeout(() => {
      setLastDismissed(null);
    }, 5000);

    return () => window.clearTimeout(t);
  }, [lastDismissed]);

  const allEvents = resp?.events || [];

  const availableGenres = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const e of allEvents) {
      for (const label of getEventFilterLabels(e)) {
        const key = normalizeGenreKey(label);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(label);
      }
    }

    return sortAlpha(out);
  }, [allEvents]);

  const availableGenreKeys = useMemo(
    () => new Set(availableGenres.map((g) => normalizeGenreKey(g))),
    [availableGenres]
  );

  const filterSections = useMemo(() => {
    const defaultSports = [...DEFAULT_SPORT_FILTERS];
    const defaultConcerts = [...DEFAULT_CONCERT_FILTERS];

    const extraSports: string[] = [];
    const extraConcerts: string[] = [];
    const other: string[] = [];

    const defaultKeys = new Set(ALWAYS_VISIBLE_DEFAULTS.map((x) => normalizeGenreKey(x)));

    for (const genre of availableGenres) {
      const key = normalizeGenreKey(genre);
      if (defaultKeys.has(key)) continue;

      const group = classifyFilterGroup(genre);

      if (group === "sports") extraSports.push(genre);
      else if (group === "concerts") extraConcerts.push(genre);
      else other.push(genre);
    }

    return {
      defaultSports,
      defaultConcerts,
      extraSports: sortAlpha(dedupeGenreList(extraSports)),
      extraConcerts: sortAlpha(dedupeGenreList(extraConcerts)),
      other: sortAlpha(dedupeGenreList(other)),
    };
  }, [availableGenres]);

  useEffect(() => {
    if (loading || err) return;

    const defaultVisibleKeys = new Set(
      ALWAYS_VISIBLE_DEFAULTS.map((g) => normalizeGenreKey(g))
    );

    const defaultHidden = availableGenres.filter(
      (g) => !defaultVisibleKeys.has(normalizeGenreKey(g))
    );

    setHiddenGenres(defaultHidden);
  }, [loading, err, availableGenres, cityLabel, lat, lon, start, end, radiusMiles, countryCode]);

  const hiddenGenreKeys = useMemo(
    () => new Set(hiddenGenres.map((g) => normalizeGenreKey(g))),
    [hiddenGenres]
  );

  const dismissedEventKeySet = useMemo(() => new Set(dismissedEventIds), [dismissedEventIds]);

  const visibleEvents = useMemo(() => {
    return allEvents.filter((e) => {
      if (dismissedEventKeySet.has(e.id)) return false;

      const labels = getEventFilterLabels(e);
      if (labels.length === 0) return false;
      if (!e.url) return false;

      return labels.some((label) => !hiddenGenreKeys.has(normalizeGenreKey(label)));
    });
  }, [allEvents, hiddenGenreKeys, dismissedEventKeySet]);

  const groupedEvents = useMemo(() => groupByDate(visibleEvents), [visibleEvents]);

  const titleCity = resp?.city?.label || cityLabel || "Area Results";
  const subtitleRange = formatDateRange(start, end);

  const visiblePills = useMemo(() => {
    const set = new Set<string>();
    for (const e of visibleEvents) {
      const pill = pickDisplayPill(e, hiddenGenreKeys);
      if (pill) set.add(pill);
    }
    return Array.from(set);
  }, [visibleEvents, hiddenGenreKeys]);

  const eventPillMinWidth = useMemo(() => {
    const labels = visiblePills.length > 0 ? visiblePills : ["Hip-Hop/Rap"];
    const maxLen = labels.reduce((max, label) => Math.max(max, label.length), 0);
    return Math.max(92, Math.min(168, Math.ceil(maxLen * 8.5 + 22)));
  }, [visiblePills]);

  function onToggleEvent(e: NormEvent) {
    const nextCount = toggleSelected(e.id);
    setSelectedCount(nextCount);
  }

  function onToggleGenre(genre: string) {
    const key = normalizeGenreKey(genre);

    if (!availableGenreKeys.has(key)) return;

    setHiddenGenres((prev) => {
      const exists = prev.some((g) => normalizeGenreKey(g) === key);
      return exists
        ? prev.filter((g) => normalizeGenreKey(g) !== key)
        : [...prev, genre];
    });
  }

  function onDismissEvent(event: NormEvent) {
    setDismissedEventIds((prev) => (prev.includes(event.id) ? prev : [...prev, event.id]));
    setLastDismissed(event);
  }

  function onUndoDismiss() {
    if (!lastDismissed) return;

    setDismissedEventIds((prev) => prev.filter((id) => id !== lastDismissed.id));
    setLastDismissed(null);
  }

  function onBuildTrip() {
    const q = new URLSearchParams();
    q.set("tripStyle", "A");
    q.set("destIata", airportIata);
    q.set("start", start);
    q.set("end", end);
    q.set("radiusMiles", String(radiusMiles));
    q.set("countryCode", countryCode);
    q.set("resetSel", "1");

    router.push(`/build-trip?${q.toString()}`);
  }

  const canBuild =
    selectedCount > 0 &&
    airportIata.length === 3 &&
    /^\d{4}-\d{2}-\d{2}$/.test(start) &&
    /^\d{4}-\d{2}-\d{2}$/.test(end);

  function renderFilterButtons(filters: string[], options?: { disableIfUnavailable?: boolean }) {
    if (filters.length === 0) return null;

    const disableIfUnavailable = !!options?.disableIfUnavailable;

    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {filters.map((genre) => {
          const key = normalizeGenreKey(genre);
          const isAvailable = availableGenreKeys.has(key);
          const disabled = disableIfUnavailable && !isAvailable;
          const off = hiddenGenreKeys.has(key);

          return (
            <button
              key={genre}
              type="button"
              disabled={disabled}
              onClick={() => onToggleGenre(genre)}
              style={{
                minHeight: 36,
                padding: "0 14px",
                borderRadius: 999,
                border: disabled ? "1px solid #c8d0db" : "1px solid #111",
                background: disabled ? "#e5e7eb" : off ? "#fff" : "#111",
                color: disabled ? "#8a94a6" : off ? "#111" : "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: disabled ? "not-allowed" : "pointer",
                lineHeight: 1.1,
                whiteSpace: "nowrap",
              }}
            >
              {genre}
            </button>
          );
        })}
      </div>
    );
  }

  function renderFilterSection(
    title: string,
    primaryFilters: string[],
    secondaryFilters: string[] = [],
    marginTop = 0
  ) {
    if (primaryFilters.length === 0 && secondaryFilters.length === 0) return null;

    return (
      <div style={{ marginTop }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            color: "#536b8f",
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: 0.3,
          }}
        >
          {title}
        </div>

        {renderFilterButtons(primaryFilters, { disableIfUnavailable: true })}

        {secondaryFilters.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {renderFilterButtons(secondaryFilters, { disableIfUnavailable: false })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fb", fontFamily: "system-ui" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "14px 10px 96px" }}>
        <div style={{ paddingBottom: 14, borderBottom: "1px solid #d9e0ea", marginBottom: 14 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#0d2244" }}>{titleCity}</div>

          <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700, color: "#17315f" }}>
            {subtitleRange}
          </div>
        </div>

        {!loading && !err && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 12px 10px",
              background: "#ffffff",
              border: "1px solid #d9e0ea",
              borderRadius: 18,
            }}
          >
            {renderFilterSection(
              "Sports",
              filterSections.defaultSports,
              filterSections.extraSports,
              0
            )}

            {renderFilterSection(
              "Concerts",
              filterSections.defaultConcerts,
              filterSections.extraConcerts,
              12
            )}

            {renderFilterSection("Other Event Types Available Here", filterSections.other, [], 12)}
          </div>
        )}

        {loading && <div>Loading…</div>}
        {err && <div style={{ color: "crimson" }}>{err}</div>}

        {!loading && !err && groupedEvents.length === 0 && (
          <div
            style={{
              background: "#fff",
              border: "1px solid #d9e0ea",
              borderRadius: 18,
              padding: "16px 14px",
              color: "#536b8f",
              fontWeight: 700,
            }}
          >
            No events match the current filters.
          </div>
        )}

        {!loading &&
          !err &&
          groupedEvents.map(([date, items]) => (
            <div key={date} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#536b8f", marginBottom: 10 }}>
                {formatSectionDate(date)}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {items.map((e) => {
                  const checked = isSelected(e.id);
                  const pill = pickDisplayPill(e, hiddenGenreKeys);

                  return (
                    <label
                      key={e.id}
                      style={{
                        display: "block",
                        background: "#fff",
                        border: "1px solid #d9e0ea",
                        borderRadius: 18,
                        padding: "12px 12px",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleEvent(e)}
                          style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
                        />

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 16,
                                fontWeight: 800,
                                color: "#071b3b",
                                minWidth: 0,
                                flex: 1,
                                lineHeight: 1.2,
                                paddingRight: 2,
                                wordBreak: "break-word",
                              }}
                            >
                              {e.name}
                            </div>

                            <button
                              type="button"
                              aria-label="Hide event"
                              onClick={(evt) => {
                                evt.preventDefault();
                                evt.stopPropagation();
                                onDismissEvent(e);
                              }}
                              style={{
                                flexShrink: 0,
                                width: 26,
                                height: 26,
                                borderRadius: 999,
                                border: "1px solid #d9e0ea",
                                background: "#fff",
                                color: "#5e7597",
                                fontSize: 16,
                                fontWeight: 700,
                                cursor: "pointer",
                                lineHeight: 1,
                              }}
                            >
                              ×
                            </button>
                          </div>

                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 14,
                              color: "#5e7597",
                              lineHeight: 1.3,
                              wordBreak: "break-word",
                            }}
                          >
                            {e.city}
                            {e.region ? `, ${e.region}` : ""}
                            {e.localTime ? ` • ${formatTime12h(e.localTime)}` : ""}
                          </div>

                          <div
                            style={{
                              marginTop: 10,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              flexWrap: "wrap",
                            }}
                          >
                            <div
                              style={{
                                flex: "0 0 auto",
                                minWidth: pill ? eventPillMinWidth : 0,
                                maxWidth: "100%",
                              }}
                            >
                              {pill ? (
                                <div
                                  style={{
                                    minHeight: 32,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: "100%",
                                    boxSizing: "border-box",
                                    fontSize: 12,
                                    fontWeight: 700,
                                    padding: "4px 10px",
                                    borderRadius: 999,
                                    background: "#111",
                                    color: "#fff",
                                    textAlign: "center",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {pill}
                                </div>
                              ) : null}
                            </div>

                            <div
                              style={{
                                marginLeft: "auto",
                                flex: "0 0 auto",
                              }}
                            >
                              {e.url ? (
                                <button
                                  type="button"
                                  onClick={(evt) => {
                                    evt.preventDefault();
                                    evt.stopPropagation();
                                    window.open(e.url || "", "_blank", "noopener,noreferrer");
                                  }}
                                  style={{
                                    minHeight: 32,
                                    padding: "0 12px",
                                    borderRadius: 999,
                                    border: "1px solid #17315f",
                                    background: "#17315f",
                                    color: "#fff",
                                    fontSize: 13,
                                    fontWeight: 800,
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  Tickets
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
      </div>

      {lastDismissed && (
        <div
          style={{
            position: "sticky",
            bottom: 68,
            zIndex: 20,
            padding: "0 12px 10px",
          }}
        >
          <div
            style={{
              maxWidth: 860,
              margin: "0 auto",
              background: "#071b3b",
              color: "#fff",
              borderRadius: 14,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              boxShadow: "0 8px 22px rgba(7,27,59,0.22)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Event hidden: {lastDismissed.name}
            </div>

            <button
              type="button"
              onClick={onUndoDismiss}
              style={{
                flexShrink: 0,
                height: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.35)",
                background: "#fff",
                color: "#071b3b",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Undo
            </button>
          </div>
        </div>
      )}

      <div style={{ position: "sticky", bottom: 0, padding: 12, background: "#f5f7fb" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <button
            onClick={onBuildTrip}
            disabled={!canBuild}
            style={{
              width: "100%",
              height: 44,
              borderRadius: 16,
              border: "none",
              background: "#07173a",
              color: "#fff",
              fontSize: 16,
              fontWeight: 800,
              opacity: canBuild ? 1 : 0.45,
            }}
          >
            Build trip {selectedCount > 0 ? `(${selectedCount})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}