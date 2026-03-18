import type { TMEvent } from "@/lib/tm/client";
import { canonicalMetroCity } from "@/lib/geo/metroOverrides";
import {
  type GenreKey,
  genreKeyToLabel,
  normalizeGenreKeys,
} from "@/lib/events/genres";

export type NormEvent = {
  id: string;
  name: string;
  localDate: string;
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

  canonicalGenre: string | null;
  canonicalGenres: string[];
  canonicalGenreKeys: GenreKey[];
  pillLabel?: string | null;

  canonicalKey: string;
  semanticKey: string;
  qualityScore: number;

  flags: {
    isUpsellLike: boolean;
    isParkingLike: boolean;
    isResaleLike: boolean;
  };

  matched: {
    favorites: string[];
    attractionIds: string[];
    genres: string[];
    defaultGenres: string[];
  };
};

function toNum(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function safeStr(x: unknown): string | null {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  return s ? s : null;
}

function pickFirstTruthy(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) {
    const s = safeStr(v);
    if (s) return s;
  }
  return null;
}

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function lowerAlnum(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMatchupText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bversus\b/g, " vs ")
    .replace(/\bvs\.?\b/g, " vs ")
    .replace(/\bv\.?\b/g, " vs ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripBracketedContent(title: string): string {
  return title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^\)]*\)/g, " ");
}

function stripPromoNoise(title: string): string {
  let s = title;

  s = s.replace(/[*|•·]+/g, " ");

  s = s.replace(
    /\b(pinstripe\s*pass|premium\s*seating|vip|upgrade|seat\s*upgrade|package|packages|meet\s*and\s*greet|hospitality|club\s*level|suite|lounge)\b/gi,
    " "
  );

  s = s.replace(/\b(parking|parkwhiz|garage|lot)\b/gi, " ");
  s = s.replace(/\b(access\s*pass|pre[-\s]?party|post[-\s]?party|tailgate|add[-\s]?on)\b/gi, " ");

  return normalizeSpaces(s);
}

function stripSportsPromoSuffix(title: string, segment: string | null): string {
  const seg = (segment || "").toLowerCase();
  const looksSports =
    seg.includes("sport") ||
    /\b(vs|versus|v\.)\b/i.test(title);

  if (!looksSports) return title;

  const s = normalizeSpaces(title);

  // For sports listings, keep the matchup portion when a promo suffix is appended.
  // Example:
  // "Predators v Kraken - Ford Military Week" -> "Predators v Kraken"
  const parts = s.split(/\s[-–—|:]\s/);
  if (parts.length <= 1) return s;

  const first = normalizeSpaces(parts[0] || "");
  if (!/\b(vs|versus|v\.)\b/i.test(first)) return s;

  return first;
}

function stripNoiseTokens(title: string, segment: string | null): string {
  let s = title;
  s = stripBracketedContent(s);
  s = stripPromoNoise(s);
  s = stripSportsPromoSuffix(s, segment);
  return normalizeSpaces(s);
}

function isCancelledLike(name: string): boolean {
  const s = name.toLowerCase();

  return (
    /\bcancel+ed\b/.test(s) ||
    /\bcanceled\b/.test(s) ||
    /\bpostponed\b/.test(s) ||
    /\brescheduled\b/.test(s)
  );
}

function isNoiseLike(title: string): boolean {
  const t = title.toLowerCase();

  const patterns = [
    /\bparking\b/,
    /\bparkwhiz\b/,
    /\bgarage\b/,
    /\blot\b/,
    /\baccess\s*pass\b/,
    /\bvip\b/,
    /\bupgrade\b/,
    /\bseat\s*upgrade\b/,
    /\bclub\s*level\b/,
    /\bsuite\b/,
    /\bhospitality\b/,
    /\bmeet\s*and\s*greet\b/,
    /\bpremium\s*seating\b/,
    /\bpinstripe\s*pass\b/,
    /\bpre[-\s]?party\b/,
    /\bpost[-\s]?party\b/,
    /\btailgate\b/,
    /\badd[-\s]?on\b/,
  ];

  return patterns.some((re) => re.test(t));
}

