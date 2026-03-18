// FILE: lib/events/genres.ts

export type GenreBucket = "sports" | "music";

export type GenreKey =
  | "baseball"
  | "basketball"
  | "hockey"
  | "football"
  | "soccer"
  | "golf"
  | "tennis"
  | "combat_sports"
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
  bucket: GenreBucket;
  visible: boolean;
  aliases: string[];
};

export const GENRES: Record<GenreKey, GenreDef> = {
  baseball: {
    key: "baseball",
    label: "Baseball",
    bucket: "sports",
    visible: true,
    aliases: [
      "baseball",
      "mlb",
      "milb",
      "minor league baseball",
      "college baseball",
      "ncaa baseball",
    ],
  },

  basketball: {
    key: "basketball",
    label: "Basketball",
    bucket: "sports",
    visible: true,
    aliases: [
      "basketball",
      "nba",
      "wnba",
      "college basketball",
      "ncaa basketball",
    ],
  },

  hockey: {
    key: "hockey",
    label: "Hockey",
    bucket: "sports",
    visible: true,
    aliases: [
      "hockey",
      "nhl",
      "ahl",
      "echl",
      "chl",
      "whl",
      "ohl",
      "qmjhl",
      "college hockey",
      "ncaa hockey",
    ],
  },

  football: {
    key: "football",
    label: "Football",
    bucket: "sports",
    visible: true,
    aliases: [
      "football",
      "nfl",
      "cfl",
      "ufl",
      "college football",
      "ncaa football",
    ],
  },

  soccer: {
    key: "soccer",
    label: "Soccer",
    bucket: "sports",
    visible: true,
    aliases: [
      "soccer",
      "mls",
      "nwsl",
      "usl",
      "fifa",
      "concacaf",
    ],
  },

  golf: {
    key: "golf",
    label: "Golf",
    bucket: "sports",
    visible: true,
    aliases: [
      "golf",
      "pga",
      "lpga",
      "champions tour",
    ],
  },

  tennis: {
    key: "tennis",
    label: "Tennis",
    bucket: "sports",
    visible: true,
    aliases: [
      "tennis",
      "atp",
      "wta",
      "grand slam",
    ],
  },

  combat_sports: {
    key: "combat_sports",
    label: "Combat Sports",
    bucket: "sports",
    visible: true,
    aliases: [
      "combat sports",
      "mma",
      "mixed martial arts",
      "ufc",
      "boxing",
      "wrestling",
      "pro wrestling",
      "professional wrestling",
      "wwe",
      "aew",
      "martial arts",
      "kickboxing",
      "muay thai",
      "grappling",
      "jiu jitsu",
      "bjj",
    ],
  },

  motorsports: {
    key: "motorsports",
    label: "Motorsports",
    bucket: "sports",
    visible: true,
    aliases: [
      "motorsports",
      "motor sports",
      "racing",
      "auto racing",
      "auto-racing",
      "motocross",
      "supercross",
      "nascar",
      "indy",
      "indycar",
      "formula 1",
      "formula one",
      "f1",
      "drag racing",
      "monster truck",
      "monster trucks",
    ],
  },

  country: {
    key: "country",
    label: "Country",
    bucket: "music",
    visible: true,
    aliases: [
      "country",
      "bluegrass",
      "americana",
      "folk",
      "contemporary country",
      "outlaw country",
      "country pop",
      "country rock",
    ],
  },

  rock: {
    key: "rock",
    label: "Rock",
    bucket: "music",
    visible: true,
    aliases: [
      "rock",
      "rock & roll",
      "rock and roll",
      "alternative",
      "alternative rock",
      "alt rock",
      "indie rock",
      "punk",
      "punk rock",
      "hard rock",
      "southern rock",
      "classic rock",
      "grunge",
    ],
  },

  pop: {
    key: "pop",
    label: "Pop",
    bucket: "music",
    visible: true,
    aliases: [
      "pop",
      "dance pop",
      "teen pop",
      "adult contemporary",
    ],
  },

  hip_hop: {
    key: "hip_hop",
    label: "Hip-Hop/Rap",
    bucket: "music",
    visible: true,
    aliases: [
      "hip hop",
      "hip-hop",
      "hip hop/rap",
      "hip-hop/rap",
      "rap",
      "trap",
      "urban",
      "party rap",
      "drill",
    ],
  },

  metal: {
    key: "metal",
    label: "Metal",
    bucket: "music",
    visible: true,
    aliases: [
      "metal",
      "heavy metal",
      "death metal",
      "black metal",
      "thrash metal",
      "metalcore",
      "hardcore",
    ],
  },

  jazz: {
    key: "jazz",
    label: "Jazz",
    bucket: "music",
    visible: true,
    aliases: [
      "jazz",
      "big band",
      "ragtime",
      "swing",
      "smooth jazz",
      "fusion",
      "jazz-rock",
      "jazz rock",
    ],
  },

  blues: {
    key: "blues",
    label: "Blues",
    bucket: "music",
    visible: true,
    aliases: [
      "blues",
      "delta blues",
      "electric blues",
    ],
  },

  rnb: {
    key: "rnb",
    label: "R&B",
    bucket: "music",
    visible: true,
    aliases: [
      "r&b",
      "rnb",
      "r&b/soul",
      "soul",
      "funk",
      "neo soul",
      "contemporary r&b",
    ],
  },

  electronic: {
    key: "electronic",
    label: "Electronic",
    bucket: "music",
    visible: true,
    aliases: [
      "electronic",
      "edm",
      "dance",
      "dance/electronic",
      "house",
      "techno",
      "trance",
      "dubstep",
      "electronica",
    ],
  },

  latin: {
    key: "latin",
    label: "Latin",
    bucket: "music",
    visible: true,
    aliases: [
      "latin",
      "reggaeton",
      "regional mexican",
      "corridos",
      "tejano",
      "bachata",
      "salsa",
      "latin pop",
    ],
  },

  classical: {
    key: "classical",
    label: "Classical",
    bucket: "music",
    visible: true,
    aliases: [
      "classical",
      "opera",
      "symphonic",
      "symphony",
      "orchestral",
      "orchestra",
      "chamber music",
      "new age",
    ],
  },

  theatre: {
    key: "theatre",
    label: "Theatre",
    bucket: "music",
    visible: true,
    aliases: [
      "theatre",
      "theater",
      "musical",
      "cabaret",
      "broadway",
      "performance art",
      "performance arts",
    ],
  },

  comedy: {
    key: "comedy",
    label: "Comedy",
    bucket: "music",
    visible: true,
    aliases: [
      "comedy",
      "comedian",
      "stand-up",
      "stand up",
      "improv",
      "drag",
    ],
  },

  religious: {
    key: "religious",
    label: "Religious",
    bucket: "music",
    visible: false,
    aliases: [
      "religious",
      "gospel",
      "christian",
      "christian rock",
      "worship",
    ],
  },

  other: {
    key: "other",
    label: "Other",
    bucket: "music",
    visible: false,
    aliases: [
      "other",
      "miscellaneous",
      "community/civic",
      "community civic",
      "community",
      "civic",
      "equestrian",
      "horse racing",
      "rodeo",
      "lacrosse",
    ],
  },
};

