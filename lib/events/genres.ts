// FILE: lib/events/genres.ts

export type GenreKey =
  | "baseball"
  | "basketball"
  | "hockey"
  | "football"
  | "soccer"
  | "golf"
  | "tennis"
  | "mma"
  | "motorsports"
  | "country"
  | "rock"
  | "pop"
  | "hip_hop"
  | "metal"
  | "jazz"
  | "blues"
  | "rnb"
  | "electronic"
  | "latin"
  | "classical"
  | "theatre"
  | "comedy"
  | "religious"
  | "other";

export type GenreDef = {
  key: GenreKey;
  label: string;
  aliases: string[];
};

export const GENRES: Record<GenreKey, GenreDef> = {
  baseball: {
    key: "baseball",
    label: "Baseball",
    aliases: ["baseball", "mlb", "minor league baseball"],
  },
  basketball: {
    key: "basketball",
    label: "Basketball",
    aliases: ["basketball", "nba", "wnba"],
  },
  hockey: {
    key: "hockey",
    label: "Hockey",
    aliases: ["hockey", "nhl", "ahl", "chl", "whl", "ohl", "qmjhl"],
  },
  football: {
    key: "football",
    label: "Football",
    aliases: ["football", "nfl", "cfl", "college football"],
  },
  soccer: {
    key: "soccer",
    label: "Soccer",
    aliases: ["soccer", "mls"],
  },
  golf: {
    key: "golf",
    label: "Golf",
    aliases: ["golf"],
  },
  tennis: {
    key: "tennis",
    label: "Tennis",
    aliases: ["tennis"],
  },
  mma: {
    key: "mma",
    label: "MMA",
    aliases: ["mma", "mixed martial arts", "ufc", "martial arts"],
  },
  motorsports: {
    key: "motorsports",
    label: "Motorsports",
    aliases: [
      "motorsports",
      "motor sports",
      "racing",
      "auto racing",
      "auto-racing",
      "nascar",
      "indy",
      "indycar",
      "formula 1",
      "formula one",
      "f1",
    ],
  },
  country: {
    key: "country",
    label: "Country",
    aliases: ["country", "bluegrass", "americana", "folk"],
  },
  rock: {
    key: "rock",
    label: "Rock",
    aliases: ["rock", "punk", "alt", "alternative", "indie rock", "southern rock"],
  },
  pop: {
    key: "pop",
    label: "Pop",
    aliases: ["pop"],
  },
  hip_hop: {
    key: "hip_hop",
    label: "Hip-Hop/Rap",
    aliases: ["hip hop", "hip-hop", "rap", "trap", "party rap"],
  },
  metal: {
    key: "metal",
    label: "Metal",
    aliases: ["metal", "heavy metal"],
  },
  jazz: {
    key: "jazz",
    label: "Jazz",
    aliases: ["jazz", "big band", "ragtime"],
  },
  blues: {
    key: "blues",
    label: "Blues",
    aliases: ["blues"],
  },
  rnb: {
    key: "rnb",
    label: "R&B",
    aliases: ["r&b", "rnb", "soul", "funk"],
  },
  electronic: {
    key: "electronic",
    label: "Electronic",
    aliases: ["electronic", "edm", "dance"],
  },
  latin: {
    key: "latin",
    label: "Latin",
    aliases: ["latin"],
  },
  classical: {
    key: "classical",
    label: "Classical",
    aliases: ["classical", "opera"],
  },
  theatre: {
    key: "theatre",
    label: "Theatre",
    aliases: ["theatre", "theater", "cabaret", "broadway"],
  },
  comedy: {
    key: "comedy",
    label: "Comedy",
    aliases: ["comedy"],
  },
  religious: {
    key: "religious",
    label: "Religious",
    aliases: ["religious", "gospel"],
  },
  other: {
    key: "other",
    label: "Other",
    aliases: ["other"],
  },
};

function norm(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/*
--------------------------------------------------
Precomputed helpers (faster lookups)
--------------------------------------------------
*/

const GENRE_LIST = Object.values(GENRES);

const LABEL_TO_KEY = new Map<string, GenreKey>();
const ALIAS_TO_KEY = new Map<string, GenreKey>();

for (const def of GENRE_LIST) {
  LABEL_TO_KEY.set(norm(def.label), def.key);

  for (const alias of def.aliases) {
    ALIAS_TO_KEY.set(norm(alias), def.key);
  }
}

/*
--------------------------------------------------
Public helpers
--------------------------------------------------
*/

export function genreLabelFromRaw(raw: string | null | undefined): string | null {
  const value = norm(raw || "");
  if (!value) return null;

  for (const [alias, key] of ALIAS_TO_KEY) {
    if (value.includes(alias)) {
      return GENRES[key].label;
    }
  }

  return "Other";
}

export function findGenreKeyByLabel(label: string | null | undefined): GenreKey | null {
  const key = LABEL_TO_KEY.get(norm(label || ""));
  return key || null;
}

/**
 * Normalize a list of raw genres into canonical EventStack labels.
 */
export function normalizeGenres(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const label = genreLabelFromRaw(raw);
    if (!label) continue;

    const k = norm(label);
    if (seen.has(k)) continue;

    seen.add(k);
    out.push(label);
  }

  return out;
}

/**
 * Safe genre membership check
 */
export function includesGenre(
  values: Array<string | null | undefined>,
  target: string | null | undefined
): boolean {
  const targetKey = findGenreKeyByLabel(target);
  if (!targetKey) return false;

  const normalized = normalizeGenres(values);

  return normalized.some((g) => findGenreKeyByLabel(g) === targetKey);
}

/**
 * Canonical list of genre labels for UI dropdowns.
 */
export function allGenreLabels(): string[] {
  return GENRE_LIST.map((g) => g.label);
}