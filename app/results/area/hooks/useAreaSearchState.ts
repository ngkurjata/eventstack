"use client";

import { useEffect, useState } from "react";
import { addDaysLocal, isYMD, tomorrowYMD } from "@/lib/date/ymd";
import type { SearchState, CityOpt } from "../utils";
import { DEFAULT_SEARCH } from "../utils";

type ParamsLike = {
  get: (key: string) => string | null;
};

export default function useAreaSearchState(
  sp: ParamsLike,
  autoSearchFlag: boolean
) {
  const [search, setSearch] = useState<SearchState>(() => ({
    ...DEFAULT_SEARCH,
    cityLabel: (sp.get("cityLabel") || "").trim(),
    lat: (sp.get("lat") || "").trim(),
    lon: (sp.get("lon") || "").trim(),
    startDate: (sp.get("start") || "").trim(),
    endDate: (sp.get("end") || "").trim(),
    endTouched: autoSearchFlag,
    radiusMiles: Number(sp.get("radiusMiles") || "90") || 90,
  }));

  useEffect(() => {
    if (!search.startDate) {
      const t = tomorrowYMD();
      setSearch((s) => ({
        ...s,
        startDate: t,
        endDate: s.endTouched ? s.endDate : addDaysLocal(t, 13),
      }));
      return;
    }

    if (isYMD(search.startDate) && !search.endTouched) {
      const autoEnd = addDaysLocal(search.startDate, 13);
      if (autoEnd && autoEnd !== search.endDate) {
        setSearch((s) => ({
          ...s,
          endDate: autoEnd,
        }));
      }
    }
  }, [search.startDate, search.endDate, search.endTouched]);

  function setCityLabel(next: string) {
    setSearch((s) => ({
      ...s,
      cityLabel: next,
      lat: "",
      lon: "",
    }));
  }

  function pickCity(opt: CityOpt) {
    setSearch((s) => ({
      ...s,
      cityLabel: opt.label,
      lat: String(opt.lat),
      lon: String(opt.lon),
    }));
  }

  function setStartDate(next: string) {
    setSearch((s) => ({
      ...s,
      startDate: next,
      endDate:
        s.endTouched && isYMD(s.endDate) && s.endDate >= next
          ? s.endDate
          : addDaysLocal(next, 13),
      endTouched: s.endTouched,
    }));
  }

  function setEndDate(next: string) {
    setSearch((s) => ({
      ...s,
      endDate: next,
      endTouched: true,
    }));
  }

  return {
    search,
    setSearch,
    setCityLabel,
    pickCity,
    setStartDate,
    setEndDate,
  };
}