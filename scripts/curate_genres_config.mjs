// FILE: scripts/curate_genres_config.mjs
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "genres_config.json");

const MUSIC_ALLOW = new Set([
  "Alternative",
  "Ballads/Romantic",
  "Blues",
  "Chanson Francaise",
  "Children's Music",
  "Classical",
  "Country",
  "Dance/Electronic",
  "Folk",
  "Hip-Hop/Rap",
  "Jazz",
  "Latin",
  "Metal",
  "New Age",
  "Opera",
  "Pop",
  "R&B",
  "Reggae",
  "Rock",
  "Urban",
  "World"
]);

const SPORTS_ALLOW = new Set([
  "Aquatics",
  "Athletic Races",
  "Badminton",
  "Bandy",
  "Baseball",
  "Basketball",
  "Biathlon",
  "Body Building",
  "Boxing",
  "Cheerleading",
  "Cricket",
  "Curling",
  "Cycling",
  "Diving",
  "eSports",
  "Equestrian",
  "Extreme",
  "Field Hockey",
  "Fitness",
  "Floorball",
  "Football",
  "Golf",
  "Gymnastics",
  "Handball",
  "Hockey",
  "Ice Skating",
  "Indoor Soccer",
  "Lacrosse",
  "Martial Arts",
  "Motorsports/Racing",
  "Netball",
  "Padel",
  "Pickleball",
  "Ringuette",
  "Rodeo",
  "Roller Derby",
  "Roller Hockey",
  "Rugby",
  "Ski Jumping",
  "Skiing",
  "Soccer",
  "Softball",
  "Squash",
  "Surfing",
  "Swimming",
  "Table Tennis",
  "Tennis",
  "Track & Field",
  "Volleyball",
  "Waterpolo",
  "Wrestling"
]);

function norm(s) {
  return String(s || "").trim();
}

function keepOnly(entries, allowSet) {
  const kept = [];
  for (const e of entries || []) {
    const name = norm(e?.name);
    if (!name) continue;
    if (allowSet.has(name)) kept.push({ name, enabled: true });
  }
  // Keep stable ordering: put “top picks” first if you want by manually ordering allow sets
  return kept;
}

const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));

const next = {
  ...raw,
  meta: {
    ...raw.meta,
    curatedAt: new Date().toISOString(),
    notes:
      (raw.meta?.notes || "") +
      " | Curated: removed cross-contamination (music from sports, sports from music)."
  },
  music: { entries: keepOnly(raw.music?.entries, MUSIC_ALLOW) },
  sports: { entries: keepOnly(raw.sports?.entries, SPORTS_ALLOW) }
};

// keep aliases (you already had some good ones)
next.aliases = next.aliases || {
  "Hip-Hop/Rap": "Hip-Hop",
  "R&B": "R&B/Soul",
  "Dance/Electronic": "Electronic"
};

fs.writeFileSync(FILE, JSON.stringify(next, null, 2), "utf8");
console.log("Updated:", FILE);
console.log("music entries:", next.music.entries.length);
console.log("sports entries:", next.sports.entries.length);