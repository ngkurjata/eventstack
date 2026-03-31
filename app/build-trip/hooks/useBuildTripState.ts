"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ensureShareIdForTrip,
  listStoredEvents,
  removeStoredEvent,
  saveTripMeta,
  syncLocalTripToShare,
  type TripStoredEvent,
} from "@/lib/trip/store";
import {
  addDaysYMD,
  buildConfirmedMapEvents,
  buildOrderById,
  buildTripDateRange,
  groupByDate,
  isYMD,
  writeMaybeIds,
} from "../utils/buildTrip";

export function useBuildTripState() {
  const router = useRouter();

  const [tripName, setTripName] = useState("Your Trip");
  const [draftTripName, setDraftTripName] = useState("");
  const [isEditingTripName, setIsEditingTripName] = useState(false);

  const [events, setEvents] = useState<TripStoredEvent[]>([]);
  const [maybeIds, setMaybeIds] = useState<string[]>([]);
  const [showMaybe, setShowMaybe] = useState(true);
  const [showMap, setShowMap] = useState(true);

  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const sync = useCallback((tripId: string) => {
    if (!tripId) {
      setEvents([]);
      return;
    }

    const nextEvents = listStoredEvents(tripId);
    setEvents(nextEvents);

    const validIds = new Set(nextEvents.map((e) => e.id));
    setMaybeIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      writeMaybeIds(tripId, next);
      return next;
    });

    // Important: build-trip is where newly added local events become visible
    // after returning from results pages. Push that updated local trip state
    // to the shared copy as well so shared trips stay in sync.
    void syncLocalTripToShare(tripId);
  }, []);

  const hydrateFromBootstrap = useCallback(
    ({
      tripName,
      maybeIds,
    }: {
      tripId: string;
      tripName: string;
      maybeIds: string[];
    }) => {
      setTripName(tripName);
      setDraftTripName(tripName);
      setMaybeIds(maybeIds);
    },
    []
  );

  const maybeIdSet = useMemo(() => new Set(maybeIds), [maybeIds]);

  const visibleEvents = useMemo(() => {
    if (showMaybe) return events;
    return events.filter((event) => !maybeIdSet.has(event.id));
  }, [events, showMaybe, maybeIdSet]);

  const grouped = useMemo(() => groupByDate(visibleEvents), [visibleEvents]);

  const confirmedMapEvents = useMemo(() => {
    return buildConfirmedMapEvents(events, maybeIdSet);
  }, [events, maybeIdSet]);

  const orderById = useMemo(() => {
    return buildOrderById(confirmedMapEvents);
  }, [confirmedMapEvents]);

  const tripDateRange = useMemo(() => {
    return buildTripDateRange(events, maybeIdSet);
  }, [events, maybeIdSet]);

  function startEditingTripName() {
    setDraftTripName(tripName);
    setIsEditingTripName(true);
  }

  function cancelTripNameEdit() {
    setDraftTripName(tripName);
    setIsEditingTripName(false);
  }

  async function saveTripNameEdit(tripId: string) {
    if (!tripId) return;

    const nextName = draftTripName.trim() || "Your Trip";
    saveTripMeta(tripId, nextName);
    setTripName(nextName);
    setDraftTripName(nextName);
    setIsEditingTripName(false);

    await syncLocalTripToShare(tripId);
  }

  async function copyTripLink(
    tripId: string,
    shareId: string,
    setShareId: (value: string) => void
  ) {
    if (!tripId) return;

    try {
      let nextShareId: string | null = shareId || null;

      if (!nextShareId) {
        nextShareId = await ensureShareIdForTrip(tripId);
        if (!nextShareId) return;
        setShareId(nextShareId);
      }

      await syncLocalTripToShare(tripId);

      const finalShareId = nextShareId;
      if (!finalShareId) return;

      const shareUrl = `${window.location.origin}/build-trip?shareId=${encodeURIComponent(
        finalShareId
      )}`;

      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);

      const params = new URLSearchParams();
      params.set("tripId", tripId);
      params.set("shareId", finalShareId);
      router.replace(`/build-trip?${params.toString()}`);
    } catch {
      setCopied(false);
    }
  }

  async function shareTrip(
    tripId: string,
    shareId: string,
    setShareId: (value: string) => void
  ) {
    if (!tripId) return;

    const cleanTripName = (tripName || "Your Trip").trim() || "Your Trip";

    let nextShareId: string | null = shareId || null;

    if (!nextShareId) {
      nextShareId = await ensureShareIdForTrip(tripId);
      if (!nextShareId) return;
      setShareId(nextShareId);
    }

    await syncLocalTripToShare(tripId);

    const finalShareId = nextShareId;
    if (!finalShareId) return;

    const shareUrl = `${window.location.origin}/build-trip?shareId=${encodeURIComponent(
      finalShareId
    )}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: cleanTripName,
          text: cleanTripName,
          url: shareUrl,
        });

        setShared(true);
        window.setTimeout(() => setShared(false), 1800);

        const params = new URLSearchParams();
        params.set("tripId", tripId);
        params.set("shareId", finalShareId);
        router.replace(`/build-trip?${params.toString()}`);

        return;
      } catch {
        // user cancelled share sheet
      }
    }

    await copyTripLink(tripId, shareId, setShareId);
  }

  function toggleMaybe(tripId: string, id: string) {
    if (!tripId) return;

    setMaybeIds((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((x) => x !== id) : [...prev, id];
      writeMaybeIds(tripId, next);
      return next;
    });
  }

  async function removeEvent(tripId: string, id: string) {
    if (!tripId) return;

    removeStoredEvent(tripId, id);

    setMaybeIds((prev) => {
      const next = prev.filter((x) => x !== id);
      writeMaybeIds(tripId, next);
      return next;
    });

    sync(tripId);
    await syncLocalTripToShare(tripId);
  }

  function openNearbySearch(tripId: string, event: TripStoredEvent) {
    if (!tripId) return;

    const city = String(event.city || "").trim();
    const eventDate = String(event.date || "").trim();

    if (!city || !isYMD(eventDate)) return;

    const lat = Number(event.lat);
    const lon = Number(event.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const start = addDaysYMD(eventDate, -2);
    const end = addDaysYMD(eventDate, 2);

    if (!start || !end) return;

    const params = new URLSearchParams();
    params.set("tripId", tripId);
    params.set("cityLabel", city);
    params.set("lat", String(lat));
    params.set("lon", String(lon));
    params.set("start", start);
    params.set("end", end);
    params.set("radiusMiles", "90");
    params.set("autoSearch", "1");

    router.push(`/results/area?${params.toString()}`);
  }

  return {
    tripName,
    draftTripName,
    isEditingTripName,
    events,
    maybeIds,
    maybeIdSet,
    showMaybe,
    showMap,
    copied,
    shared,
    grouped,
    confirmedMapEvents,
    orderById,
    tripDateRange,

    setDraftTripName,
    setShowMaybe,
    setShowMap,

    sync,
    hydrateFromBootstrap,

    startEditingTripName,
    cancelTripNameEdit,
    saveTripNameEdit,
    copyTripLink,
    shareTrip,
    toggleMaybe,
    removeEvent,
    openNearbySearch,
  };
}