// FILE: lib/trips/types.ts

/**
 * SelectedEvent is the single normalized event shape used across:
 * - resultsa selections
 * - resultsbcd selections
 * - /api/trips/save payload
 *
 * Keep it stable + minimal: only what you need to render trips and rebuild later.
 */
export type SelectedEvent = {
  /** Stable internal id for this selected item (you can set this to tmEventId) */
  id: string;

  /** Source identity */
  source: "ticketmaster";
  tmEventId: string;

  /** Display */
  name: string;
  url: string | null;

  /** Local date/time in the event’s local timezone as provided by TM */
  localDate: string | null; // "YYYY-MM-DD"
  localTime: string | null; // "HH:MM" or "HH:MM:SS"

  /** Location strings */
  city: string;
  region: string; // state/province code if available
  country: string; // "US" | "CA" | ...

  venueName: string;

  /** Optional geo if you have it */
  lat?: number | null;
  lon?: number | null;

  /** Preference/debug fields (optional but useful) */
  matchedGenres?: string[]; // which user genres it matched
  pillGenre?: string; // the single genre you show as the “primary” pill
};

/**
 * TripDoc is what /api/trips/get returns and what /api/trips/save stores.
 * This is intentionally simple for Phase 1.
 */
export type TripDoc = {
  tripId: string;

  /** For the page title: "HomeBase • start → end" */
  homeBase: string;

  /** Trip window */
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"

  /** The selected events */
  events: SelectedEvent[];

  /** Optional metadata */
  createdAt?: string; // ISO
  updatedAt?: string; // ISO
  version?: number;
};