// FILE: lib/favorites/fetchSeriesEvents.ts

import type { SeriesKey } from "@/lib/favorites/types";
import TM from "@/lib/tm/client";
import { normalizeTMEvent, type NormEvent } from "@/lib/events/normalize";
import { dedupeEvents } from "@/lib/events/dedupe";
import {
  filterTMEventsForSeries,
  seriesKeywords,
} from "@/lib/favorites/seriesMatchers";
import { isYMD } from "@/lib/time/window";

const TM_PAGE_SIZE = 100;
const TM_MAX_PAGES = 8;
const TM_STALL_PAGES = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("rate limit") || msg.includes("quota") || msg.includes("429");
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRateLimitError(err)) throw err;
    await sleep(800);
    return await fn();
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const raw = String(value || "").trim();
    const key = raw.toLowerCase();
    if (!raw || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }

  return out;
}

function isJunkNorm(ne: any): boolean {
  const name = String(ne?.name ?? "").trim();
  const city = String(ne?.city ?? ne?.location?.city ?? "").trim();
  const venue = String(ne?.venueName ?? ne?.venue ?? "").trim();

  if (!name) return true;
  if (name.toLowerCase().includes("untitled")) return true;
  if (!city || city.toLowerCase().includes("tbd")) return true;
  if (!venue || venue.toLowerCase().includes("tbd")) return true;

  return false;
}

function isJunkTM(tm: any): boolean {
  const name = String(tm?.name ?? "").trim();
  if (!name) return true;
  if (name.toLowerCase().includes("untitled")) return true;

  const v0 = tm?._embedded?.venues?.[0];
  const vCity = String(v0?.city?.name ?? "").trim();
  const vName = String(v0?.name ?? "").trim();

  if (!vCity || vCity.toLowerCase().includes("tbd")) return true;
  if (!vName || vName.toLowerCase().includes("tbd")) return true;
  if (!tm?.url) return true;

  const d = String(tm?.dates?.start?.localDate ?? "").trim();
  if (!d || !isYMD(d)) return true;

  return false;
}

function normalizeAndDedupeTMEvents(rawEvents: any[]): NormEvent[] {
  const normalized: NormEvent[] = [];

  for (const tm of rawEvents) {
    if (isJunkTM(tm)) continue;

    const ne = normalizeTMEvent(tm);
    if (!ne) continue;
    if (isJunkNorm(ne)) continue;

    normalized.push(ne);
  }

  return dedupeEvents(normalized).filter((e) => !isJunkNorm(e));
}

function extraSeriesKeywords(seriesKey: SeriesKey): string[] {
  switch (seriesKey) {
    case "f1":
      return [
        "Miami Grand Prix",
        "Canadian Grand Prix",
        "Grand Prix du Canada",
        "United States Grand Prix",
        "Las Vegas Grand Prix",
        "Mexico City Grand Prix",
      ];

    case "nascar":
      return [
        "NASCAR Cup Series",
        "Xfinity Series",
        "Craftsman Truck Series",
        "Daytona 500",
        "Coke Zero Sugar 400",
        "Southern 500",
        "Brickyard 400",
      ];

        case "indy":
      return [
        "IndyCar",
        "NTT IndyCar Series",
        "Indy 500",
        "Indianapolis 500",
        "Acura Grand Prix of Long Beach",
        "Grand Prix of St. Petersburg",
        "Detroit Grand Prix",
        "Honda Indy Toronto",
        "Sonsio Grand Prix",
        "Bommarito Automotive Group 500",
      ];

    case "pga":
      return [
        "The Players Championship",
        "Masters Tournament",
        "U.S. Open Golf",
        "Open Championship Golf",
        "PGA Championship",
      ];

        case "lpga":
      return [
        "LPGA Tour",
        "LPGA",
        "Ladies Professional Golf Association",
        "CPKC Women's Open",
        "Chevron Championship",
        "Amundi Evian Championship",
        "AIG Women's Open",
        "Founders Cup",
        "Mizuho Americas Open",
        "Women's PGA Championship",
        "Hilton Grand Vacations Tournament of Champions",
      ];

    case "liv":
      return [
        "LIV Golf",
        "LIV Golf League",
      ];

    case "tgl":
      return [
        "TGL",
        "Tomorrow's Golf League",
      ];

    case "ufc":
      return [
        "UFC",
        "UFC Fight Night",
        "Ultimate Fighting Championship",
      ];

        case "atp":
      return [
        "ATP Tour",
        "ATP",
        "ATP Masters 1000",
        "ATP 500",
        "ATP 250",
        "National Bank Open",
        "BNP Paribas Open",
        "Miami Open",
        "Cincinnati Open",
        "Canadian Open Tennis",
        "Dallas Open",
        "Mubadala Citi DC Open",
        "Rolex Shanghai Masters",
        "Paris Masters",
        "Monte-Carlo Masters",
        "Italian Open Tennis",
        "Madrid Open Tennis",
      ];

    case "wta":
      return [
        "WTA Tour",
        "WTA",
        "WTA 1000",
        "WTA 500",
        "WTA 250",
      ];

    default:
      return [];
  }
}

function searchKeywordsForSeries(seriesKey: SeriesKey): string[] {
  return uniqueStrings([
    ...seriesKeywords(seriesKey),
    ...extraSeriesKeywords(seriesKey),
  ]);
}

async function searchTmByKeyword(args: {
  keyword: string;
  countryCode: string;
  startDateTime?: string;
  endDateTime?: string;
}): Promise<any[]> {
  let lastUniqueCount = 0;
  let stallPages = 0;

  return withRateLimitRetry(() =>
    TM.tmSearchEventsAll(
      {
        keyword: args.keyword,
        countryCode: args.countryCode,
        ...(args.startDateTime ? { startDateTime: args.startDateTime } : {}),
        ...(args.endDateTime ? { endDateTime: args.endDateTime } : {}),
        sort: "date,asc",
        size: TM_PAGE_SIZE,
      },
      {
        hardCap: TM_PAGE_SIZE * TM_MAX_PAGES,
        maxPages: TM_MAX_PAGES,
        onPage(eventsSoFar: any[]) {
          const dedupedSoFar = normalizeAndDedupeTMEvents(eventsSoFar);
          const uniqueCount = dedupedSoFar.length;

          if (uniqueCount <= lastUniqueCount) {
            stallPages += 1;
          } else {
            lastUniqueCount = uniqueCount;
            stallPages = 0;
          }

          return stallPages >= TM_STALL_PAGES;
        },
      }
    )
  );
}

export async function fetchSeriesTMEvents(args: {
  seriesKey: SeriesKey;
  countryCode: string;
  startDateTime?: string;
  endDateTime?: string;
}): Promise<NormEvent[]> {
  await sleep(200);

  const keywords = searchKeywordsForSeries(args.seriesKey);
  const allRaw: any[] = [];

  for (const keyword of keywords) {
    const tmEvents = await searchTmByKeyword({
      keyword,
      countryCode: args.countryCode,
      startDateTime: args.startDateTime,
      endDateTime: args.endDateTime,
    });

    allRaw.push(...tmEvents);
  }

  const filteredRaw = filterTMEventsForSeries(args.seriesKey, allRaw);
  return normalizeAndDedupeTMEvents(filteredRaw);
}