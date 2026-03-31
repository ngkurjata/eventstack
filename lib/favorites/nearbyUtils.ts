import { formatEventMeta } from "@/lib/format/dateTime";
import {
  genreKeyToLabel,
  resolveGenreKey,
  type GenreKey,
} from "@/lib/events/genres";
import type { TripStoredEvent } from "@/lib/trip/store";

type FavoriteKind = "team" | "artist" | "series";

type Favorite = {
  id: string;
  label: string;
  kind: FavoriteKind;
  attractionId?: string;
  seriesKey?: string;
  defaultGenre: string;
  genreKey?: GenreKey;
};

type AnchorCard = {
  id: string;
  name: string;
  localDate: string;
  localTime: string | null;
  city: string;
  region: string | null;
  venueName: string | null;
  lat: number | null;
  lon: number | null;
  url: string | null;
  matched: {
    favorites: string[];
    defaultGenres: string[];
    genres?: string[];
  };
  isCrossover: boolean;
};

function textNorm(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function nearbyEventToStored(
  event: Record<string, unknown>
): TripStoredEvent {
  const rawPrimary =
    (event.matched as
      | { genres?: string[]; defaultGenres?: string[] }
      | undefined)?.genres?.[0] ||
    (event.matched as
      | { genres?: string[]; defaultGenres?: string[] }
      | undefined)?.defaultGenres?.[0] ||
    String(event.pillLabel || "") ||
    "";

  const normalizedPrimary =
    genreKeyToLabel(resolveGenreKey(rawPrimary)) ||
    (rawPrimary
      ? rawPrimary.charAt(0).toUpperCase() + rawPrimary.slice(1)
      : null);

  return {
    id: String(event.id || ""),
    source: "favorites",
    title: String(event.name || "Event"),
    subtitle: formatEventMeta(
      String(event.localDate || "") || null,
      String(event.localTime || "") || null,
      String(event.city || "") || null,
      String(event.region || "") || null
    ),
    primaryPill: normalizedPrimary,
    secondaryPill: null,
    ticketHref: String(event.url || "") || null,
    date: String(event.localDate || "") || null,
    localTime: String(event.localTime || "") || null,
    city: String(event.city || "") || null,
    region: String(event.region || "") || null,
    venueName: String(event.venueName || "") || null,
    location: [event.city, event.region].filter(Boolean).join(", "),
    lat: event.lat == null ? null : Number(event.lat),
    lon: event.lon == null ? null : Number(event.lon),
  };
}

export function eventMatchesNearbyFilter(
  event: Record<string, unknown>,
  nearbyFavorite: Favorite | null
): boolean {
  if (!nearbyFavorite) return true;

  const matchedFavorites = Array.isArray(
    (event.matched as { favorites?: unknown[] } | undefined)?.favorites
  )
    ? ((event.matched as { favorites?: unknown[] }).favorites || []).map((x) =>
        String(x || "").trim().toLowerCase()
      )
    : [];

  const selectedAttractionId = String(nearbyFavorite.attractionId || "").trim();
  const selectedSeriesKey = String(nearbyFavorite.seriesKey || "").trim();
  const selectedGenreKey =
    nearbyFavorite.genreKey || resolveGenreKey(nearbyFavorite.label);

  if (selectedAttractionId || selectedSeriesKey) {
    return matchedFavorites.includes("f2");
  }

  if (!selectedGenreKey) return false;

  const candidateValues = [
    ...((Array.isArray(
      (event.matched as { genres?: unknown[] } | undefined)?.genres
    )
      ? ((event.matched as { genres?: unknown[] }).genres || [])
      : []) as unknown[]),
    ...((Array.isArray(
      (event.matched as { defaultGenres?: unknown[] } | undefined)
        ?.defaultGenres
    )
      ? ((event.matched as { defaultGenres?: unknown[] }).defaultGenres || [])
      : []) as unknown[]),
    ...(Array.isArray(event.canonicalGenres)
      ? (event.canonicalGenres as unknown[])
      : []),
    event.pillLabel,
  ];

  return candidateValues.some(
    (value) => resolveGenreKey(String(value || "")) === selectedGenreKey
  );
}

export function isSameAsAnchorEvent(
  event: Record<string, unknown>,
  card: AnchorCard
): boolean {
  const sameId =
    String(event.id || "").trim() !== "" &&
    String(event.id || "").trim() === String(card.id || "").trim();

  const sameCoreEvent =
    textNorm(event.name) === textNorm(card.name) &&
    String(event.localDate || "").trim() ===
      String(card.localDate || "").trim() &&
    textNorm(event.venueName) === textNorm(card.venueName);

  return sameId || sameCoreEvent;
}

export function dedupeNearbyEvents(events: Record<string, unknown>[]) {
  const seen = new Set<string>();

  return events.filter((e) => {
    const key = [
      textNorm(e.name),
      String(e.localDate || "").trim(),
      String(e.localTime || "").trim(),
      textNorm(e.venueName),
      textNorm(e.city),
      textNorm(e.region),
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}