// FILE: lib/url.ts

export function encodeJsonParam(obj: any): string {
  return encodeURIComponent(JSON.stringify(obj));
}

export function decodeJsonParam<T = any>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(decodeURIComponent(s)) as T;
  } catch {
    return null;
  }
}

export function csvToList(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function listToCsv(xs: string[]): string {
  return (xs || []).map((x) => String(x).trim()).filter(Boolean).join(",");
}