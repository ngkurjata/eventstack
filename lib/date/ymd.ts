export function isYMD(s: unknown): s is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

export function ymdFromLocalDate(dt: Date) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function localDateFromYMD(ymd: string) {
  if (!isYMD(ymd)) return undefined;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysLocal(ymd: string, days: number) {
  if (!isYMD(ymd)) return "";
  const [yy, mm, dd] = ymd.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(yy, mm - 1, dd);
  dt.setDate(dt.getDate() + days);
  return ymdFromLocalDate(dt);
}

export function tomorrowYMD() {
  const dt = new Date();
  dt.setDate(dt.getDate() + 1);
  return ymdFromLocalDate(dt);
}

export function fmtDateChip(ymd: string) {
  if (!isYMD(ymd)) return "";
  try {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return ymd;
  }
}
