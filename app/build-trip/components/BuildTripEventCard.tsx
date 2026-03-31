"use client";

import SharedEventCard from "@/app/components/events/SharedEventCard";
import { storedEventToSharedCardProps } from "@/lib/events/cardAdapters";
import type { TripStoredEvent } from "@/lib/trip/store";

type Props = {
  event: TripStoredEvent;
  isMaybe: boolean;
  orderLabel?: string;
  onToggleMaybe: (id: string) => void;
  onRemove: (id: string) => void | Promise<void>;
};

export default function BuildTripEventCard({
  event,
  isMaybe,
  orderLabel,
  onToggleMaybe,
  onRemove,
}: Props) {
  const cardProps = storedEventToSharedCardProps(event);

  return (
    <div
      className={`relative transition-all ${
        isMaybe ? "opacity-55 saturate-50" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => void onRemove(event.id)}
        aria-label={`Remove ${event.title}`}
        className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-white text-xl font-black leading-none text-red-600 shadow-sm transition hover:bg-red-50 sm:right-4 sm:top-4"
      >
        ×
      </button>

      <SharedEventCard
        {...cardProps}
        showTickets
        selected={!isMaybe}
        onCardClick={() => onToggleMaybe(event.id)}
        disableFlash
        orderLabel={orderLabel}
        className=""
      />
    </div>
  );
}