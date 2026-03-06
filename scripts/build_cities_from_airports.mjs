// scripts/build_cities_from_airports.mjs
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const IN_FILE = path.join(ROOT, "data", "airports.json");

// Output metros-only (Option A)
const OUT_FILE = path.join(ROOT, "public", "cities.json");

// Optional override rules to merge multiple cities into a metro
const OVERRIDES_FILE = path.join(ROOT, "data", "metro_overrides.json");

// Prefer large airports over medium when multiple airports map to the same city
function rankAirportType(t) {
  const s = String(t || "").toLowerCase();
  if (s === "large_airport") return 2;
  if (s === "medium_airport") return 1;
  return 0;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function regionShort(region) {
  const s = String(region || "").trim();
  if (!s) return "";
  return s.includes("-") ? s.split("-")[1] : s;
}

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
  }
  return null;
}

function normStr(x) {
  return String(x ?? "").trim();
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function keyCity({ country, region, city }) {
  const c = normStr(country).toUpperCase();
  const r = normStr(region).toUpperCase();
  const t = normStr(city).toLowerCase();
  return `${c}|${r}|${t}`;
}

function safeReadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function main() {
  if (!fs.existsSync(IN_FILE)) {
    console.error(`Missing ${IN_FILE}`);
    process.exit(1);
  }

  const parsed = JSON.parse(fs.readFileSync(IN_FILE, "utf8"));

  // Accept: [] or {airports: []} or {data: []}
  const airports = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.airports)
    ? parsed.airports
    : Array.isArray(parsed?.data)
    ? parsed.data
    : [];

  if (!Array.isArray(airports) || airports.length === 0) {
    console.error("No airports found in data/airports.json (expected a JSON array or {airports:[...]}).");
    process.exit(1);
  }

  // 1) Build "city candidates" keyed by country|region|city (lowercased city)
  const byCityKey = new Map();

  for (const a of airports) {
    if (!a || typeof a !== "object") continue;

    const city = normStr(pick(a, "city", "town", "municipality"));
    const country = normStr(pick(a, "country", "countryCode")).toUpperCase();

    // region can be "US-CA" or just "CA" depending on input
    const regRaw = pick(a, "region", "state", "province", "iso_region");
    const region = regionShort(regRaw).toUpperCase();

    const iata = normStr(pick(a, "iata", "IATA", "iata_code")).toUpperCase();

    const lat = toNum(pick(a, "lat", "latitude", "latitude_deg"));
    const lon = toNum(pick(a, "lon", "lng", "longitude", "longitude_deg"));

    if (!city || !country) continue;
    if (lat === null || lon === null) continue;

    const cityKey = keyCity({ country, region, city });

    const candidate = {
      country,
      region,
      city,
      // For fallback metros that remain 1:1 with city
      id: `metro_${slugify(`${city}_${region || country}`)}`,
      label: `${city}${region ? `, ${region}` : ""}`,
      center: { lat, lon },
      // We'll accumulate multiple possible aliases later
      aliases: [city],
      airportIata: iata || null,
      airportType: normStr(pick(a, "type", "airportType", "airport_type")).toLowerCase() || null,
    };

    const existing = byCityKey.get(cityKey);
    if (!existing) {
      byCityKey.set(cityKey, candidate);
      continue;
    }

    // prefer large > medium > other for the representative record
    const candRank = rankAirportType(candidate.airportType);
    const existRank = rankAirportType(existing.airportType);

    if (candRank > existRank) {
      // keep aliases accumulated
      candidate.aliases = Array.from(new Set([...(existing.aliases || []), ...(candidate.aliases || [])]));
      byCityKey.set(cityKey, candidate);
      continue;
    }

    // tie-break: prefer one that has IATA
    if (candRank === existRank) {
      const candHasIata = !!candidate.airportIata;
      const existHasIata = !!existing.airportIata;
      if (candHasIata && !existHasIata) {
        candidate.aliases = Array.from(new Set([...(existing.aliases || []), ...(candidate.aliases || [])]));
        byCityKey.set(cityKey, candidate);
        continue;
      }
    }

    // otherwise just add city alias if missing
    existing.aliases = Array.from(new Set([...(existing.aliases || []), city]));
  }

  const cityCandidates = Array.from(byCityKey.values());

  // 2) Load metro overrides (merge rules)
  const overrides = safeReadJson(OVERRIDES_FILE, []);
  const overrideList = Array.isArray(overrides) ? overrides : [];

  // Map member cityKey -> override metro id
  const memberToMetro = new Map();
  for (const m of overrideList) {
    if (!m || typeof m !== "object") continue;
    const metroId = String(m.id || "").trim();
    if (!metroId) continue;

    const members = Array.isArray(m.members) ? m.members : [];
    for (const mem of members) {
      const ck = keyCity({
        country: normStr(mem?.country).toUpperCase(),
        region: normStr(mem?.region).toUpperCase(),
        city: normStr(mem?.city),
      });
      if (ck.includes("||") || ck.endsWith("|")) continue;
      memberToMetro.set(ck, metroId);
    }
  }

  // 3) Aggregate into metros
  const metrosById = new Map();

  function ensureMetroFromOverride(m) {
    const id = String(m.id).trim();
    if (metrosById.has(id)) return metrosById.get(id);

    const metro = {
      id,
      label: String(m.label || id),
      kind: "metro",
      country: String(m.country || "").toUpperCase(),
      region: m.region ? String(m.region).toUpperCase() : undefined,
      center: {
        lat: Number(m.center?.lat),
        lon: Number(m.center?.lon),
      },
      aliases: Array.from(new Set([String(m.label || ""), ...(m.aliases || [])].filter(Boolean))),
      airportIata: null,
    };

    metrosById.set(id, metro);
    return metro;
  }

  // Seed all overrides first (so center/label are fixed)
  for (const m of overrideList) {
    if (!m?.id) continue;
    ensureMetroFromOverride(m);
  }

  for (const c of cityCandidates) {
    const ck = keyCity({ country: c.country, region: c.region, city: c.city });
    const overrideMetroId = memberToMetro.get(ck);

    if (overrideMetroId) {
      // merge into override-defined metro
      const def = overrideList.find((x) => x?.id === overrideMetroId);
      const metro = ensureMetroFromOverride(def || { id: overrideMetroId, label: overrideMetroId, country: c.country });

      // absorb aliases (city names, etc.)
      metro.aliases = Array.from(new Set([...(metro.aliases || []), ...(c.aliases || []), c.city].filter(Boolean)));

      // pick best IATA among members: prefer if metro doesn't have one yet
      if (!metro.airportIata && c.airportIata) metro.airportIata = c.airportIata;

      continue;
    }

    // fallback: 1:1 metro for that city
    const id = c.id;
    if (!metrosById.has(id)) {
      metrosById.set(id, {
        id,
        label: c.label,
        kind: "metro",
        country: c.country,
        region: c.region || undefined,
        center: c.center,
        aliases: Array.from(new Set([c.label, ...(c.aliases || []), c.city].filter(Boolean))),
        airportIata: c.airportIata || null,
      });
    } else {
      const metro = metrosById.get(id);
      metro.aliases = Array.from(new Set([...(metro.aliases || []), ...(c.aliases || []), c.city].filter(Boolean)));
      if (!metro.airportIata && c.airportIata) metro.airportIata = c.airportIata;
    }
  }

  // 4) Final metros-only list
  const metros = Array.from(metrosById.values())
    .filter((m) => Number.isFinite(m.center?.lat) && Number.isFinite(m.center?.lon))
    .map((m) => ({
      id: m.id,
      label: m.label,
      kind: "metro",
      country: m.country,
      region: m.region,
      center: { lat: m.center.lat, lon: m.center.lon },
      aliases: (m.aliases || []).filter(Boolean),
      airportIata: m.airportIata || null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Ensure output dir exists
  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(OUT_FILE, JSON.stringify(metros, null, 2), "utf8");
  console.log(`Built ${metros.length} metros -> ${OUT_FILE}`);
  console.log("Sample:", metros.slice(0, 10));
}

main();