// FILE: lib/events/dedupe.ts

import type { NormEvent } from "@/lib/events/normalize";

function norm(s: string | null | undefined): string {
  return String(s || "").trim().toLowerCase();
}

function hasUrl(e: NormEvent): number {
  return e.url ? 1 : 0;
}

function hasLocalTime(e: NormEvent): number {
  return e.localTime ? 1 : 0;
}

function compareEventQuality(a: NormEvent, b: NormEvent): number {
  if (b.qualityScore !== a.qualityScore) {
    return b.qualityScore - a.qualityScore;
  }

  const bUrl = hasUrl(b);
  const aUrl = hasUrl(a);
  if (bUrl !== aUrl) {
    return bUrl - aUrl;
  }

  const bTime = hasLocalTime(b);
  const aTime = hasLocalTime(a);
  if (bTime !== aTime) {
    return bTime - aTime;
  }

  if ((b.matched.favorites?.length || 0) !== (a.matched.favorites?.length || 0)) {
    return (b.matched.favorites?.length || 0) - (a.matched.favorites?.length || 0);
  }

  if ((b.matched.genres?.length || 0) !== (a.matched.genres?.length || 0)) {
    return (b.matched.genres?.length || 0) - (a.matched.genres?.length || 0);
  }

  return a.name.localeCompare(b.name);
}

export function isHardNoise(e: NormEvent): boolean {
  if (e.flags.isParkingLike) return true;
  if (e.flags.isUpsellLike) return true;

  const name = norm(e.name);

  const hardNoisePatterns = [
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

  return hardNoisePatterns.some((re) => re.test(name));
}

export function dedupeEvents(events: NormEvent[]): NormEvent[] {
  if (!Array.isArray(events) || events.length === 0) return [];

  // 1) Remove obvious junk
  const cleaned = events.filter((e) => e && !isHardNoise(e));

  // 2) Group by canonical key
  const byCanonicalKey = new Map<string, NormEvent[]>();

  for (const event of cleaned) {
    const key = norm(event.canonicalKey) || `${event.localDate}|${norm(event.name)}|${norm(event.venueName || event.city)}`;
    const group = byCanonicalKey.get(key) || [];
    group.push(event);
    byCanonicalKey.set(key, group);
  }

  // 3) Pick best event from each group
  const picked: NormEvent[] = [];

  for (const group of byCanonicalKey.values()) {
    group.sort(compareEventQuality);
    picked.push(group[0]);
  }

  // 4) Final stable sort
  picked.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.name.localeCompare(b.name);
  });

  return picked;
}