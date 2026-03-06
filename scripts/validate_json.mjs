// FILE: scripts/validate_json.mjs
import fs from "node:fs";
import path from "node:path";

const rel = process.argv[2];
if (!rel) {
  console.error("Usage: node scripts/validate_json.mjs data/genres_config.json");
  process.exit(1);
}

const file = path.join(process.cwd(), rel);

const raw = fs.readFileSync(file, "utf8");

// Quick hint for the #1 culprit: trailing commas before ] or }
const trailingCommaMatch = raw.match(/,\s*[\]\}]/);
if (trailingCommaMatch) {
  const idx = trailingCommaMatch.index ?? -1;
  const start = Math.max(0, idx - 120);
  const end = Math.min(raw.length, idx + 120);
  console.error("Likely trailing comma near:");
  console.error(raw.slice(start, end));
  console.error("\nFix: remove the comma right before the ] or }.");
}

try {
  JSON.parse(raw);
  console.log("OK JSON:", rel);
} catch (e) {
  console.error("INVALID JSON:", rel);
  console.error(String(e?.message || e));
  process.exit(2);
}