import { formatEventMeta } from "@/lib/format/dateTime";
import {
  eventKey,
  normalizeLocation,
  type BuildTripPayload,
  type RowEvent,
} from "@/lib/trips/sharePayload";

export type TripMeta = {
  name: string;
  createdAt?: number;
  updatedAt?: number;
};

export type TripStoredEvent = {
  id: string;
  source: "area" | "favorites";
  title: string;
  subtitle: string;
  primaryPill?: string | null;
  secondaryPill?: string | null;
  ticketHref?: string | null;
  date?: string | null;
  localTime?: string | null;
  city?: string | null;
  region?: string | null;
  venueName?: string | null;
  location?: string | null;
  lat?: number | null;
  lon?: number | null;
};

type RecentTripEntry = {
  tripId: string;
  name: string;
  updatedAt: number;
};

const PREFIX_SELECTED = "eventstack_selected_events_v1__";
const PREFIX_DELETED = "eventstack_deleted_events_v1__";
const PREFIX_META = "eventstack_trip_meta_v1__";
const PREFIX_EVENTS = "eventstack_trip_events_v1__";
const PREFIX_SHARE_ID = "eventstack_trip_share_id_v1__";
const PREFIX_SHARE_TO_TRIP = "eventstack_share_to_trip_v1__";
const RECENT_TRIPS_KEY = "eventstack_recent_trips_v1";

export function makeTripId() {
  return crypto.randomUUID();
}

export function selectedKey(tripId: string) {
  return `${PREFIX_SELECTED}${tripId}`;
}

export function deletedKey(tripId: string) {
  return `${PREFIX_DELETED}${tripId}`;
}

export function metaKey(tripId: string) {
  return `${PREFIX_META}${tripId}`;
}

export function eventsKey(tripId: string) {
  return `${PREFIX_EVENTS}${tripId}`;
}

export function shareIdKey(tripId: string) {
  return `${PREFIX_SHARE_ID}${tripId}`;
}

