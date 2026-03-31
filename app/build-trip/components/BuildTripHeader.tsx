"use client";

import { formatRangeDate } from "../utils/buildTrip";

type DateRange = {
  start: string;
  end: string;
} | null;

type Props = {
  tripId: string;
  tripName: string;
  draftTripName: string;
  isEditingTripName: boolean;
  tripDateRange: DateRange;
  onDraftTripNameChange: (value: string) => void;
  onStartEditingTripName: () => void;
  onSaveTripNameEdit: () => void | Promise<void>;
  onCancelTripNameEdit: () => void;
  onAddEventsByCity: () => void;
  onAddEventsByFavorites: () => void;
};

export default function BuildTripHeader({
  tripName,
  draftTripName,
  isEditingTripName,
  tripDateRange,
  onDraftTripNameChange,
  onStartEditingTripName,
  onSaveTripNameEdit,
  onCancelTripNameEdit,
  onAddEventsByCity,
  onAddEventsByFavorites,
}: Props) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white px-4 py-6 shadow-sm sm:px-10 sm:py-10">
      <div className="text-center">
        {isEditingTripName ? (
          <input
            type="text"
            value={draftTripName}
            onChange={(e) => onDraftTripNameChange(e.target.value)}
            onBlur={() => void onSaveTripNameEdit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onSaveTripNameEdit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                onCancelTripNameEdit();
              }
            }}
            autoFocus
            maxLength={60}
            className="mx-auto block w-full max-w-[1000px] rounded-2xl border border-slate-300 bg-white px-4 py-2 text-center text-slate-900 outline-none focus:border-slate-500"
            style={{
              fontSize: "clamp(2rem, 8vw, 60px)",
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: "-0.03em",
            }}
          />
        ) : (
          <button
            type="button"
            onClick={onStartEditingTripName}
            title="Click to rename trip"
            className="mx-auto block w-full max-w-[1000px] rounded-2xl px-3 py-1 text-center text-slate-900 transition hover:bg-slate-100"
            style={{
              fontSize: "clamp(2rem, 8vw, 60px)",
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: "-0.03em",
            }}
          >
            {tripName}
          </button>
        )}

        <div className="mt-2 text-xs font-semibold text-slate-400">
          Click title to rename
        </div>

        {tripDateRange ? (
          <div className="mt-3 text-sm font-semibold text-slate-500 sm:text-base">
            {formatRangeDate(tripDateRange.start)} –{" "}
            {formatRangeDate(tripDateRange.end)}
          </div>
        ) : (
          <div className="mt-3 text-sm font-semibold text-slate-400 sm:text-base">
            Add events to build your trip timeline
          </div>
        )}
      </div>

      <div className="mt-8 grid gap-3 text-center sm:grid-cols-2 sm:gap-4">
        <button
          type="button"
          onClick={onAddEventsByCity}
          className="rounded-2xl bg-slate-900 px-5 py-4 text-white shadow-sm transition hover:bg-slate-800"
        >
          <span className="text-base font-black">Add Events by City</span>
        </button>

        <button
          type="button"
          onClick={onAddEventsByFavorites}
          className="rounded-2xl bg-slate-900 px-5 py-4 text-white shadow-sm transition hover:bg-slate-800"
        >
          <span className="text-base font-black">Add Events by Favorites</span>
        </button>
      </div>
    </section>
  );
}