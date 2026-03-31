"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  findLocalTripIdByShareId,
  getShareIdForTrip,
  listStoredEvents,
  loadTripMeta,
  makeTripId,
  pullSharedTripToLocal,
  saveTripMeta,
  setShareIdForTrip,
} from "@/lib/trip/store";
import { readMaybeIds } from "../utils/buildTrip";

type Params = {
  rawTripId: string;
  rawShareId: string;
  hydrateFromBootstrap: (payload: {
    tripId: string;
    tripName: string;
    maybeIds: string[];
  }) => void;
  syncTrip: (tripId: string) => void;
};

export function useBuildTripBootstrap({
  rawTripId,
  rawShareId,
  hydrateFromBootstrap,
  syncTrip,
}: Params) {
  const router = useRouter();

  const [tripId, setTripId] = useState("");
  const [shareId, setShareId] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      let localTripId = rawTripId;
      let remoteShareId = rawShareId;

      if (remoteShareId) {
        localTripId =
          localTripId ||
          findLocalTripIdByShareId(remoteShareId) ||
          makeTripId();

        setShareIdForTrip(localTripId, remoteShareId);
      } else if (localTripId) {
        remoteShareId = getShareIdForTrip(localTripId) || "";
      }

      if (cancelled) return;

      setTripId(localTripId || "");
      setShareId(remoteShareId || "");
      setReady(true);

      if (localTripId && remoteShareId) {
        const params = new URLSearchParams();
        params.set("tripId", localTripId);
        params.set("shareId", remoteShareId);
        router.replace(`/build-trip?${params.toString()}`);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [rawTripId, rawShareId, router]);

  useEffect(() => {
    if (!ready || !tripId) return;

    let cancelled = false;

    async function ensureSharedDataIfNeeded() {
  if (shareId) {
    await pullSharedTripToLocal(tripId, shareId);
  }
}

    async function hydrateAndSync() {
      await ensureSharedDataIfNeeded();
      if (cancelled) return;

      const meta = loadTripMeta(tripId);
      const loadedName = meta?.name?.trim() || "Your Trip";

      saveTripMeta(tripId, loadedName);

      hydrateFromBootstrap({
        tripId,
        tripName: loadedName,
        maybeIds: readMaybeIds(tripId),
      });

      syncTrip(tripId);
    }

    void hydrateAndSync();

    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      void hydrateAndSync();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [ready, tripId, shareId, hydrateFromBootstrap, syncTrip]);

  return {
    tripId,
    shareId,
    setShareId,
    ready,
  };
}