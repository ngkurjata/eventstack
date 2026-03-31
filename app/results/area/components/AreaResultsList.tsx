"use client";

import React from "react";
import SharedEventCard from "@/app/components/events/SharedEventCard";
import SharedEventDateGroup from "@/app/components/events/SharedEventDateGroup";
import { formatSectionDate } from "@/lib/date/format";
import { areaEventToSharedCardProps } from "../adapters";
import type { ApiResp, NormEvent } from "../utils";

type GroupedEvents = Array<[string, NormEvent[]]>;

type Props = {
  hasSearched: boolean;
  loading: boolean;
  resp: ApiResp | null;
  activeGenre: string | null;
  grouped: GroupedEvents;
  selectedMap: Record<string, boolean>;
  onToggle: (event: NormEvent) => void;
};

export default function AreaResultsList({
  hasSearched,
  loading,
  resp,
  activeGenre,
  grouped,
  selectedMap,
  onToggle,
}: Props) {
  return (
    <section className="mt-4 sm:mt-5">
      {!hasSearched ? null : loading ? (
        <div className="text-sm font-semibold text-slate-500">Loading…</div>
      ) : !resp ? (
        <div className="text-sm font-semibold text-slate-500">No results.</div>
      ) : !activeGenre ? null : grouped.length === 0 ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500 shadow-sm sm:rounded-3xl sm:p-7">
          No events found for {activeGenre}.
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-5">
          {grouped.map(([date, items]) => (
            <SharedEventDateGroup key={date} title={formatSectionDate(date)}>
              {items.map((event) => (
                <SharedEventCard
                  key={event.id}
                  {...areaEventToSharedCardProps(event)}
                  showTickets
                  selected={!!selectedMap[event.id]}
                  onCardClick={() => onToggle(event)}
                />
              ))}
            </SharedEventDateGroup>
          ))}
        </div>
      )}
    </section>
  );
}