// FILE: lib/favorites/seriesMatchers.ts

import type { SeriesKey } from "@/lib/favorites/types";

function normText(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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

export function seriesKeywords(seriesKey: SeriesKey): string[] {
  switch (seriesKey) {
    case "f1":
      return ["Formula 1", "F1", "Grand Prix"];
    case "nascar":
      return ["NASCAR", "Cup Series", "Xfinity Series", "Craftsman Truck Series"];
    
case "indy":
  return [
    "IndyCar",
    "Indycar",
    "NTT IndyCar Series",
    "Indianapolis 500",
    "Indy 500",
    "Grand Prix",
  ];

    case "pga":
      return ["PGA Tour", "PGA", "Open Championship", "Masters", "Players Championship"];
    case "lpga":
      return ["LPGA", "Ladies Professional Golf Association"];
    case "liv":
      return ["LIV Golf", "LIV"];
    case "tgl":
      return ["TGL"];
    case "ufc":
      return ["UFC", "Ultimate Fighting Championship"];
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
      ];
    case "wta":
      return ["WTA Tour", "WTA", "Open"];
    default:
      return [];
  }
}

function getClassificationNames(tm: any): string[] {
  const classifications = Array.isArray(tm?.classifications)
    ? tm.classifications
    : Array.isArray(tm?.classifications?.[0])
    ? tm.classifications
    : Array.isArray(tm?._embedded?.classifications)
    ? tm._embedded.classifications
    : Array.isArray(tm?.classifications)
    ? tm.classifications
    : [];

  const parts: string[] = [];

  for (const c of classifications || []) {
    parts.push(String(c?.segment?.name || ""));
    parts.push(String(c?.genre?.name || ""));
    parts.push(String(c?.subGenre?.name || ""));
    parts.push(String(c?.type?.name || ""));
    parts.push(String(c?.subType?.name || ""));
  }

  return parts.filter(Boolean);
}

export function getTMEventSearchText(tm: any) {
  const parts: string[] = [];

  parts.push(String(tm?.name || ""));

  const attractions = Array.isArray(tm?._embedded?.attractions) ? tm._embedded.attractions : [];
  const venues = Array.isArray(tm?._embedded?.venues) ? tm._embedded.venues : [];

  for (const a of attractions) {
    parts.push(String(a?.name || ""));
    parts.push(String(a?.type || ""));
  }

  for (const v of venues) {
    parts.push(String(v?.name || ""));
    parts.push(String(v?.city?.name || ""));
    parts.push(String(v?.state?.name || ""));
    parts.push(String(v?.country?.name || ""));
  }

  for (const c of getClassificationNames(tm)) {
    parts.push(c);
  }

  parts.push(String(tm?.promoter?.name || ""));
  parts.push(String(tm?.pleaseNote || ""));
  parts.push(String(tm?.info || ""));

  return normText(uniqueStrings(parts).join(" | "));
}

const F1_LOCATION_TOKENS = [
  "miami",
  "montreal",
  "canada",
  "canadian",
  "monaco",
  "silverstone",
  "british",
  "monza",
  "italian",
  "spa",
  "belgian",
  "suzuka",
  "japanese",
  "austin",
  "cota",
  "united states",
  "las vegas",
  "vegas",
  "mexico city",
  "mexican",
  "sao paulo",
  "brazilian",
  "interlagos",
  "melbourne",
  "australian",
  "singapore",
  "abu dhabi",
  "yas marina",
  "jeddah",
  "saudi",
  "bahrain",
  "sakhir",
  "budapest",
  "hungarian",
  "barcelona",
  "spanish",
  "zandvoort",
  "dutch",
  "imola",
  "emilia-romagna",
  "baku",
  "azerbaijan",
  "shanghai",
  "chinese",
  "qatar",
  "lusail",
];

const F1_NEGATIVE_TOKENS = [
  "nascar",
  "indycar",
  "indy car",
  "motogp",
  "moto gp",
  "nhra",
  "supercross",
  "motocross",
  "monster jam",
  "horse racing",
  "cycling",
  "sprint car",
  "drag racing",
  "formula drift",
  "formula e",
  "karting",
  "go-kart",
];

