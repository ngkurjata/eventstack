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

function pickBest(group: NormEvent[]): NormEvent {
  const copy = [...group];
  copy.sort(compareEventQuality);
  return copy[0];
}

function groupAndPick(events: NormEvent[], keyFn: (e: NormEvent) => string): NormEvent[] {
  const buckets = new Map<string, NormEvent[]>();

  for (const event of events) {
    const key = keyFn(event);
    const group = buckets.get(key) || [];
    group.push(event);
    buckets.set(key, group);
  }

  const out: NormEvent[] = [];
  for (const group of buckets.values()) {
    out.push(pickBest(group));
  }

  return out;
}

export function isHardNoise(e: NormEvent): boolean {
  if (e.flags.isParkingLike) return true;

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

  // 1) Drop obvious junk outright.
  // Keep "premium seating" long enough to lose to the real event in grouping.
  const cleaned = events.filter((e) => e && !isHardNoise(e));

  // 2) First pass: strict canonical key
  const strictPicked = groupAndPick(cleaned, (event) => {
    return (
      norm(event.canonicalKey) ||
      `${event.localDate}|${norm(event.name)}|${norm(event.venueName || event.city)}`
    );
  });

  // 3) Second pass: softer semantic key
  // This catches variants where the venue label differs or one title has promo suffixes.
  const semanticPicked = groupAndPick(strictPicked, (event) => {
    return (
      norm(event.semanticKey) ||
      `${event.localDate}|${norm(event.name)}|${norm(event.city)}|${norm(event.localTime)}`
    );
  });

  // 4) Stable final sort
  semanticPicked.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.name.localeCompare(b.name);
  });

  return semanticPicked;
}