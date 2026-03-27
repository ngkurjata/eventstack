// FILE: scripts/build_artist_options.mjs
import fs from "node:fs";
import path from "node:path";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const KEY = process.env.TICKETMASTER_API_KEY;

if (!KEY) {
  console.error("Missing TICKETMASTER_API_KEY in env");
  process.exit(1);
}

// Output
const OUT = path.join(process.cwd(), "data", "artist_options.json");

// Tune
const PAGE_SIZE = 200;
const MAX_PAGES = 5;        // pages 0..4 only with size=200
const HARD_CAP = 50000;       // safety cap for total artists
const THROTTLE_MS = 150;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${txt.slice(0, 200)}`);
  }
  return res.json();
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function norm(s) {
  return String(s || "").trim();
}

function pickGenre(a) {
  // Best-effort from TM classifications
  const c = a?.classifications?.[0];
  const g = c?.genre?.name || c?.subGenre?.name || c?.segment?.name || null;
  const out = norm(g);
  return out || null;
}

function toArtistOption(a) {
  const name = norm(a?.name);
  const attractionId = norm(a?.id);

  // This "id" format is stable. If your app expects a different format,
  // we can switch it to match (team:..., artist:..., etc.).
  const id = `artist:tm:${attractionId}:${name}`;

  const genre = pickGenre(a);
  const label = genre ? `${name} — ${genre}` : name;

  return {
    id,
    kind: "artist",
    name,
    label,
    genre: genre || undefined,
    attractionId
  };
}

async function fetchAttractionsPage(page) {
  // We intentionally fetch broad attractions and filter to segment=Music,
  // because TM filtering parameters vary and can be inconsistent.
  const url =
    `${TM_BASE}/attractions.json?` +
    `apikey=${KEY}` +
    `&size=${PAGE_SIZE}` +
    `&page=${page}` +
    `&sort=name,asc`;

  const json = await fetchJson(url);
  const items = json?._embedded?.attractions || [];

  const music = items.filter((a) => {
    const seg = a?.classifications?.[0]?.segment?.name;
    return norm(seg).toLowerCase() === "music";
  });

  return {
    music,
    pageInfo: json?.page || null
  };
}

async function main() {
  console.log("Building artist_options.json from Ticketmaster...");

  let page = 0;
  let all = [];

  let totalPages = null;

  while (page < MAX_PAGES && all.length < HARD_CAP) {
    const { music, pageInfo } = await fetchAttractionsPage(page);

    if (page === 0 && pageInfo?.totalPages != null) {
      totalPages = Number(pageInfo.totalPages);
      console.log(`TM reports totalPages=${totalPages}`);
    }

    all.push(...music);

    page++;

    // Stop if we reached last page
    if (totalPages != null && page >= totalPages) break;

    if (page % 10 === 0) {
      console.log(`...page=${page}, collected=${all.length}`);
    }

    await sleep(THROTTLE_MS);
  }

  // Dedup by attractionId
  all = uniqBy(all, (a) => norm(a?.id));

  // Normalize
  let artists = all.map(toArtistOption);

  // Dedup by (name) too, just in case
  artists = uniqBy(artists, (x) => x.attractionId || x.name.toLowerCase());

  // Sort
  artists.sort((a, b) => a.label.localeCompare(b.label));

  const payload = {
    meta: {
      version: "v1",
      builtAt: new Date().toISOString(),
      source: "ticketmaster",
      pageSize: PAGE_SIZE,
      maxPages: MAX_PAGES,
      hardCap: HARD_CAP,
      collected: artists.length
    },
    artists
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Wrote ${OUT} with ${artists.length} artists`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});