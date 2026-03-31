import { formatEventMeta } from "@/lib/format/dateTime";
import { isYMD } from "@/lib/date/ymd";
import {
  canonicalGenreLabel,
  genreKeyToBucket,
  resolveGenreKey,
} from "@/lib/events/genres";
import { sortGenresByPopularity } from "@/lib/events/genreOrder";
import type { TripStoredEvent } from "@/lib/trip/store";

export type NormEvent = {
  id: string;
  name: string;
  pillLabel: string | null;
  localDate: string;
  localTime: string | null;
  city: string;
  region: string | null;
  venueName: string | null;
  url: string | null;
  lat?: number | null;
  lon?: number | null;
  matched?: {
    genres?: string[];
    favorites?: string[];
    attractionIds?: string[];
  };
};

export type ApiResp = {
  mode: "area";
  city: { label: string; lat: number; lon: number };
  startDate: string;
  endDate: string;
  genres: string[];
  count: number;
  events: NormEvent[];
  error?: string;
};

export type CityOpt = {
  id?: string;
  label: string;
  lat: number;
  lon: number;
  country?: string;
  airportIata?: string;
};

export type SearchState = {
  cityLabel: string;
  lat: string;
  lon: string;
  startDate: string;
  endDate: string;
  endTouched: boolean;
  radiusMiles: number;
};

export type FilterFamily = "sports" | "music" | null;

export const DEFAULT_SEARCH: SearchState = {
  cityLabel: "",
  lat: "",
  lon: "",
  startDate: "",
  endDate: "",
  endTouched: false,
  radiusMiles: 90,
};

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function norm(s: unknown) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function eventSortValue(event: NormEvent) {
  const date = String(event.localDate || "").trim();
  const rawTime = String(event.localTime || "").trim();

  if (!isYMD(date)) return Number.MAX_SAFE_INTEGER;

  const hhmm = rawTime.match(/^(\d{2}:\d{2})/)?.[1] || "23:59";
  const ts = Date.parse(`${date}T${hhmm}:00`);

  return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
}

export function groupByDate(events: NormEvent[]) {
  const sorted = [...events].sort((a, b) => {
    const dateDiff = String(a.localDate || "").localeCompare(
      String(b.localDate || "")
    );
    if (dateDiff !== 0) return dateDiff;

    const timeDiff = eventSortValue(a) - eventSortValue(b);
    if (timeDiff !== 0) return timeDiff;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const map = new Map<string, NormEvent[]>();

  for (const event of sorted) {
    const key = event.localDate || "Unknown Date";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(event);
  }

  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export function eventToStored(event: NormEvent): TripStoredEvent {
  return {
    id: event.id,
    source: "area",
    title: event.name,
    subtitle: formatEventMeta(
      event.localDate,
      event.localTime,
      event.city,
      event.region
    ),
    primaryPill: event.pillLabel || null,
    secondaryPill: null,
    ticketHref: event.url || null,
    date: event.localDate || null,
    localTime: event.localTime || null,
    city: event.city || null,
    region: event.region || null,
    venueName: event.venueName || null,
    location: [event.city, event.region].filter(Boolean).join(", "),
    lat: event.lat ?? null,
    lon: event.lon ?? null,
  };
}

function getCanonicalGenresForEvent(event: NormEvent): string[] {
  const raw = [
    ...(Array.isArray(event?.matched?.genres) ? event.matched.genres : []),
    event.pillLabel,
  ];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const label = canonicalGenreLabel(item);
    if (!label) continue;

    const key = norm(label);
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(label);
  }

  return out;
}

export function eventMatchesGenre(event: NormEvent, genreLabel: string) {
  const targetKey = resolveGenreKey(genreLabel);
  if (!targetKey) return false;

  return getCanonicalGenresForEvent(event).some((label) => {
    const eventKey = resolveGenreKey(label);
    return eventKey === targetKey;
  });
}

export function collectAvailableGenresForFamily(
  events: NormEvent[],
  family: Exclude<FilterFamily, null>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    for (const label of getCanonicalGenresForEvent(event)) {
      const key = resolveGenreKey(label);
      if (!key) continue;
      if (genreKeyToBucket(key) !== family) continue;

      const canon = canonicalGenreLabel(label);
      if (!canon) continue;

      const n = norm(canon);
      if (seen.has(n)) continue;

      seen.add(n);
      out.push(canon);
    }
  }

  return out.sort(sortGenresByPopularity);
}