// FILE: lib/trips/types.ts

import type { Favorite } from "@/lib/favorites/types";

export type CityRef = {
  label: string;
  lat: number;
  lon: number;
};

export type CityWindow = {
  city: CityRef;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
};

export type AnchorEvent = {
  id: string;
  attractionId: string;
  favoriteLabel: string;

  name: string;
  localDate: string;
  localTime: string | null;

  city: string;
  region: string | null;
  country: string | null;

  venueName: string | null;
  lat: number | null;
  lon: number | null;
  url: string | null;
};

export type TripFilters = {
  anchorFavorite: Favorite;
  secondFavorite?: Favorite | null;
  genres?: string[];
  radiusMiles?: number;
  windowDaysBefore?: number;
  windowDaysAfter?: number;
};

export type TripCandidate = {
  cityWindow: CityWindow;

  anchorEvents: AnchorEvent[];

  matched: {
    favorites: string[];
    genres: string[];
    defaultGenres: string[];
  };

  score: number;
};

/**
 * Keep these because your saved-trip flow already exists.
 * We can refactor them later.
 */
export type SelectedEvent = {
  id: string;
  source: "ticketmaster";
  tmEventId: string;

  name: string;
  url: string | null;

  localDate: string | null;
  localTime: string | null;

  city: string;
  region: string;
  country: string;

  venueName: string;

  lat?: number | null;
  lon?: number | null;

  matchedGenres?: string[];
  pillGenre?: string;
};

export type TripDoc = {
  tripId: string;
  homeBase: string;
  startDate: string;
  endDate: string;
  events: SelectedEvent[];
  createdAt?: string;
  updatedAt?: string;
  version?: number;
};