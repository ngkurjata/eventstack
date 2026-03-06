// FILE: scripts/build_genres_from_tm.mjs
import fs from "node:fs";
import path from "node:path";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const KEY = process.env.TICKETMASTER_API_KEY;

if (!KEY) {
  console.error("Missing TICKETMASTER_API_KEY in env");
  process.exit(1);
}

const OUT_RAW = path.join(process.cwd(), "data", "genres_raw.json");
const OUT_CFG = path.join(process.cwd(), "data", "genres_config.json");
const OUT_SAMPLE_MUSIC = path.join(process.cwd(), "data", "tm_classifications_music_sample.json");
const OUT_SAMPLE_SPORTS = path.join(process.cwd(), "data", "tm_classifications_sports_sample.json");

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${txt.slice(0, 250)}`);
  }
  return res.json();
}

function norm(s) {
  return String(s || "").trim();
}

function uniqSort(arr) {
  return Array.from(new Set(arr.map(norm).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

async function fetchSegmentClassifications(segmentName) {
  const url = `${TM_BASE}/classifications.json?segmentName=${encodeURIComponent(
    segmentName
  )}&apikey=${KEY}`;
  const json = await fetchJson(url);
  return json?._embedded?.classifications || [];
}

/**
 * Robustly collect "genre" and "subGenre" names without grabbing every "name" in the tree.
 * TM responses vary; sometimes genre/subGenre are nested under _embedded or other nodes.
 */
function collectGenreLikeNames(root, { includeSubGenres = false } = {}) {
  const genres = [];
  const subGenres = [];

  const seen = new Set();
  const stack = [root];

  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;

    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }

    if (typeof cur !== "object") continue;

    // If there's a "genre" object somewhere with a "name"
    if (cur.genre && typeof cur.genre === "object") {
      const g = norm(cur.genre.name);
      if (g) genres.push(g);
    }

    if (includeSubGenres && cur.subGenre && typeof cur.subGenre === "object") {
      const sg = norm(cur.subGenre.name);
      if (sg) subGenres.push(sg);
    }

    // Some variants use plural arrays
    if (cur.genres && Array.isArray(cur.genres)) {
      for (const g of cur.genres) {
        const n = norm(g?.name);
        if (n) genres.push(n);
      }
    }
    if (includeSubGenres && cur.subGenres && Array.isArray(cur.subGenres)) {
      for (const sg of cur.subGenres) {
        const n = norm(sg?.name);
        if (n) subGenres.push(n);
      }
    }

    // Walk children (but prevent pathological loops)
    const id = cur && typeof cur === "object" ? cur.id : null;
    const key = id ? `id:${id}` : null;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }

    for (const v of Object.values(cur)) stack.push(v);
  }

  return {
    genres: uniqSort(genres),
    subGenres: uniqSort(subGenres)
  };
}

function buildDefaultConfig(raw) {
  const toEntries = (arr) => arr.map((name) => ({ name, enabled: true }));

  return {
    meta: {
      version: "v3",
      builtAt: new Date().toISOString(),
      source: "ticketmaster classifications",
      notes:
        "Order matters. Set enabled=false to hide. Use aliases to merge/rename."
    },
    music: { entries: toEntries(raw.music.genres) },
    sports: { entries: toEntries(raw.sports.genres) },
    aliases: {}
  };
}

async function main() {
  console.log("Building genre lists from Ticketmaster classifications...");

  // keep this false for now; subgenres explode the list
  const INCLUDE_SUBGENRES = false;

  const [musicCls, sportsCls] = await Promise.all([
    fetchSegmentClassifications("Music"),
    fetchSegmentClassifications("Sports")
  ]);

  // Write samples so we can see real structure if needed
  fs.mkdirSync(path.dirname(OUT_SAMPLE_MUSIC), { recursive: true });
  fs.writeFileSync(
    OUT_SAMPLE_MUSIC,
    JSON.stringify({ sample: musicCls.slice(0, 5) }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    OUT_SAMPLE_SPORTS,
    JSON.stringify({ sample: sportsCls.slice(0, 5) }, null, 2),
    "utf8"
  );

  const music = collectGenreLikeNames(musicCls, { includeSubGenres: INCLUDE_SUBGENRES });
  const sports = collectGenreLikeNames(sportsCls, { includeSubGenres: INCLUDE_SUBGENRES });

  const raw = {
    meta: {
      builtAt: new Date().toISOString(),
      source: "ticketmaster classifications",
      includeSubGenres: INCLUDE_SUBGENRES,
      classificationCounts: { music: musicCls.length, sports: sportsCls.length },
      counts: {
        musicGenres: music.genres.length,
        sportsGenres: sports.genres.length,
        musicSubGenres: music.subGenres.length,
        sportsSubGenres: sports.subGenres.length
      }
    },
    music,
    sports
  };

  fs.writeFileSync(OUT_RAW, JSON.stringify(raw, null, 2), "utf8");
  console.log(
    `Wrote ${OUT_RAW} (musicGenres=${music.genres.length}, sportsGenres=${sports.genres.length})`
  );
  console.log(`Wrote samples: ${OUT_SAMPLE_MUSIC} and ${OUT_SAMPLE_SPORTS}`);

  if (!fs.existsSync(OUT_CFG)) {
    const cfg = buildDefaultConfig(raw);
    fs.writeFileSync(OUT_CFG, JSON.stringify(cfg, null, 2), "utf8");
    console.log(`Created ${OUT_CFG} (edit this to curate/order)`);
  } else {
    console.log(`Left existing ${OUT_CFG} unchanged (already present)`);
    console.log(
      "Tip: to regenerate config from the new raw list, rename/delete genres_config.json and rerun."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});