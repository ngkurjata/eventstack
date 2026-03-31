import { formatEventMeta } from "@/lib/format/dateTime";
import type { TripStoredEvent } from "@/lib/trip/store";

type FavoriteAnchorCard = {
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

export type SharedEventCardAdapterProps = {
  title: string;
  subtitle: string;
  primaryPill?: string | null;
  secondaryPill?: string | null;
  ticketHref?: string | null;
};

export function storedEventToSharedCardProps(
  event: TripStoredEvent
): SharedEventCardAdapterProps {
  return {
    title: event.title,
    subtitle:
      event.subtitle ||
      formatEventMeta(
        event.date || null,
        event.localTime || null,
        event.city || null,
        event.region || null
      ),
    primaryPill: event.primaryPill ?? null,
    secondaryPill: event.secondaryPill ?? null,
    ticketHref: event.ticketHref ?? null,
  };
}

export function favoriteAnchorToSharedCardProps(
  card: FavoriteAnchorCard
): SharedEventCardAdapterProps {
  return {
    title: card.name,
    subtitle: formatEventMeta(
      card.localDate,
      card.localTime,
      card.city,
      card.region
    ),
    primaryPill: card.matched?.defaultGenres?.[0] || null,
    secondaryPill: card.isCrossover ? "CROSSOVER" : null,
    ticketHref: card.url || null,
  };
}