function qualityScoreFrom(tm: TMEvent): number {
  let score = 0;

  const venue = tm?._embedded?.venues?.[0];

  if (venue?.name) score += 2;
  if (venue?.city?.name) score += 2;
  if (venue?.location?.latitude && venue?.location?.longitude) score += 1;
  if (tm?.url) score += 1;

  const title = safeStr(tm?.name) || "";
  if (!isNoiseLike(title)) score += 3;

  const lt = safeStr(tm?.dates?.start?.localTime);
  if (lt) score += 1;

  // Make package/upsell variants lose against the primary event.
  if (/pinstripe\s*pass/i.test(title)) score -= 4;
  if (/premium\s*seating/i.test(title)) score -= 4;
  if (/\bvip\b/i.test(title)) score -= 3;
  if (/\bpackage\b/i.test(title)) score -= 2;
  if (/\bupgrade\b/i.test(title)) score -= 2;
  if (/\bparking\b|\bgarage\b|\blot\b/i.test(title)) score -= 5;

  return score;
}

export function normalizeTMEvent(tm: TMEvent): NormEvent | null {
  const id = safeStr(tm?.id);
  const rawName = safeStr(tm?.name);
  const localDate = safeStr(tm?.dates?.start?.localDate);

  if (!id || !rawName || !localDate) return null;

  if (isCancelledLike(rawName)) return null;

  const status = safeStr(tm?.dates?.status?.code)?.toLowerCase();
  if (
    status === "cancelled" ||
    status === "canceled" ||
    status === "postponed" ||
    status === "rescheduled"
  ) {
    return null;
  }

  const localTime = safeStr(tm?.dates?.start?.localTime);
  const ts = Date.parse(`${localDate}T${localTime || "12:00:00"}`);

  const venue = tm?._embedded?.venues?.[0];

  const rawCity = safeStr(venue?.city?.name) || "Unknown";
  const region = safeStr(venue?.state?.stateCode) || safeStr(venue?.province?.provinceCode);
  const country = safeStr(venue?.country?.countryCode);

  const city = canonicalMetroCity(rawCity, region, country);
  const venueName = safeStr(venue?.name);

  const lat = toNum(venue?.location?.latitude);
  const lon = toNum(venue?.location?.longitude);

  const url = safeStr(tm?.url);

  const cls = tm?.classifications?.[0] || null;

  const segment = pickFirstTruthy(cls?.segment?.name);
  const genre = pickFirstTruthy(cls?.genre?.name);
  const subGenre = pickFirstTruthy(cls?.subGenre?.name);

  const canonicalGenreKeys = normalizeGenreKeys([subGenre, genre, segment], 2);

  const canonicalGenres = canonicalGenreKeys
    .map((key) => genreKeyToLabel(key))
    .filter((v): v is string => !!v);

  const canonicalGenre = canonicalGenres[0] || null;

  const flags = {
    isUpsellLike: isNoiseLike(rawName),
    isParkingLike: /\bparking\b|\bgarage\b|\blot\b/i.test(rawName),
    isResaleLike: /\bresale\b/i.test(rawName),
  };

  const titleCore = stripNoiseTokens(rawName, segment);
  const canonicalTitle = normalizeMatchupText(titleCore);

  const strictPlace = lowerAlnum(venueName || city);
  const softPlace = lowerAlnum(city);

  const canonicalKey = [localDate, canonicalTitle, strictPlace].join("|");
  const semanticKey = [localDate, canonicalTitle, softPlace, localTime || ""].join("|");

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

    canonicalGenre,
    canonicalGenres,
    canonicalGenreKeys,
    pillLabel: canonicalGenre,

    canonicalKey,
    semanticKey,
    qualityScore: qualityScoreFrom(tm),

    flags,

    matched: {
      favorites: [],
      attractionIds: [],
      genres: [],
      defaultGenres: [],
    },
  };
}