export function shareToTripKey(shareId: string) {
  return `${PREFIX_SHARE_TO_TRIP}${shareId}`;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readRecentTripsIndex(): RecentTripEntry[] {
  if (!canUseStorage()) return [];
  return safeJsonParse<RecentTripEntry[]>(
    localStorage.getItem(RECENT_TRIPS_KEY),
    []
  );
}

function writeRecentTripsIndex(items: RecentTripEntry[]) {
  if (!canUseStorage()) return;
  localStorage.setItem(RECENT_TRIPS_KEY, JSON.stringify(items));
}

function upsertRecentTrip(tripId: string, name: string, updatedAt: number) {
  const current = readRecentTripsIndex().filter((x) => x.tripId !== tripId);
  current.unshift({ tripId, name, updatedAt });
  writeRecentTripsIndex(current.slice(0, 25));
}

export function saveTripMeta(tripId: string, name: string) {
  if (!canUseStorage()) return;

  const now = Date.now();
  const existing = readTripMeta(tripId);

  const meta: TripMeta = {
    name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  localStorage.setItem(metaKey(tripId), JSON.stringify(meta));
  upsertRecentTrip(tripId, name, now);
}

export function readTripMeta(tripId: string): TripMeta | null {
  if (!canUseStorage()) return null;
  return safeJsonParse<TripMeta | null>(
    localStorage.getItem(metaKey(tripId)),
    null
  );
}

export function loadTripMeta(tripId: string): TripMeta | null {
  return readTripMeta(tripId);
}

export function touchTrip(tripId: string) {
  if (!canUseStorage()) return;

  const meta = readTripMeta(tripId);
  if (!meta?.name) return;

  const now = Date.now();
  const nextMeta: TripMeta = {
    ...meta,
    createdAt: meta.createdAt ?? now,
    updatedAt: now,
  };

  localStorage.setItem(metaKey(tripId), JSON.stringify(nextMeta));
  upsertRecentTrip(tripId, nextMeta.name, now);
}

export function listRecentTrips(limit = 5): RecentTripEntry[] {
  if (!canUseStorage()) return [];

  const index = readRecentTripsIndex();

  const hydrated = index
    .map((item) => {
      const meta = readTripMeta(item.tripId);
      if (!meta?.name) return null;

      return {
        tripId: item.tripId,
        name: meta.name,
        updatedAt: meta.updatedAt ?? item.updatedAt ?? 0,
      };
    })
    .filter((item): item is RecentTripEntry => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return hydrated.slice(0, limit);
}

export function readSelected(tripId: string): TripStoredEvent[] {
  if (!canUseStorage()) return [];
  return safeJsonParse<TripStoredEvent[]>(
    localStorage.getItem(selectedKey(tripId)),
    []
  );
}

export function listStoredEvents(tripId: string): TripStoredEvent[] {
  return readSelected(tripId);
}

function writeSelected(tripId: string, events: TripStoredEvent[]) {
  if (!canUseStorage()) return;
  localStorage.setItem(selectedKey(tripId), JSON.stringify(events));
  localStorage.setItem(eventsKey(tripId), JSON.stringify(events));
}

export function replaceSelected(tripId: string, events: TripStoredEvent[]) {
  writeSelected(tripId, events);

  const meta = readTripMeta(tripId);
  if (meta?.name) {
    saveTripMeta(tripId, meta.name);
  }
}

export function toggleTripEvent(tripId: string, event: TripStoredEvent) {
  const current = readSelected(tripId);
  const exists = current.some((e) => e.id === event.id);

  const next = exists
    ? current.filter((e) => e.id !== event.id)
    : [...current, event];

  writeSelected(tripId, next);

  const meta = readTripMeta(tripId);
  if (meta?.name) {
    saveTripMeta(tripId, meta.name);
  }

  return {
    added: !exists,
    events: next,
  };
}

export function removeStoredEvent(tripId: string, eventId: string) {
  const current = readSelected(tripId);
  const next = current.filter((e) => e.id !== eventId);
  writeSelected(tripId, next);

  const meta = readTripMeta(tripId);
  if (meta?.name) {
    saveTripMeta(tripId, meta.name);
  }

  return next;
}

export function removeSelected(tripId: string) {
  if (!canUseStorage()) return;
  localStorage.removeItem(selectedKey(tripId));
  localStorage.removeItem(eventsKey(tripId));

  const meta = readTripMeta(tripId);
  if (meta?.name) {
    saveTripMeta(tripId, meta.name);
  }
}

export function readStoredEvents(tripId: string): TripStoredEvent[] {
  if (!canUseStorage()) return [];
  return safeJsonParse<TripStoredEvent[]>(
    localStorage.getItem(eventsKey(tripId)),
    []
  );
}

export function saveStoredEvents(tripId: string, events: TripStoredEvent[]) {
  if (!canUseStorage()) return;
  localStorage.setItem(eventsKey(tripId), JSON.stringify(events));
  localStorage.setItem(selectedKey(tripId), JSON.stringify(events));

  const meta = readTripMeta(tripId);
  if (meta?.name) {
    saveTripMeta(tripId, meta.name);
  }
}

export function deleteTrip(tripId: string) {
  if (!canUseStorage()) return;

  const shareId = getShareIdForTrip(tripId);

  localStorage.removeItem(selectedKey(tripId));
  localStorage.removeItem(deletedKey(tripId));
  localStorage.removeItem(metaKey(tripId));
  localStorage.removeItem(eventsKey(tripId));
  localStorage.removeItem(shareIdKey(tripId));

  if (shareId) {
    const mappedTripId = findLocalTripIdByShareId(shareId);
    if (mappedTripId === tripId) {
      localStorage.removeItem(shareToTripKey(shareId));
    }
  }

  const next = readRecentTripsIndex().filter((x) => x.tripId !== tripId);
  writeRecentTripsIndex(next);
}

function splitLocation(location?: string | null): {
  city: string | null;
  region: string | null;
} {
  const raw = String(location || "").trim();
  if (!raw) return { city: null, region: null };

  const parts = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return { city: raw, region: null };
  }

  return {
    city: parts.slice(0, -1).join(", ") || null,
    region: parts[parts.length - 1] || null,
  };
}

function sortStoredEvents(events: TripStoredEvent[]) {
  return [...events].sort((a, b) => {
    const ad = String(a.date || "9999-12-31");
    const bd = String(b.date || "9999-12-31");
    if (ad !== bd) return ad.localeCompare(bd);

    const at = String(a.localTime || "23:59");
    const bt = String(b.localTime || "23:59");
    if (at !== bt) return at.localeCompare(bt);

    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export function storedEventToRowEvent(event: TripStoredEvent): RowEvent {
  return {
    date: event.date || null,
    name: event.title,
    location: event.location || normalizeLocation(event.city, event.region),
    genre: event.primaryPill || null,
    url: event.ticketHref || null,
    lat: event.lat ?? null,
    lon: event.lon ?? null,
    localTime: event.localTime || null,
  };
}

export function rowEventToStoredEvent(
  row: RowEvent,
  fallbackIndex = 0
): TripStoredEvent {
  const parsed = splitLocation(row.location);
  const id =
    eventKey(row) ||
    `shared-event-${fallbackIndex}`;

  return {
    id,
    source: "area",
    title: String(row.name || "Event"),
    subtitle: formatEventMeta(
      row.date || null,
      row.localTime || null,
      parsed.city,
      parsed.region
    ),
    primaryPill: row.genre || null,
    secondaryPill: null,
    ticketHref: row.url || null,
    date: row.date || null,
    localTime: row.localTime || null,
    city: parsed.city,
    region: parsed.region,
    venueName: null,
    location: row.location || normalizeLocation(parsed.city, parsed.region),
    lat: row.lat ?? null,
    lon: row.lon ?? null,
  };
}

export function buildSharedTripPayload(tripId: string): BuildTripPayload {
  const events = sortStoredEvents(readSelected(tripId));
  const rowEvents = events.map(storedEventToRowEvent);
  const dated = rowEvents
    .map((e) => e.date)
    .filter(
      (d): d is string => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""))
    )
    .sort();

  const meta = readTripMeta(tripId);
  const tripName = String(meta?.name || "").trim() || "Your Trip";

  return {
    tripName,
    cityState: rowEvents[0]?.location || undefined,
    startYMD: dated[0] || null,
    endYMD: dated[dated.length - 1] || null,
    anchor: rowEvents[0],
    events: rowEvents,
  };
}

export function replaceTripFromSharedPayload(
  tripId: string,
  payload: BuildTripPayload
) {
  if (!canUseStorage()) return;

  const nextEvents: TripStoredEvent[] = Array.isArray(payload.events)
    ? payload.events.map((event, index) =>
        rowEventToStoredEvent(event, index)
      )
    : [];

  localStorage.setItem(selectedKey(tripId), JSON.stringify(nextEvents));
  localStorage.setItem(eventsKey(tripId), JSON.stringify(nextEvents));

  const existingMeta = readTripMeta(tripId);

  const nextName =
    String(payload.tripName || "").trim() ||
    existingMeta?.name?.trim() ||
    String(payload.cityState || "").trim() ||
    "Your Trip";

  saveTripMeta(tripId, nextName);
}

export function getShareIdForTrip(tripId: string): string | null {
  if (!canUseStorage() || !tripId) return null;
  const raw = localStorage.getItem(shareIdKey(tripId));
  const value = String(raw || "").trim();
  return value || null;
}

export function findLocalTripIdByShareId(shareId: string): string | null {
  if (!canUseStorage() || !shareId) return null;
  const raw = localStorage.getItem(shareToTripKey(shareId));
  const value = String(raw || "").trim();
  return value || null;
}

export function setShareIdForTrip(tripId: string, shareId: string) {
  if (!canUseStorage() || !tripId || !shareId) return;

  localStorage.setItem(shareIdKey(tripId), shareId);
  localStorage.setItem(shareToTripKey(shareId), tripId);
}

export async function createShareLinkForTrip(
  tripId: string
): Promise<string | null> {
  if (typeof window === "undefined" || !tripId) return null;

  try {
    const payload = buildSharedTripPayload(tripId);

    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return null;

    const json = await res.json().catch(() => null);
    const shareId = String(json?.id || "").trim();

    if (!shareId) return null;

    setShareIdForTrip(tripId, shareId);
    return shareId;
  } catch {
    return null;
  }
}

export async function ensureShareIdForTrip(
  tripId: string
): Promise<string | null> {
  if (!tripId) return null;

  const existing = getShareIdForTrip(tripId);
  if (existing) return existing;

  return await createShareLinkForTrip(tripId);
}

export async function updateSharedTripRemoteByShareId(
  shareId: string,
  payload: BuildTripPayload
): Promise<boolean> {
  if (typeof window === "undefined" || !shareId) return false;

  try {
    const res = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return res.ok;
  } catch {
    return false;
  }
}

export async function syncLocalTripToShare(tripId: string): Promise<boolean> {
  if (!tripId) return false;

  const shareId = getShareIdForTrip(tripId);
  if (!shareId) return false;

  const payload = buildSharedTripPayload(tripId);
  return updateSharedTripRemoteByShareId(shareId, payload);
}

export async function pullSharedTripToLocal(
  tripId: string,
  shareIdOverride?: string
): Promise<boolean> {
  if (typeof window === "undefined" || !tripId) {
    console.log("pullSharedTripToLocal: skipped - no window or tripId", {
      tripId,
      shareIdOverride,
    });
    return false;
  }

  const shareId =
    String(shareIdOverride || "").trim() || getShareIdForTrip(tripId) || null;

  console.log("pullSharedTripToLocal: start", {
    tripId,
    shareIdOverride,
    resolvedShareId: shareId,
  });

  if (!shareId) {
    console.log("pullSharedTripToLocal: no shareId");
    return false;
  }

  try {
    const url = `/api/share?id=${encodeURIComponent(shareId)}`;
    console.log("pullSharedTripToLocal: fetching", url);

    const res = await fetch(url, {
      cache: "no-store",
    });

    console.log("pullSharedTripToLocal: fetch status", res.status);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.log("pullSharedTripToLocal: fetch failed body", text);
      return false;
    }

    const json = await res.json().catch((err) => {
      console.log("pullSharedTripToLocal: json parse failed", err);
      return null;
    });

    console.log("pullSharedTripToLocal: response json", json);

    if (!json?.trip || typeof json.trip !== "object") {
      console.log("pullSharedTripToLocal: missing trip payload");
      return false;
    }

    replaceTripFromSharedPayload(tripId, json.trip as BuildTripPayload);
    setShareIdForTrip(tripId, shareId);

    console.log("pullSharedTripToLocal: wrote shared trip to local storage", {
      selectedKey: selectedKey(tripId),
      eventsKey: eventsKey(tripId),
      selectedValue: localStorage.getItem(selectedKey(tripId)),
      eventsValue: localStorage.getItem(eventsKey(tripId)),
    });

    return true;
  } catch (err) {
    console.log("pullSharedTripToLocal: exception", err);
    return false;
  }
}