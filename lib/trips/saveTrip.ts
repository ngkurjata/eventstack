// FILE: lib/trips/saveTrip.ts

export type TripEvent = {
  id: string;

  source: "ticketmaster";
  tmEventId: string;

  name: string;
  url: string | null;

  localDate: string | null;
  localTime: string | null;

  city: string;
  region: string;
  country: string | null;

  venueName: string;

  lat: number | null;
  lon: number | null;

  matchedGenres: string[];
  pillGenre: string;
};

export type TripDraft = {
  tripId?: string;
  homeBase: string; // IATA
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  events: TripEvent[];
};

export type SaveTripResponse =
  | { ok: true; tripId: string }
  | { ok: false; error: string; detail?: string };