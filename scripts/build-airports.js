import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

const ROOT = process.cwd();
const RAW = path.join(ROOT, "data-raw", "airports.csv");
const OUT = path.join(ROOT, "public", "airports.min.json");

const csv = fs.readFileSync(RAW, "utf8");
const rows = parse(csv, { columns: true, skip_empty_lines: true });

const airports = rows
  .filter((r) => {
    const iata = (r.iata_code || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) return false;

    const type = (r.type || "").trim();
    if (!["large_airport", "medium_airport", "small_airport"].includes(type))
      return false;

    const scheduled = (r.scheduled_service || "").trim().toLowerCase();
    if (scheduled && scheduled !== "yes") return false;

    return true;
  })
  .map((r) => ({
    iata: (r.iata_code || "").trim().toUpperCase(),
    name: (r.name || "").trim(),
    city: (r.municipality || "").trim(),
    region: (r.iso_region || "").trim(),
    country: (r.iso_country || "").trim(),
    lat: r.latitude_deg ? Number(r.latitude_deg) : null,
    lon: r.longitude_deg ? Number(r.longitude_deg) : null,
  }))
  .sort((a, b) => a.iata.localeCompare(b.iata));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(airports));
console.log(`✅ Wrote ${airports.length} airports to ${OUT}`);
