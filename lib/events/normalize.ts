// FILE: lib/events/normalize.ts

import type { TMEvent } from "@/lib/tm/client";
import { canonicalMetroCity } from "@/lib/geo/metroOverrides";

export type NormEvent = {
  id: string;
  name: string;
  localDate: string; // YYYY-MM-DD
  localTime: string | null;
  ts: number;

  city: string;
  region: string | null;
  country: string | null;
  venueName: string | null;
  lat: number | null;
  lon: number | null;
  url: string | null;

  segment: string | null;
  genre: string | null;
  subGenre: string | null;

  canonicalKey: string;
  qualityScore: number;
  flags: {
    isUpsellLike: boolean;
    isParkingLike: boolean;
    isResaleLike: boolean;
  };

  matched: {
    favorites: string[];
    genres: string[];
    defaultGenres: string[];
  };
};

function toNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function safeStr(x: any): string | null {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  return s ? s : null;
}

function pickFirstTruthy(...vals: Array<string | null | undefined>) {
  for (const v of vals) {
    const s = safeStr(v);
    if (s) return s;
  }
  return null;
}

function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function lowerAlnum(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripNoiseTokens(title: string) {
  // remove common junk descriptors from the title for canonical grouping
  let s = title;

  // remove bracketed chunks
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\([^\)]*\)/g, " ");

  // remove common upsell/parking/package tokens
  s = s.replace(
    /\b(vip|upgrade|package|packages|meet\s*and\s*greet|hospitality|club\s*level|suite|lounge)\b/gi,
    " "
  );
  s = s.replace(/\b(parking|parkwhiz|garage|lot)\b/gi, " ");
  s = s.replace(/\b(access\s*pass|pre[-\s]?party|post[-\s]?party|tailgate)\b/gi, " ");

  return normalizeSpaces(s);
}

function isNoiseLike(title: string) {
  const t = title.toLowerCase();
  const patterns = [
    /\bparking\b/,
    /\bparkwhiz\b/,
    /\bgarage\b/,
    /\blot\b/,
    /\baccess\s*pass\b/,
    /\bvip\b/,
    /\bupgrade\b/,
    /\bclub\s*level\b/,
    /\bsuite\b/,
    /\bhospitality\b/,
    /\bmeet\s*and\s*greet\b/,
    /\bpre[-\s]?party\b/,
    /\bpost[-\s]?party\b/,
    /\btailgate\b/,
    /\badd[-\s]?on\b/,
    /\bmerch\b.*\bpackage\b/,
  ];
  return patterns.some((re) => re.test(t));
}

function qualityScoreFrom(tm: TMEvent) {
  // higher is better
  let score = 0;

  const venue = tm?._embedded?.venues?.[0];
  const hasVenue = !!venue?.name;
  const hasCity = !!venue?.city?.name;
  const hasCoords = !!venue?.location?.latitude && !!venue?.location?.longitude;
  const hasUrl = !!tm?.url;

  if (hasVenue) score += 2;
  if (hasCity) score += 2;
  if (hasCoords) score += 1;
  if (hasUrl) score += 1;

  // prefer non-noise titles
  const title = safeStr(tm?.name) || "";
  if (!isNoiseLike(title)) score += 3;

  // prefer events with time
  const lt = safeStr(tm?.dates?.start?.localTime);
  if (lt) score += 1;

  return score;
}

export function normalizeTMEvent(tm: TMEvent): NormEvent | null {
  const id = safeStr(tm?.id);
  const rawName = safeStr(tm?.name);
  const localDate = safeStr(tm?.dates?.start?.localDate);

  if (!id || !rawName || !localDate) return null;

  const localTime = safeStr(tm?.dates?.start?.localTime);
  const ts = Date.parse(`${localDate}T${localTime || "12:00:00"}`);

  const venue = tm?._embedded?.venues?.[0];

  const rawCity = safeStr(venue?.city?.name) || "Unknown";
  const region = safeStr(venue?.state?.stateCode) || safeStr(venue?.province?.provinceCode);
  const country = safeStr(venue?.country?.countryCode);

  // Metro normalization (Long Beach -> Los Angeles, East Rutherford -> New York, etc.)
  const city = canonicalMetroCity(rawCity, region, country);

  const venueName = safeStr(venue?.name);

  const lat = toNum(venue?.location?.latitude);
  const lon = toNum(venue?.location?.longitude);

  const url = safeStr(tm?.url);

  // Kill placeholder/garbage rows conservatively
  const nameLower = rawName.toLowerCase();
  const cityLower = city.toLowerCase();
  const venueLower = (venueName || "").toLowerCase();

  // If TM literally names it "Untitled..." -> drop
  if (nameLower.includes("untitled")) return null;

  // If venue/city are TBD-ish AND the name is generic-ish -> drop
  // (Do NOT require url/coords/etc; that can delete legit sports rows.)
  const tbdPlace =
    cityLower.includes("tbd") ||
    venueLower.includes("tbd") ||
    cityLower === "unknown" ||
    venueLower === "unknown";

  if (tbdPlace && (nameLower.includes("event") || nameLower.includes("tbd"))) {
    return null;
  }

  // classifications (can be missing on some TM records)
  const cls = tm?.classifications?.[0] || null;

  const segment = pickFirstTruthy(
    cls?.segment?.name,
    // fallbacks sometimes present
    (tm as any)?.classifications?.[0]?.segment?.name,
    (tm as any)?.classifications?.[0]?.segment?.id
  );

  const genre = pickFirstTruthy(
    cls?.genre?.name,
    // some feeds put meaningful names in type/subType
    (tm as any)?.type?.name,
    (tm as any)?.type?.id
  );

  const subGenre = pickFirstTruthy(
    cls?.subGenre?.name,
    (tm as any)?.subType?.name,
    (tm as any)?.subType?.id
  );

  const flags = {
    isUpsellLike: isNoiseLike(rawName),
    isParkingLike: /\bparking\b|\bparkwhiz\b|\bgarage\b|\blot\b/i.test(rawName),
    isResaleLike: /\bresale\b/i.test(rawName),
  };

  // canonical key: (date + normalized title + venue/city)
  const titleCore = stripNoiseTokens(rawName);
  const key = [localDate, lowerAlnum(titleCore), lowerAlnum(venueName || city)].join("|");

  return {
    id,
    name: normalizeSpaces(rawName),
    localDate,
    localTime,
    ts: Number.isFinite(ts) ? ts : Date.parse(`${localDate}T12:00:00`),

    city,
    region,
    country,
    venueName,
    lat,
    lon,
    url,

    segment,
    genre,
    subGenre,

    canonicalKey: key,
    qualityScore: qualityScoreFrom(tm),
    flags,

    matched: {
      favorites: [],
      genres: [],
      defaultGenres: [],
    },
  };
}