function countTokenHits(text: string, tokens: string[]) {
  let hits = 0;
  for (const token of tokens) {
    if (text.includes(token)) hits += 1;
  }
  return hits;
}

function scoreF1TMEvent(tm: any): number {
  const text = getTMEventSearchText(tm);
  let score = 0;

  if (!text) return -999;

  for (const bad of F1_NEGATIVE_TOKENS) {
    if (text.includes(bad)) return -999;
  }

  const hasFormula1 = text.includes("formula 1");
  const hasF1 = /\bf1\b/.test(text);
  const hasGrandPrix = text.includes("grand prix");
  const locationHits = countTokenHits(text, F1_LOCATION_TOKENS);

  const hasCanadianGpPattern =
    text.includes("grand prix du canada") ||
    text.includes("canadian grand prix") ||
    text.includes("prix du canada");

  if (hasFormula1) score += 10;
  if (hasF1) score += 8;
  if (hasGrandPrix) score += 2;

  if (locationHits > 0) score += 3;
  if (locationHits > 1) score += 2;

  if (hasCanadianGpPattern) score += 8;

  const hasStrongIdentity = hasFormula1 || hasF1 || hasCanadianGpPattern;

  if (!hasStrongIdentity) {
    return -999;
  }

  return score;
}

function matchesNascarTMEvent(tm: any) {
  const text = getTMEventSearchText(tm);
  if (!text) return false;
  if (text.includes("formula 1") || /\bf1\b/.test(text)) return false;
  if (text.includes("indycar") || text.includes("indy car")) return false;
  return text.includes("nascar") || text.includes("cup series") || text.includes("xfinity series") || text.includes("craftsman truck");
}

const INDY_LOCATION_TOKENS = [
  "indianapolis",
  "st. petersburg",
  "long beach",
  "toronto",
  "detroit",
  "wwt raceway",
  "world wide technology raceway",
  "milwaukee mile",
  "nashville superspeedway",
];

const INDY_NEGATIVE_TOKENS = [
  "formula 1",
  "nascar",
  "motogp",
  "moto gp",
  "nhra",
  "supercross",
  "formula e",
  "monster jam",
  "equine",
  "fei",
  "horse",
  "ncaa",
  "symphony",
  "concert",
  "comedy",
];

function scoreIndyTMEvent(tm: any): number {
  const text = getTMEventSearchText(tm);
  let score = 0;

  if (!text) return -999;

  for (const bad of INDY_NEGATIVE_TOKENS) {
    if (text.includes(bad)) return -999;
  }

  const hasIndyCar =
    text.includes("indycar") ||
    text.includes("indy car") ||
    text.includes("ntt indycar");

  const hasIndy500 =
    text.includes("indianapolis 500") ||
    /\bindy 500\b/.test(text);

  const hasGrandPrix = text.includes("grand prix");
  const has500 = /\b500\b/.test(text);
  const locationHits = countTokenHits(text, INDY_LOCATION_TOKENS);

  const hasKnownIndyWeekendPattern =
    text.includes("acura grand prix of long beach") ||
    text.includes("long beach grand prix") ||
    text.includes("detroit grand prix") ||
    text.includes("grand prix of st. petersburg") ||
    text.includes("st. petersburg grand prix") ||
    text.includes("honda indy toronto") ||
    text.includes("sonsio grand prix") ||
    text.includes("bommarito automotive group 500") ||
    text.includes("indianapolis 500") ||
    /\bindy 500\b/.test(text) ||
    (hasGrandPrix && locationHits > 0) ||
    (has500 && (
      text.includes("bommarito") ||
      text.includes("gateway") ||
      text.includes("wwt raceway") ||
      text.includes("world wide technology raceway") ||
      text.includes("milwaukee mile")
    ));

  if (hasIndyCar) score += 10;
  if (hasIndy500) score += 10;
  if (hasGrandPrix) score += 2;
  if (has500) score += 2;
  if (locationHits > 0) score += 3;
  if (hasKnownIndyWeekendPattern) score += 8;

  const hasStrongIdentity =
    hasIndyCar ||
    hasIndy500 ||
    hasKnownIndyWeekendPattern;

  if (!hasStrongIdentity) {
    return -999;
  }

  return score;
}

function matchesIndyTMEvent(tm: any): boolean {
  return scoreIndyTMEvent(tm) >= 8;
}

