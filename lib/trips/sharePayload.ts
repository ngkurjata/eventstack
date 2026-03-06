// FILE: lib/trips/sharePayload.ts

export type RowEvent = {
  date?: string | null; // YYYY-MM-DD
  name?: string;
  location?: string; // "City, ST"
  genre?: string | null;
  url?: string | null;
  lat?: number | null;
  lon?: number | null;
  localTime?: string | null; // optional
};

export type BuildTripPayload = {
  rowKey?: string;
  tripStyle?: string;

  destIata?: string;
  cityState?: string;

  startYMD?: string | null;
  endYMD?: string | null;

  radiusMiles?: number;
  countryCode?: string;

  airport?: string; // origin IATA
  anchor?: RowEvent;
  events?: RowEvent[];
};

export function encodeBuildTripDataParam(payload: BuildTripPayload) {
  // This matches app/share/page.tsx behavior: /build-trip?data=<encodeURIComponent(JSON.stringify(payload))>
  return encodeURIComponent(JSON.stringify(payload));
}

export function isYMD(s: any): s is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

export function normalizeLocation(city?: string | null, region?: string | null) {
  const c = String(city || "").trim();
  const r = String(region || "").trim();
  if (!c && !r) return "";
  return [c, r].filter(Boolean).join(", ");
}

export function eventKey(e: RowEvent) {
  return [
    String(e.date || ""),
    String(e.location || ""),
    String(e.name || ""),
    String(e.url || ""),
  ].join("|");
}

export function groupByDate(events: RowEvent[]) {
  const map = new Map<string, RowEvent[]>();
  for (const e of events) {
    const d = String(e.date || "").trim() || "TBD";
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(e);
  }
  // Sort dates (YMD asc), keep "TBD" last
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === "TBD") return 1;
    if (b === "TBD") return -1;
    return a.localeCompare(b);
  });
  return keys.map((k) => ({ date: k, events: map.get(k)! }));
}

export function fmtYMDPretty(ymd?: string | null) {
  if (!ymd || !isYMD(ymd)) return ymd || "—";
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(dt);
}

/**
 * Best-effort normalization for /api/trip/context responses:
 * Accepts multiple possible field names, since we don't have the exact schema here.
 */
export function coerceTripContextResponse(json: any): {
  anchor?: RowEvent | null;
  events: RowEvent[];
} {
  const root = json && typeof json === "object" ? json : {};
  const payload = (root.payload && typeof root.payload === "object") ? root.payload : root;

  const rawAnchor = payload.anchor || payload.anchorEvent || payload.anchor_event || null;
  const rawEvents =
    payload.events ||
    payload.nearbyEvents ||
    payload.nearby ||
    payload.items ||
    payload.results ||
    [];

  const anchor = coerceRowEvent(rawAnchor);
  const events = Array.isArray(rawEvents) ? rawEvents.map(coerceRowEvent).filter(Boolean) as RowEvent[] : [];

  return { anchor, events };
}

function coerceRowEvent(raw: any): RowEvent | null {
  if (!raw || typeof raw !== "object") return null;

  const date =
    raw.date ??
    raw.localDate ??
    raw.local_date ??
    raw.startDate ??
    raw.start_date ??
    null;

  const city = raw.city ?? raw._city ?? null;
  const region = raw.region ?? raw.state ?? raw.province ?? null;

  const location =
    raw.location ??
    raw.cityState ??
    raw.city_state ??
    (city || region ? normalizeLocation(city, region) : null);

  const lat = numOrNull(raw.lat ?? raw.latitude);
  const lon = numOrNull(raw.lon ?? raw.lng ?? raw.longitude);

  const localTime = raw.localTime ?? raw.local_time ?? raw.time ?? null;

  const name = raw.name ?? raw.title ?? raw.eventName ?? raw.event_name ?? "Untitled event";
  const url = raw.url ?? raw.eventUrl ?? raw.event_url ?? null;
  const genre = raw.genre ?? raw.pillLabel ?? raw.classificationName ?? null;

  return {
    date: typeof date === "string" ? date : null,
    name: String(name || "Untitled event"),
    location: location ? String(location) : "",
    genre: genre ? String(genre) : null,
    url: url ? String(url) : null,
    lat,
    lon,
    localTime: localTime ? String(localTime) : null,
  };
}

function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}