"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listRecentTrips,
  makeTripId,
  saveTripMeta,
} from "@/lib/trip/store";

type RecentTrip = {
  tripId: string;
  name: string;
  updatedAt: number;
};

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showRecentTripsInfo, setShowRecentTripsInfo] = useState(false);
  const [recentTrips, setRecentTrips] = useState<RecentTrip[]>([]);

  useEffect(() => {
    setRecentTrips(listRecentTrips(5));
  }, []);

  function refreshRecentTrips() {
    setRecentTrips(listRecentTrips(5));
  }

  function openModal() {
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setName("");
  }

  function startTrip() {
    const trimmed = name.trim();
    if (!trimmed) return;

    const tripId = makeTripId();
    saveTripMeta(tripId, trimmed);
    refreshRecentTrips();
    setShowModal(false);
    router.push(`/build-trip?tripId=${tripId}`);
  }

  function openTrip(tripId: string) {
    router.push(`/build-trip?tripId=${tripId}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      startTrip();
    }
    if (e.key === "Escape") {
      closeModal();
    }
  }

  return (
    <>
      <main className="app-shell">
        <div className="page-wrap flex min-h-[calc(100dvh-65px)] flex-col items-center justify-center py-10 text-center sm:py-14">
          <h1 className="mb-8 max-w-2xl text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Plan and build trips around live sports and concerts.
          </h1>

          <button
            type="button"
            onClick={openModal}
            className="mobile-button rounded-2xl bg-black px-8 text-white transition hover:opacity-90"
          >
            Build A Trip
          </button>

          {recentTrips.length > 0 ? (
            <section className="mobile-card mt-10 w-full max-w-2xl p-5 text-center sm:p-6">
              <div className="mb-4 flex items-center justify-center gap-2">
                <div className="text-center text-lg font-black text-slate-900">
                  Recent Trips
                </div>

                <button
                  type="button"
                  aria-label="Recent trips info"
                  onClick={() =>
                    setShowRecentTripsInfo((prev) => !prev)
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-sm font-extrabold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  i
                </button>
              </div>

              {showRecentTripsInfo ? (
                <div className="mx-auto mb-4 max-w-lg rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium leading-6 text-slate-700">
                  Recent Trips only show trips saved on this device. To see a
                  trip you worked on from another device, share that trip with
                  yourself, then open the shared trip link on this device.
                </div>
              ) : null}

              <div className="grid gap-3 justify-items-center">
                {recentTrips.map((trip) => (
                  <button
                    key={trip.tripId}
                    type="button"
                    onClick={() => openTrip(trip.tripId)}
                    className="w-full max-w-md rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-center transition hover:border-slate-400 hover:bg-slate-100"
                  >
                    <div className="text-base font-extrabold text-slate-900">
                      {trip.name}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </main>

      {showModal ? (
        <div className="fixed inset-0 z-50 bg-black/30 px-4 py-6 sm:flex sm:items-center sm:justify-center">
          <div className="mx-auto mt-10 w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:mt-0 sm:p-6">
            <h2 className="mb-2 text-2xl font-extrabold text-slate-900">
              Name the Trip
            </h2>

            <p className="mb-5 text-sm font-medium text-slate-600">
              Give your trip a title to get started.
            </p>

            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="e.g. Summer Road Trip"
              autoCapitalize="words"
              autoCorrect="off"
              className="mobile-input mb-5"
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={closeModal}
                className="mobile-button flex-1 rounded-2xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={startTrip}
                disabled={!name.trim()}
                className="mobile-button flex-1 rounded-2xl bg-black text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Let’s Go!
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}