function matchesPGATMEvent(tm: any) {
  const text = getTMEventSearchText(tm);
  if (!text) return false;
  if (text.includes("lpga")) return false;
  if (text.includes("liv golf")) return false;
  if (/\btgl\b/.test(text)) return false;
  return text.includes("pga") || text.includes("pga tour");
}

function matchesLPGATMEvent(tm: any) {
  const text = getTMEventSearchText(tm);
  if (!text) return false;

  if (text.includes("liv golf")) return false;
  if (/\btgl\b/.test(text)) return false;

  const hasDirectLPGA =
    text.includes("lpga") ||
    text.includes("ladies professional golf association");

  const hasKnownLPGAEvent =
    text.includes("cpkc women's open") ||
    text.includes("chevron championship") ||
    text.includes("amundi evian championship") ||
    text.includes("aig women's open") ||
    text.includes("founders cup") ||
    text.includes("mizuho americas open") ||
    text.includes("women's pga championship") ||
    text.includes("hilton grand vacations tournament of champions");

  const looksLikeMensOnly =
    (text.includes("pga") || text.includes("pga tour")) &&
    !text.includes("women") &&
    !text.includes("women's");

  if (looksLikeMensOnly) return false;

  return hasDirectLPGA || hasKnownLPGAEvent;
}

function matchesLIVTMEvent(tm: any) {
  const text = getTMEventSearchText(tm);
  if (!text) return false;
  return text.includes("liv golf") || /\bliv\b/.test(text);
}

function matchesTGLTMEvent(tm: any) {
  const text = getTMEventSearchText(tm);
  if (!text) return false;
  return /\btgl\b/.test(text);
}

function matchesUFCTMEvent(tm: any) {
  const text = getTMEventSearchText(tm);
  if (!text) return false;
  return /\bufc\b/.test(text) || text.includes("ultimate fighting championship");
}

function matchesATPTMEvent(tm: any) {
  const text = getTMEventSearchText(tm);
  if (!text) return false;

  const hasDirectATP =
    text.includes("atp") ||
    text.includes("atp tour") ||
    text.includes("atp masters 1000") ||
    text.includes("atp 500") ||
    text.includes("atp 250");

  const hasKnownATPEvent =
    text.includes("national bank open") ||
    text.includes("bnp paribas open") ||
    text.includes("miami open") ||
    text.includes("cincinnati open") ||
    text.includes("canadian open tennis") ||
    text.includes("dallas open") ||
    text.includes("mubadala citi dc open") ||
    text.includes("rolex shanghai masters") ||
    text.includes("paris masters") ||
    text.includes("monte-carlo masters") ||
    text.includes("italian open tennis") ||
    text.includes("madrid open tennis");

  const isClearlyWomenOnly =
    !hasDirectATP &&
    !hasKnownATPEvent &&
    (
      text.includes("wta") ||
      text.includes("women's tennis") ||
      text.includes("womens tennis") ||
      text.includes("itf women's")
    );

  if (isClearlyWomenOnly) return false;

  return hasDirectATP || hasKnownATPEvent;
}

function matchesWTATMEvent(tm: any) {
  const text = getTMEventSearchText(tm);
  if (!text) return false;
  if (text.includes("atp")) return false;
  return text.includes("wta");
}

export function matchesSeriesTMEvent(seriesKey: SeriesKey, tm: any): boolean {
  switch (seriesKey) {
    case "f1":
      return scoreF1TMEvent(tm) >= 8;
    case "nascar":
      return matchesNascarTMEvent(tm);
    case "indy":
      return matchesIndyTMEvent(tm);
    case "pga":
      return matchesPGATMEvent(tm);
    case "lpga":
      return matchesLPGATMEvent(tm);
    case "liv":
      return matchesLIVTMEvent(tm);
    case "tgl":
      return matchesTGLTMEvent(tm);
    case "ufc":
      return matchesUFCTMEvent(tm);
    case "atp":
      return matchesATPTMEvent(tm);
    case "wta":
      return matchesWTATMEvent(tm);
    default:
      return true;
  }
}

export function filterTMEventsForSeries(seriesKey: SeriesKey, events: any[]) {
  return (events || []).filter((tm) => matchesSeriesTMEvent(seriesKey, tm));
}