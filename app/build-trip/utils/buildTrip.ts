import type { TripStoredEvent } from "@/lib/trip/store";

export type BuildTripMapEvent = {
  id: string;
  title: string;
  date?: string | null;
  localTime?: string | null;
  city?: string | null;
  region?: string | null;
  venueName?: string | null;
  lat: number;
  lon: number;
  orderLabel: string;
};

export function isYMD(value: string | null | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function addDaysYMD(ymd: string, delta: number) {
  if (!isYMD(ymd)) return "";

  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + delta);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

export function formatRangeDate(dateStr: string) {
  if (!isYMD(dateStr)) return dateStr || "";

  const d = new Date(`${dateStr}T12:00:00}`);
  if (Number.isNaN(d.getTime())) return dateStr || "";

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function eventSortValue(event: TripStoredEvent) {
  const date = String(event.date || "").trim();
  const rawTime = String(event.localTime || "").trim();

  if (!isYMD(date)) return Number.MAX_SAFE_INTEGER;

  const hhmm = rawTime.match(/^(\d{2}:\d{2})/)?.[1] || "23:59";
  const ts = Date.parse(`${date}T${hhmm}:00`);

  return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
}

export function sortEvents(events: TripStoredEvent[]) {
  return [...events].sort((a, b) => {
    const dateDiff = String(a.date || "9999-99-99").localeCompare(
      String(b.date || "9999-99-99")
    );
    if (dateDiff !== 0) return dateDiff;

    const timeDiff = eventSortValue(a) - eventSortValue(b);
    if (timeDiff !== 0) return timeDiff;

    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export function groupByDate(events: TripStoredEvent[]) {
  const sorted = sortEvents(events);

  const map = new Map<string, TripStoredEvent[]>();
  for (const event of sorted) {
    const key = event.date || "TBD";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(event);
  }

  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export function maybeStorageKey(tripId: string) {
  return `eventstack_trip_maybe_v1:${tripId}`;
}

export function readMaybeIds(tripId: string): string[] {
  if (typeof window === "undefined" || !tripId) return [];

  try {
    const raw = window.localStorage.getItem(maybeStorageKey(tripId));
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((v) => String(v || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function writeMaybeIds(tripId: string, ids: string[]) {
  if (typeof window === "undefined" || !tripId) return;

  try {
    window.localStorage.setItem(
      maybeStorageKey(tripId),
      JSON.stringify(Array.from(new Set(ids)))
    );
  } catch {
    // ignore storage failures
  }
}

export function hasCoords(event: TripStoredEvent) {
  return (
    Number.isFinite(Number(event.lat)) && Number.isFinite(Number(event.lon))
  );
}

export function buildTripDateRange(
  events: TripStoredEvent[],
  maybeIdSet: Set<string>
) {
  const confirmed = events
    .filter((event) => !maybeIdSet.has(event.id))
    .map((event) => event.date)
    .filter((d): d is string => isYMD(d));

  if (confirmed.length === 0) return null;

  const sorted = [...confirmed].sort();
  return {
    start: sorted[0],
    end: sorted[sorted.length - 1],
  };
}

export function buildConfirmedMapEvents(
  events: TripStoredEvent[],
  maybeIdSet: Set<string>
): BuildTripMapEvent[] {
  const confirmed = events
    .filter((event) => !maybeIdSet.has(event.id))
    .filter(hasCoords)
    .sort((a, b) => {
      const timeDiff = eventSortValue(a) - eventSortValue(b);
      if (timeDiff !== 0) return timeDiff;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });

  return confirmed.map((event, index) => ({
    id: event.id,
    title: event.title,
    date: event.date,
    localTime: event.localTime,
    city: event.city,
    region: event.region,
    venueName: event.venueName,
    lat: Number(event.lat),
    lon: Number(event.lon),
    orderLabel: String(index + 1),
  }));
}

export function buildOrderById(
  confirmedMapEvents: BuildTripMapEvent[]
): Map<string, string> {
  const map = new Map<string, string>();

  confirmedMapEvents.forEach((event) => {
    map.set(event.id, event.orderLabel);
  });

  return map;
}