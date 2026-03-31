export const GENRE_POPULARITY_ORDER = [
  "Football",
  "Basketball",
  "Baseball",
  "Hockey",
  "Soccer",
  "Motorsports",
  "Combat Sports",
  "Horse Racing",
  "Golf",
  "Tennis",

  "Country",
  "Rock",
  "Pop",
  "Hip-Hop/Rap",
  "Electronic",
  "R&B",
  "Metal",
  "Latin",
  "Jazz",
  "Blues",
  "Classical",
  "Comedy",
  "Theatre",
];

export function sortGenresByPopularity(a: string, b: string) {
  const ai = GENRE_POPULARITY_ORDER.indexOf(a);
  const bi = GENRE_POPULARITY_ORDER.indexOf(b);

  const ar = ai === -1 ? 999 : ai;
  const br = bi === -1 ? 999 : bi;

  if (ar !== br) return ar - br;

  return a.localeCompare(b);
}