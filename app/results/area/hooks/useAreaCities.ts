"use client";

import { useEffect, useState } from "react";
import type { CityOpt } from "../utils";

export default function useAreaCities() {
  const [cities, setCities] = useState<CityOpt[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadCities() {
      try {
        const res = await fetch("/api/options?kind=cities&all=1", {
          cache: "no-store", // always get fresh on dev/prod
        });

        const json = await res.json().catch(() => null);

        if (cancelled) return;

        const raw = Array.isArray(json?.cities) ? json.cities : [];

        const cityList: CityOpt[] = raw
          .map((item: unknown) => {
            const x = item as Record<string, unknown>;

            const label = String(x?.label ?? "").trim();
            const lat = Number(x?.lat);
            const lon = Number(x?.lon);

            if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) {
              return null;
            }

            return {
              id: x?.id ? String(x.id) : undefined,
              label,
              lat,
              lon,
              country: x?.country ? String(x.country) : undefined,
              airportIata: x?.airportIata
                ? String(x.airportIata)
                : undefined,
            } as CityOpt;
          })
          .filter(Boolean) as CityOpt[];

        setCities(cityList);
      } catch {
        if (!cancelled) setCities([]);
      }
    }

    loadCities();

    return () => {
      cancelled = true;
    };
  }, []);

  return cities;
}