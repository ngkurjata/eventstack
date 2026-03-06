// FILE: lib/events/dedupe.ts

import type { NormEvent } from "@/lib/events/normalize";

function lower(s: string) {
  return s.toLowerCase();
}

export function isHardNoise(e: NormEvent) {
  // hard exclude: parking/upsells/etc
  if (e.flags.isParkingLike) return true;

  const n = lower(e.name);

  // keep this list strict (only obvious junk)
  const hard = [
    /\bparking\b/,
    /\bparkwhiz\b/,
    /\bgarage\b/,
    /\blot\b/,
    /\baccess\s*pass\b/,
    /\bseat\s*upgrade\b/,
    /\bupgrade\b/,
    /\bvip\b/,
    /\bclub\s*level\b/,
    /\bsuite\b/,
    /\bhospitality\b/,
    /\bmeet\s*and\s*greet\b/,
    /\bpre[-\s]?party\b/,
    /\bpost[-\s]?party\b/,
    /\btailgate\b/,
    /\badd[-\s]?on\b/,
  ];

  return hard.some((re) => re.test(n));
}

export function dedupeEvents(events: NormEvent[]): NormEvent[] {
  // 1) remove hard noise
  const cleaned = events.filter((e) => !isHardNoise(e));

  // 2) group by canonicalKey, keep best by (qualityScore, url presence, time presence)
  const byKey = new Map<string, NormEvent[]>();
  for (const e of cleaned) {
    const arr = byKey.get(e.canonicalKey) || [];
    arr.push(e);
    byKey.set(e.canonicalKey, arr);
  }

  const picked: NormEvent[] = [];
  for (const [, group] of byKey) {
    group.sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
      const bu = b.url ? 1 : 0;
      const au = a.url ? 1 : 0;
      if (bu !== au) return bu - au;
      const bt = b.localTime ? 1 : 0;
      const at = a.localTime ? 1 : 0;
      if (bt !== at) return bt - at;
      return a.name.localeCompare(b.name);
    });
    picked.push(group[0]);
  }

  // stable sort by ts then name
  picked.sort((a, b) => (a.ts - b.ts) || a.name.localeCompare(b.name));
  return picked;
}