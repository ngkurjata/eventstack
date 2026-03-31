"use client";

import React from "react";
import type { Favorite } from "@/lib/favorites/types";

import SharedEventCard from "@/app/components/events/SharedEventCard";
import SharedEventDateGroup from "@/app/components/events/SharedEventDateGroup";
import { formatSectionDate } from "@/lib/date/format";
import { toggleTripEvent, readSelected } from "@/lib/trip/store";
import { nearbyEventToStored } from "@/lib/favorites/nearbyUtils";
import { anchorToStored } from "@/lib/favorites/anchorToStored";
import {
  favoriteAnchorToSharedCardProps,
  storedEventToSharedCardProps,
} from "@/lib/events/cardAdapters";

type NearbyStatus = "idle" | "checking" | "match" | "no-match";

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

type Props = {
  grouped: [string, AnchorCard[]][];
  selectedMap: Record<string, boolean>;
  setSelectedMap: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  tripId: string;
  appliedNearbyFavorite: Favorite | null;
  statusByAnchorId: Record<string, NearbyStatus>;
  nearbyByAnchorId: Record<string, any[]>;
  expandedIds: Set<string>;
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  registerAnchor: (id: string, el: HTMLDivElement | null) => void;
};

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-slate-300 border-t-slate-700 ${className}`}
      aria-hidden="true"
    />
  );
}

function NearbyStatusControl({
  status,
  expanded,
  onToggle,
  nearbyLabel,
}: {
  status: NearbyStatus;
  expanded: boolean;
  onToggle: () => void;
  nearbyLabel: string;
}) {
  const labelText = nearbyLabel.trim() || "nearby";

  if (status === "checking") {
    return (
      <div className="mt-2 flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600">
        <div className="flex items-center gap-2">
          <Spinner className="h-4 w-4" />
          <span>Checking nearby {labelText} events…</span>
        </div>
      </div>
    );
  }

  if (status === "no-match") {
    return (
      <div className="mt-2 flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-black uppercase tracking-wide text-slate-500">
        No Nearby {labelText} Events
      </div>
    );
  }

  if (status === "match") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={
          expanded
            ? `Hide nearby ${labelText} events`
            : `Show nearby ${labelText} events`
        }
        title={
          expanded
            ? `Hide nearby ${labelText} events`
            : `Show nearby ${labelText} events`
        }
        className="mt-2 flex w-full items-center justify-center rounded-2xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-black uppercase tracking-wide text-green-800 transition hover:bg-green-100"
      >
        {expanded
          ? `Hide Nearby ${labelText} Events`
          : `Nearby ${labelText} Events`}
      </button>
    );
  }

  return null;
}

function groupNearbyEventsByDate(events: any[]) {
  const grouped = events.reduce<Record<string, any[]>>((acc, event) => {
    const key = String(event?.localDate || "").trim() || "Unknown Date";
    if (!acc[key]) acc[key] = [];
    acc[key].push(event);
    return acc;
  }, {});

  return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
}

export default function FavoritesAnchorList({
  grouped,
  selectedMap,
  setSelectedMap,
  tripId,
  appliedNearbyFavorite,
  statusByAnchorId,
  nearbyByAnchorId,
  expandedIds,
  setExpandedIds,
  registerAnchor,
}: Props) {
  return (
    <>
      {grouped.map(([date, items]) => (
        <SharedEventDateGroup key={date} title={formatSectionDate(date)}>
          {items.map((card) => {
            const selected = !!selectedMap[card.id];
            const nearbyStatus = statusByAnchorId[card.id] || "idle";
            const nearbyEvents = nearbyByAnchorId[card.id] || [];
            const groupedNearbyEvents = groupNearbyEventsByDate(nearbyEvents);
            const isExpanded = expandedIds.has(card.id);
            const anchorCardProps = favoriteAnchorToSharedCardProps(card);

            return (
              <div
                key={card.id}
                ref={(el) => registerAnchor(card.id, el)}
                className="mb-2 sm:mb-3"
              >
                <div className="min-w-0">
                  <SharedEventCard
                    {...anchorCardProps}
                    showTickets
                    selected={selected}
                    onCardClick={() => {
                      if (!tripId) return;

                      const stored = anchorToStored(card);

                      toggleTripEvent(tripId, stored);

                      const next = readSelected(tripId);
                      setSelectedMap(
                        Object.fromEntries(next.map((x) => [x.id, true]))
                      );
                    }}
                  />

                  {appliedNearbyFavorite ? (
                    <NearbyStatusControl
                      status={nearbyStatus}
                      expanded={isExpanded}
                      nearbyLabel={appliedNearbyFavorite.label}
                      onToggle={() => {
                        setExpandedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(card.id)) next.delete(card.id);
                          else next.add(card.id);
                          return next;
                        });
                      }}
                    />
                  ) : null}
                </div>

                {appliedNearbyFavorite &&
                isExpanded &&
                nearbyEvents.length > 0 ? (
                  <div className="mt-3 rounded-[24px] border border-green-200 bg-green-50/40 px-3 py-3 sm:px-4 sm:py-4">
                    <div className="mb-3 text-lg font-black uppercase tracking-wide text-green-800">
                      Nearby {appliedNearbyFavorite.label} Events
                    </div>

                    <div className="space-y-3">
                      {groupedNearbyEvents.map(([nearbyDate, dateEvents]) => (
                        <SharedEventDateGroup
                          key={`${card.id}-${nearbyDate}`}
                          title={formatSectionDate(nearbyDate)}
                        >
                          <div className="space-y-3">
                            {dateEvents.map((e) => {
                              const stored = nearbyEventToStored(e);
                              const nearbySelected = !!selectedMap[stored.id];
                              const nearbyCardProps =
                                storedEventToSharedCardProps(stored);

                              return (
                                <SharedEventCard
                                  key={stored.id}
                                  {...nearbyCardProps}
                                  showTickets
                                  selected={nearbySelected}
                                  onCardClick={() => {
                                    if (!tripId) return;

                                    toggleTripEvent(tripId, stored);

                                    const nextStored = readSelected(tripId);
                                    setSelectedMap(
                                      Object.fromEntries(
                                        nextStored.map((x) => [x.id, true])
                                      )
                                    );
                                  }}
                                  className="border-green-200"
                                />
                              );
                            })}
                          </div>
                        </SharedEventDateGroup>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </SharedEventDateGroup>
      ))}
    </>
  );
}