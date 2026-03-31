"use client";

import SharedEventDateGroup from "@/app/components/events/SharedEventDateGroup";
import TripRouteMap from "@/app/components/trip/TripRouteMap";
import { formatSectionDate } from "@/lib/date/format";
import type { TripStoredEvent } from "@/lib/trip/store";
import BuildTripEventRow from "./BuildTripEventRow";

type MapEvent = {
  id: string;
  title: string;
  date?: string | null;
  localTime?: string | null;
  city?: string | null;
  region?: string | null;
  venueName?: string | null;
  lat: number;
  lon: number;
  orderLabel: string;
};

type Props = {
  events: TripStoredEvent[];
  maybeIdSet: Set<string>;
  grouped: [string, TripStoredEvent[]][];
  confirmedMapEvents: MapEvent[];
  orderById: Map<string, string>;
  showMap: boolean;
  showMaybe: boolean;
  onToggleMap: () => void;
  onToggleShowMaybe: () => void;
  onToggleMaybe: (id: string) => void;
  onRemove: (id: string) => void | Promise<void>;
  onOpenNearbySearch: (event: TripStoredEvent) => void;
};

export default function BuildTripEventsSection({
  events,
  maybeIdSet,
  grouped,
  confirmedMapEvents,
  orderById,
  showMap,
  showMaybe,
  onToggleMap,
  onToggleShowMaybe,
  onToggleMaybe,
  onRemove,
  onOpenNearbySearch,
}: Props) {
  return (
    <section className="mt-5 rounded-3xl border border-slate-200 bg-white px-4 py-5 shadow-sm sm:px-8 sm:py-7">
      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
          <div className="text-base font-extrabold tracking-wide text-slate-800">
            SELECTED EVENTS WILL APPEAR HERE
          </div>
        </div>
      ) : (
        <>
          <div className="mb-5 flex justify-center">
            <button
              type="button"
              onClick={onToggleMap}
              className="min-w-[240px] rounded-2xl border border-slate-300 bg-white px-6 py-3 text-center text-sm font-extrabold text-slate-900 shadow-sm transition hover:bg-white sm:min-w-[280px] sm:px-8"
            >
              {showMap ? "Hide Map" : "Show Map"}
            </button>
          </div>

          {showMap ? (
            confirmedMapEvents.length > 0 ? (
              <div className="mb-6">
                <TripRouteMap events={confirmedMapEvents} />
              </div>
            ) : (
              <div className="mb-6 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
                <div className="text-base font-extrabold tracking-wide text-slate-800">
                  NO MAPPABLE FOR-SURE EVENTS YET
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-500">
                  Add or confirm events with saved coordinates to show the trip
                  route.
                </div>
              </div>
            )
          ) : null}

          <div className="mb-6 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onToggleShowMaybe}
              className="min-w-[240px] rounded-2xl border border-slate-300 bg-white px-6 py-3 text-center text-sm font-extrabold text-slate-900 shadow-sm transition hover:bg-white sm:min-w-[280px] sm:px-8"
            >
              {showMaybe ? "Hide 'Maybe' Events" : "Show 'Maybe' Events"}
            </button>

            <div className="text-center text-sm font-medium text-slate-500">
              Click events to mark them as{" "}
              <span className="font-semibold">“maybe”</span> and remove them
              from the map.
            </div>
          </div>

          {grouped.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <div className="text-base font-extrabold tracking-wide text-slate-800">
                SHADED EVENTS ARE HIDDEN
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-500">
                Tap “Show 'Maybe' Events” to reveal them again.
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([date, items]) => (
                <SharedEventDateGroup key={date} title={formatSectionDate(date)}>
                  {items.map((event) => {
                    const isMaybe = maybeIdSet.has(event.id);
                    const orderLabel = !isMaybe
                      ? orderById.get(event.id) ?? undefined
                      : undefined;

                    return (
                      <BuildTripEventRow
                        key={event.id}
                        event={event}
                        isMaybe={isMaybe}
                        orderLabel={orderLabel}
                        onToggleMaybe={onToggleMaybe}
                        onRemove={onRemove}
                        onOpenNearbySearch={onOpenNearbySearch}
                      />
                    );
                  })}
                </SharedEventDateGroup>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}