/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";

import { normalizeGenres } from "@/lib/events/genres";

type Row = {
  id: string;
  label: string;
  genres: string[];
};

const FILE = path.join(process.cwd(), "data/artist_options.json");

function norm(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isGarbageLabel(label: string) {
  const l = norm(label);

  return (
    // obvious event / promo patterns
    /\b(outing|scramble|tournament|open|classic|cup|showcase|expo|festival|experience)\b/.test(l) ||

    // venue / package / upsell junk
    /\b(hotel|package|vip|upgrade|reservation|admission)\b/.test(l) ||

    // golf-specific junk (very common pollution)
    (l.includes("golf") && !l.includes("tour")) ||

    // long titles = usually events
    l.length > 60
  );
}

function isTribute(genres: string[], label: string) {
  const g = genres.join(" ").toLowerCase();
  const l = label.toLowerCase();

  return (
    g.includes("tribute") ||
    /\b(tribute|experience|vs|featuring|feat)\b/.test(l)
  );
}

function hasValidGenre(genres: string[]) {
  const normalized = normalizeGenres(genres || [], 2);
  return normalized.length > 0;
}

function isAllowedGenre(genres: string[]) {
  const g = genres.join(" ").toLowerCase();

  return (
    g.includes("music") ||
    g.includes("rock") ||
    g.includes("country") ||
    g.includes("hip hop") ||
    g.includes("rap") ||
    g.includes("pop") ||
    g.includes("r&b") ||
    g.includes("comedy")
  );
}

function isValid(row: Row) {
  if (!row.id || !row.label) return false;

  if (!hasValidGenre(row.genres)) return false;

  if (!isAllowedGenre(row.genres)) return false;

  if (isGarbageLabel(row.label)) return false;

  if (isTribute(row.genres, row.label)) return false;

  return true;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as Row[];

  const before = raw.length;

  const cleaned = raw.filter(isValid);

  const after = cleaned.length;

  fs.writeFileSync(FILE, JSON.stringify(cleaned, null, 2));

  console.log(`Cleaned artist_options.json`);
  console.log(`Before: ${before}`);
  console.log(`After:  ${after}`);
  console.log(`Removed: ${before - after}`);
}

main();