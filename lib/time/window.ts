// FILE: lib/time/window.ts

export function isYMD(s: unknown): s is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
}

function parseYMDToUTCNoon(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function addDaysYMD(ymd: string, delta: number): string {
  const dt = parseYMDToUTCNoon(ymd);
  dt.setUTCDate(dt.getUTCDate() + delta);

  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

export function anchorWindowYMD(anchorDate: string, daysEachSide = 3) {
  const start = addDaysYMD(anchorDate, -daysEachSide);
  const end = addDaysYMD(anchorDate, +daysEachSide);
  return { start, end };
}

// Ticketmaster endDateTime behaves best treated as an exclusive bound.
// We use 12:00:00Z instead of 00:00:00Z to avoid previous-day bleed caused
// by timezone conversion when searching North American events.
export function ymdToTmRangeInclusive(startYMD: string, endYMD: string) {
  const startDateTime = `${startYMD}T12:00:00Z`;
  const endExclusiveYMD = addDaysYMD(endYMD, 1);
  const endDateTime = `${endExclusiveYMD}T12:00:00Z`;

  return { startDateTime, endDateTime };
}