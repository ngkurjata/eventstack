"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Dispatch, SetStateAction } from "react";
import type { Favorite } from "@/lib/favorites/types";

type AnchorCard = any;

type ApiResp = {
  mode: "favorites";
  favorites: { id: string; label: string; defaultGenre?: string | null }[];
  startDate: string | null;
  endDate: string | null;
  count: number;
  anchorCards: AnchorCard[];
  error?: string;
};

function favoriteIdentityKey(fav: Favorite | null | undefined) {
  if (!fav) return "";
  return String(fav.attractionId || fav.seriesKey || fav.id || "").trim();
}

export function useFavoritesSearch({
  tripId,
  countryCode,
  selectedFavorite,
  setAppliedNearbyFavorite,
  setNearbyDraftFavorite,
  setNearbyInput,
  setShowOnlyMatching,
}: {
  tripId: string;
  countryCode: string;
  selectedFavorite: Favorite | null;
  setAppliedNearbyFavorite: Dispatch<SetStateAction<Favorite | null>>;
  setNearbyDraftFavorite: Dispatch<SetStateAction<Favorite | null>>;
  setNearbyInput: Dispatch<SetStateAction<string>>;
  setShowOnlyMatching: Dispatch<SetStateAction<boolean>>;
}) {
  const router = useRouter();

  const [resp, setResp] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasRunMainSearch, setHasRunMainSearch] = useState(false);

  const searchAbortRef = useRef<AbortController | null>(null);
  const searchStoppedRef = useRef(false);

  const stopMainSearch = useCallback(() => {
    searchStoppedRef.current = true;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setLoading(false);
  }, []);

  const runSearch = useCallback(
    async (favOverride?: Favorite | null) => {
      const fav = favOverride || selectedFavorite;
      const identity = favoriteIdentityKey(fav);

      if (!fav?.label || !identity) {
        alert("Please select a valid favorite.");
        return;
      }

      searchStoppedRef.current = false;

      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setHasRunMainSearch(true);
      setLoading(true);
      setErr(null);

      setAppliedNearbyFavorite(null);
      setNearbyDraftFavorite(null);
      setNearbyInput("");
      setShowOnlyMatching(false);

      try {
        const r = await fetch("/api/search/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            favorite1: fav,
            favorite2: null,
            startDate: null,
            endDate: null,
            countryCode,
          }),
        });

        const j = (await r.json().catch(() => ({}))) as ApiResp & {
          error?: string;
        };

        if (!r.ok) throw new Error(j?.error || "Failed");

        setResp(j);

        const params = new URLSearchParams();
        params.set("tripId", tripId);
        params.set("countryCode", countryCode);
        params.set("f1Label", fav.label);
        params.set("f1Kind", fav.kind);

        if (fav.id) {
          params.set("f1Id", fav.id);
        }
        if (fav.attractionId) {
          params.set("f1AttractionId", fav.attractionId);
        }
        if (fav.seriesKey) {
          params.set("f1SeriesKey", fav.seriesKey);
        }
        if (fav.defaultGenre) {
          params.set("f1DefaultGenre", fav.defaultGenre);
        }

        router.replace(`/results/favorites?${params.toString()}`, {
          scroll: false,
        });
      } catch (e) {
        const isAbort = e instanceof DOMException && e.name === "AbortError";

        if (!isAbort) {
          const error = e as Error;
          setResp(null);
          setErr(error?.message || "Failed");
        }
      } finally {
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
        }
        setLoading(false);
      }
    },
    [
      selectedFavorite,
      countryCode,
      tripId,
      router,
      setAppliedNearbyFavorite,
      setNearbyDraftFavorite,
      setNearbyInput,
      setShowOnlyMatching,
    ]
  );

  return {
    resp,
    loading,
    err,
    hasRunMainSearch,
    searchStoppedRef,
    runSearch,
    stopMainSearch,
  };
}