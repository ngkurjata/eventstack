"use client";

import type { TripStoredEvent } from "@/lib/trip/store";
import { isYMD } from "../utils/buildTrip";
import BuildTripEventCard from "./BuildTripEventCard";

type Props = {
  event: TripStoredEvent;
  isMaybe: boolean;
  orderLabel?: string;
  onToggleMaybe: (id: string) => void;
  onRemove: (id: string) => void | Promise<void>;
  onOpenNearbySearch: (event: TripStoredEvent) => void;
};

export default function BuildTripEventRow({
  event,
  isMaybe,
  orderLabel,
  onToggleMaybe,
  onRemove,
  onOpenNearbySearch,
}: Props) {
  const canOpenNearby =
    !!event.city &&
    isYMD(event.date) &&
    Number.isFinite(Number(event.lat)) &&
    Number.isFinite(Number(event.lon));

  return (
    <div>
      <BuildTripEventCard
        event={event}
        isMaybe={isMaybe}
        orderLabel={orderLabel}
        onToggleMaybe={onToggleMaybe}
        onRemove={onRemove}
      />

      <button
  onClick={() => onOpenNearbySearch(event)}
  disabled={!canOpenNearby}
  aria-label={`Find nearby events for ${event.title}`}
  title={
    canOpenNearby
      ? "Find nearby events in this city and date window"
      : "This event needs a city, date, and coordinates"
  }
  className={`mt-2 flex w-full items-center justify-center rounded-2xl border px-3 py-2 text-sm font-black uppercase tracking-wide transition ${
    canOpenNearby
      ? "border-green-200 bg-green-50 text-green-800 hover:bg-green-100"
      : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
  }`}
>
  Nearby Events
</button>
    </div>
  );
}