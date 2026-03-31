import { useCallback, useEffect, useRef, useState } from "react";
import {
  genreKeyToLabel,
  resolveGenreKey,
} from "@/lib/events/genres";
import {
  dedupeNearbyEvents,
  eventMatchesNearbyFilter,
  isSameAsAnchorEvent,
} from "@/lib/favorites/nearbyUtils";

type NearbyStatus = "idle" | "checking" | "match" | "no-match";

export function useFavoritesNearby({
  resp,
  appliedNearbyFavorite,
  visibleRankById,
  addDaysYMD,
}: {
  resp: any;
  appliedNearbyFavorite: any;
  visibleRankById: Record<string, number>;
  addDaysYMD: (ymd: string, delta: number) => string;
}) {
  const [statusByAnchorId, setStatusByAnchorId] = useState<
    Record<string, NearbyStatus>
  >({});
  const [nearbyByAnchorId, setNearbyByAnchorId] = useState<
    Record<string, Record<string, unknown>[]>
  >({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [nearbyChecking, setNearbyChecking] = useState(false);
  const [isNearbyStopped, setIsNearbyStopped] = useState(false);

  const checkedRef = useRef<Record<string, true>>({});
  const inflightRef = useRef<Record<string, true>>({});

  const nearbyRunIdRef = useRef(0);
  const nearbyAbortRef = useRef<AbortController | null>(null);
  const nearbyStoppedRef = useRef(false);

  const stopNearbySearch = useCallback(() => {
    nearbyStoppedRef.current = true;
    setIsNearbyStopped(true);
    nearbyRunIdRef.current += 1;
    nearbyAbortRef.current?.abort();
    nearbyAbortRef.current = null;
    inflightRef.current = {};
    setNearbyChecking(false);

    setStatusByAnchorId((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (next[id] === "checking") next[id] = "idle";
      }
      return next;
    });
  }, []);

  const resetNearbyUi = useCallback(() => {
    stopNearbySearch();
    nearbyStoppedRef.current = false;
    setIsNearbyStopped(false);
    setStatusByAnchorId({});
    setNearbyByAnchorId({});
    setExpandedIds(new Set());
    setNearbyChecking(false);
    checkedRef.current = {};
    inflightRef.current = {};
  }, [stopNearbySearch]);

  const runNearbyCheck = useCallback(
    (nearbyDraftFavorite: any, hasRunNearbySearch: boolean) => {
      if (!resp?.anchorCards?.length) return;
      if (!nearbyDraftFavorite) return;

      const identityKey = (fav: any) =>
        String(
          fav?.attractionId || fav?.seriesKey || fav?.genreKey || ""
        ).trim();

      const sameAsApplied =
        !!appliedNearbyFavorite &&
        identityKey(appliedNearbyFavorite) === identityKey(nearbyDraftFavorite) &&
        String(appliedNearbyFavorite?.label || "") ===
          String(nearbyDraftFavorite?.label || "");

      const shouldContinueSameRun =
        hasRunNearbySearch && nearbyStoppedRef.current && sameAsApplied;

      nearbyStoppedRef.current = false;
      setIsNearbyStopped(false);
      nearbyRunIdRef.current += 1;
      nearbyAbortRef.current?.abort();
      nearbyAbortRef.current = new AbortController();

      if (!shouldContinueSameRun) {
        checkedRef.current = {};
        inflightRef.current = {};

        setStatusByAnchorId({});
        setNearbyByAnchorId({});
        setExpandedIds(new Set());
        setNearbyChecking(false);
      } else {
        inflightRef.current = {};
        setNearbyChecking(false);
      }
    },
    [resp, appliedNearbyFavorite]
  );

  useEffect(() => {
    if (!appliedNearbyFavorite) {
      checkedRef.current = {};
      inflightRef.current = {};
    }
  }, [appliedNearbyFavorite]);

  useEffect(() => {
    if (!resp?.anchorCards?.length) {
      setStatusByAnchorId({});
      setNearbyByAnchorId({});
      setExpandedIds(new Set());
      setNearbyChecking(false);
      return;
    }

    if (!appliedNearbyFavorite) {
      setStatusByAnchorId({});
      setNearbyByAnchorId({});
      setExpandedIds(new Set());
      setNearbyChecking(false);
      return;
    }

    if (nearbyStoppedRef.current) {
      setNearbyChecking(false);
      return;
    }

    const runId = nearbyRunIdRef.current;
    const controller = nearbyAbortRef.current;
    const signal = controller?.signal;
    let cancelled = false;

    const isStale = () =>
      cancelled ||
      nearbyStoppedRef.current ||
      !!signal?.aborted ||
      runId !== nearbyRunIdRef.current;

    const run = async () => {
      const anchors = resp.anchorCards;

      const pendingAnchors = anchors.filter(
        (card: any) => !checkedRef.current[card.id]
      );

      if (pendingAnchors.length === 0) {
        if (!isStale()) setNearbyChecking(false);
        return;
      }

      const prioritizedAnchors = [...pendingAnchors].sort((a: any, b: any) => {
        const aRank = visibleRankById[a.id] || 0;
        const bRank = visibleRankById[b.id] || 0;
        if (aRank !== bRank) return bRank - aRank;

        const dateDiff = String(a.localDate || "").localeCompare(
          String(b.localDate || "")
        );
        if (dateDiff !== 0) return dateDiff;

        return String(a.localTime || "23:59").localeCompare(
          String(b.localTime || "23:59")
        );
      });

      if (isStale()) return;

      setNearbyChecking(true);

      setStatusByAnchorId((prev) => {
        if (isStale()) return prev;

        const next = { ...prev };
        for (const card of prioritizedAnchors) {
          if (checkedRef.current[card.id]) continue;
          if (inflightRef.current[card.id]) continue;
          next[card.id] =
            card.lat && card.lon && card.localDate ? "checking" : "no-match";
        }
        return next;
      });

      for (const card of prioritizedAnchors) {
        if (isStale()) {
          delete inflightRef.current[card.id];
          continue;
        }

        if (checkedRef.current[card.id]) continue;
        if (inflightRef.current[card.id]) continue;

        inflightRef.current[card.id] = true;

        if (!card.lat || !card.lon || !card.localDate) {
          checkedRef.current[card.id] = true;
          delete inflightRef.current[card.id];

          if (!isStale()) {
            setStatusByAnchorId((prev) => ({
              ...prev,
              [card.id]: "no-match",
            }));
          }
          continue;
        }

        try {
          const isGenreOnly =
            !appliedNearbyFavorite.attractionId &&
            !appliedNearbyFavorite.seriesKey &&
            !!(appliedNearbyFavorite.genreKey || appliedNearbyFavorite.label);

          const canonicalGenreLabelForRequest = appliedNearbyFavorite.genreKey
            ? genreKeyToLabel(appliedNearbyFavorite.genreKey)
            : genreKeyToLabel(resolveGenreKey(appliedNearbyFavorite.label));

          const start = addDaysYMD(card.localDate, -3);
          const end = addDaysYMD(card.localDate, 3);

          const existsParams = new URLSearchParams({
            exists: "1",
            start,
            end,
            lat: String(card.lat),
            lon: String(card.lon),
            radiusMiles: "90",
          });

          if (isGenreOnly && canonicalGenreLabelForRequest) {
            existsParams.set("genres", canonicalGenreLabelForRequest);
          } else if (appliedNearbyFavorite.attractionId) {
            existsParams.set(
              "attractionId",
              appliedNearbyFavorite.attractionId
            );
          } else if (appliedNearbyFavorite.seriesKey) {
            existsParams.set("seriesKey", appliedNearbyFavorite.seriesKey);
          }

          const existsRes = await fetch(
            `/api/trip-matches?${existsParams.toString()}`,
            {
              cache: "no-store",
              signal,
            }
          );

          if (isStale()) {
            delete inflightRef.current[card.id];
            continue;
          }

          const existsJson = await existsRes.json().catch(() => ({}));
          if (isStale()) {
            delete inflightRef.current[card.id];
            continue;
          }

          const hasMatch = !!(existsJson as { exists?: boolean })?.exists;

          if (!hasMatch) {
            checkedRef.current[card.id] = true;
            delete inflightRef.current[card.id];

            if (!isStale()) {
              setStatusByAnchorId((prev) => ({
                ...prev,
                [card.id]: "no-match",
              }));
            }
            continue;
          }

          const ctxBody: Record<string, unknown> = {
            anchorLocalDate: card.localDate,
            anchorLat: card.lat,
            anchorLon: card.lon,
            startDate: start,
            endDate: end,
            radiusMiles: 90,
          };

          if (isGenreOnly && canonicalGenreLabelForRequest) {
            ctxBody.genres = [canonicalGenreLabelForRequest];
          } else {
            ctxBody.favorites = [
              {
                id: "F2",
                label: appliedNearbyFavorite.label,
                attractionId: appliedNearbyFavorite.attractionId,
                seriesKey: appliedNearbyFavorite.seriesKey,
                defaultGenre: appliedNearbyFavorite.defaultGenre,
              },
            ];
          }

          const ctxRes = await fetch("/api/trip/context", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ctxBody),
            signal,
          });

          if (isStale()) {
            delete inflightRef.current[card.id];
            continue;
          }

          const ctxJson = await ctxRes.json().catch(() => ({}));
          if (isStale()) {
            delete inflightRef.current[card.id];
            continue;
          }

          const nearbyEvents = Array.isArray(
            (ctxJson as { events?: unknown[] })?.events
          )
            ? ((ctxJson as { events?: unknown[] }).events as Record<
                string,
                unknown
              >[])
            : [];

          const filtered = dedupeNearbyEvents(
            nearbyEvents.filter((e: Record<string, unknown>) => {
              if (!eventMatchesNearbyFilter(e, appliedNearbyFavorite)) {
                return false;
              }
              if (isSameAsAnchorEvent(e, card)) {
                return false;
              }
              return true;
            })
          );

          checkedRef.current[card.id] = true;
          delete inflightRef.current[card.id];

          if (!isStale()) {
            setNearbyByAnchorId((prev) => ({
              ...prev,
              [card.id]: filtered,
            }));

            setStatusByAnchorId((prev) => ({
              ...prev,
              [card.id]: filtered.length > 0 ? "match" : "no-match",
            }));
          }
        } catch (error) {
          checkedRef.current[card.id] = true;
          delete inflightRef.current[card.id];

          if (isStale()) continue;

          const isAbort =
            error instanceof DOMException && error.name === "AbortError";
          if (isAbort) continue;

          setStatusByAnchorId((prev) => ({
            ...prev,
            [card.id]: "no-match",
          }));
        }
      }

      if (!isStale()) {
        const anyStillPending = resp.anchorCards.some(
          (card: any) => !checkedRef.current[card.id]
        );
        setNearbyChecking(anyStillPending);
      }
    };

    run();

    return () => {
      cancelled = true;
      for (const id of Object.keys(inflightRef.current)) {
        delete inflightRef.current[id];
      }

      setStatusByAnchorId((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next)) {
          if (next[id] === "checking") next[id] = "idle";
        }
        return next;
      });
    };
  }, [resp, appliedNearbyFavorite, visibleRankById, addDaysYMD]);

  return {
    statusByAnchorId,
    nearbyByAnchorId,
    expandedIds,
    setExpandedIds,
    nearbyChecking,
    runNearbyCheck,
    stopNearbySearch,
    resetNearbyUi,
    isNearbyStopped,
  };
}