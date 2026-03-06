// scripts/build_airports_from_csv.mjs
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const IN = path.join(ROOT, "data-raw", "airports.csv");
const OUT = path.join(ROOT, "data", "airports.json");

const ALLOWED_COUNTRIES = new Set(["US", "CA"]);
const ALLOWED_TYPES = new Set(["large_airport", "medium_airport"]); // excludes small/private automatically

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }

    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normStr(x) {
  return String(x ?? "").trim();
}

function main() {
  if (!fs.existsSync(IN)) {
    console.error(`Missing ${IN}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(IN, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);

  const header = splitCsvLine(lines[0]);
  const idx = (name) => header.indexOf(name);

  // OurAirports columns
  const iType = idx("type");
  const iIata = idx("iata_code");
  const iName = idx("name");
  const iCity = idx("municipality");
  const iRegion = idx("iso_region");
  const iCountry = idx("iso_country");
  const iLat = idx("latitude_deg");
  const iLon = idx("longitude_deg");
  const iScheduled = idx("scheduled_service"); // optional

  const required = [iType, iIata, iName, iCity, iRegion, iCountry, iLat, iLon];
  if (required.some((i) => i < 0)) {
    console.error("Unexpected CSV format. Missing required headers. First row headers were:");
    console.log(header);
    process.exit(1);
  }

  const airports = [];

  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvLine(lines[i]);
    if (row.length < header.length) continue;

    const type = normStr(row[iType]).toLowerCase();
    if (!ALLOWED_TYPES.has(type)) continue; // ✅ large/medium only

    const country = normStr(row[iCountry]).toUpperCase();
    if (!ALLOWED_COUNTRIES.has(country)) continue; // ✅ US + CA only

    // Optional: scheduled passenger service only (keeps “real” commercial airports)
    if (iScheduled >= 0) {
      const scheduled = normStr(row[iScheduled]).toLowerCase();
      if (scheduled && scheduled !== "yes") continue;
    }

    const iata = normStr(row[iIata]).toUpperCase();
    if (!iata || iata === "\\N") continue;

    const name = normStr(row[iName]);
    const city = normStr(row[iCity]);
    const region = normStr(row[iRegion]); // e.g. "US-CA", "CA-BC"
    const lat = toNum(row[iLat]);
    const lon = toNum(row[iLon]);

    if (!name || !city || !region) continue;
    if (lat === null || lon === null) continue;

    airports.push({
      iata,
      name,
      city,
      region,
      country,
      lat,
      lon,
      // keep type for downstream preference (large beats medium)
      type,
    });
  }

  // Deduplicate by IATA (keep first)
  const seen = new Set();
  const deduped = [];
  for (const a of airports) {
    if (seen.has(a.iata)) continue;
    seen.add(a.iata);
    deduped.push(a);
  }

  // Sort for stable diffs
  deduped.sort((a, b) => a.iata.localeCompare(b.iata));

  fs.writeFileSync(OUT, JSON.stringify(deduped, null, 2), "utf8");
  console.log(`Built ${deduped.length} airports (US+CA, large/medium, scheduled if available) -> data/airports.json`);
}

main();