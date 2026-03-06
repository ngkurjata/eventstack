// FILE: lib/time/window.ts

export function isYMD(s: any): s is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function addDaysYMD(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + delta);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function anchorWindowYMD(anchorDate: string, daysEachSide = 3) {
  const start = addDaysYMD(anchorDate, -daysEachSide);
  const end = addDaysYMD(anchorDate, +daysEachSide);
  return { start, end };
}

// Ticketmaster endDateTime behaves best treated as an exclusive bound.
// So we add +1 day to include the full end date.
export function ymdToTmRangeInclusive(startYMD: string, endYMD: string) {
  const start = `${startYMD}T00:00:00Z`;
  const endExclusiveYMD = addDaysYMD(endYMD, 1);
  const end = `${endExclusiveYMD}T00:00:00Z`;
  return { startDateTime: start, endDateTime: end };
}