import { formatEventMeta } from "@/lib/format/dateTime";
import type { TripStoredEvent } from "@/lib/trip/store";

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

export function anchorToStored(card: AnchorCard): TripStoredEvent {
  return {
    id: card.id,
    source: "favorites",
    title: card.name,
    subtitle: formatEventMeta(
      card.localDate,
      card.localTime,
      card.city,
      card.region
    ),
    primaryPill: card.matched?.defaultGenres?.[0] || null,
    secondaryPill: null,
    ticketHref: card.url || null,
    date: card.localDate,
    localTime: card.localTime,
    city: card.city,
    region: card.region,
    venueName: card.venueName,
    location: [card.city, card.region].filter(Boolean).join(", "),
    lat: card.lat,
    lon: card.lon,
  };
}