function norm(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENRE_LIST = Object.values(GENRES);

const LABEL_TO_KEY = new Map<string, GenreKey>();
const KEY_TO_LABEL = new Map<GenreKey, string>();
const KEY_TO_BUCKET = new Map<GenreKey, GenreBucket>();
const KEY_TO_VISIBLE = new Map<GenreKey, boolean>();

for (const def of GENRE_LIST) {
  LABEL_TO_KEY.set(norm(def.label), def.key);
  KEY_TO_LABEL.set(def.key, def.label);
  KEY_TO_BUCKET.set(def.key, def.bucket);
  KEY_TO_VISIBLE.set(def.key, def.visible);
}

const SORTED_ALIAS_RULES: Array<{ alias: string; key: GenreKey }> = GENRE_LIST
  .flatMap((def) => def.aliases.map((alias) => ({ alias: norm(alias), key: def.key })))
  .sort((a, b) => b.alias.length - a.alias.length);

function uniqueKeys(keys: GenreKey[]): GenreKey[] {
  const out: GenreKey[] = [];
  const seen = new Set<GenreKey>();

  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out;
}

function scoreGenreMatches(value: string): GenreKey[] {
  const hits: GenreKey[] = [];

  for (const rule of SORTED_ALIAS_RULES) {
    if (!rule.alias) continue;
    if (!value.includes(rule.alias)) continue;
    hits.push(rule.key);
  }

  return uniqueKeys(hits);
}

export function genreKeyToLabel(key: GenreKey | null | undefined): string | null {
  if (!key) return null;
  return KEY_TO_LABEL.get(key) || null;
}

export function genreKeyToBucket(key: GenreKey | null | undefined): GenreBucket | null {
  if (!key) return null;
  return KEY_TO_BUCKET.get(key) || null;
}

export function isVisibleGenreKey(key: GenreKey | null | undefined): boolean {
  if (!key) return false;
  return !!KEY_TO_VISIBLE.get(key);
}

export function findGenreKeyByLabel(label: string | null | undefined): GenreKey | null {
  const key = LABEL_TO_KEY.get(norm(label || ""));
  return key || null;
}

export function genreLabelFromRaw(raw: string | null | undefined): string | null {
  const key = genreKeyFromRaw(raw);
  return key ? genreKeyToLabel(key) : null;
}

export function genreKeyFromRaw(raw: string | null | undefined): GenreKey | null {
  const value = norm(raw || "");
  if (!value) return null;

  const hits = scoreGenreMatches(value);
  if (hits.length === 0) return "other";

  return hits[0] || "other";
}

export function normalizeGenreKeys(
  values: Array<string | null | undefined>,
  max = 2
): GenreKey[] {
  const keys: GenreKey[] = [];

  for (const raw of values) {
    const value = norm(raw || "");
    if (!value) continue;

    const hits = scoreGenreMatches(value);
    if (hits.length === 0) continue;

    for (const key of hits) {
      if (!isVisibleGenreKey(key)) continue;
      keys.push(key);
    }
  }

  return uniqueKeys(keys).slice(0, Math.max(1, max));
}

export function normalizeGenres(
  values: Array<string | null | undefined>,
  max = 2
): string[] {
  return normalizeGenreKeys(values, max)
    .map((key) => genreKeyToLabel(key))
    .filter((v): v is string => !!v);
}

export function includesGenre(
  values: Array<string | null | undefined>,
  target: string | null | undefined
): boolean {
  const targetKey = findGenreKeyByLabel(target);
  if (!targetKey) return false;

  const keys = normalizeGenreKeys(values, 2);
  return keys.includes(targetKey);
}

export function allVisibleGenreLabels(): string[] {
  return GENRE_LIST.filter((g) => g.visible).map((g) => g.label);
}

export function visibleGenresByBucket(): Record<GenreBucket, string[]> {
  return {
    sports: GENRE_LIST.filter((g) => g.visible && g.bucket === "sports").map((g) => g.label),
    music: GENRE_LIST.filter((g) => g.visible && g.bucket === "music").map((g) => g.label),
  };
}