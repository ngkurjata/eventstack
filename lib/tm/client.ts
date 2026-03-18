// FILE: lib/tm/client.ts

export type TMEvent = any;

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_CACHE_TTL_MS = 5 * 60_000;

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type CacheEntry = {
  expiresAt: number;
  data?: any;
  promise?: Promise<any>;
};

const tmMemoryCache = new Map<string, CacheEntry>();

function stableSerialize(value: any): string {
  if (value === null || value === undefined) return String(value);

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableSerialize(value[k])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function makeCacheKey(path: string, params: Record<string, any>) {
  const cleaned: Record<string, any> = {};

  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    cleaned[k] = v;
  }

  return `${path}::${stableSerialize(cleaned)}`;
}

function readFreshCache(key: string) {
  const entry = tmMemoryCache.get(key);
  if (!entry) return null;

  if (Date.now() >= entry.expiresAt) {
    tmMemoryCache.delete(key);
    return null;
  }

  if (entry.data !== undefined) return entry.data;
  if (entry.promise) return entry.promise;

  return null;
}

function writeResolvedCache(key: string, data: any) {
  tmMemoryCache.set(key, {
    expiresAt: Date.now() + TM_CACHE_TTL_MS,
    data,
  });
}

function writePendingCache(key: string, promise: Promise<any>) {
  tmMemoryCache.set(key, {
    expiresAt: Date.now() + TM_CACHE_TTL_MS,
    promise,
  });
}

function clearCacheKey(key: string) {
  tmMemoryCache.delete(key);
}

function isQuotaError(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("quota") || msg.includes("rate limit") || err?.status === 429;
}

function buildUrl(path: string, params: Record<string, any>) {
  const apikey =
    process.env.TM_API_KEY ||
    process.env.TICKETMASTER_API_KEY ||
    mustEnv("TICKETMASTER_API_KEY");

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${TM_BASE}${normalizedPath}`);
  url.searchParams.set("apikey", apikey);

  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  return url;
}

async function tmFetchJsonUncached(
  path: string,
  params: Record<string, any>,
  init?: RequestInit
) {
  const url = buildUrl(path, params);
  let lastErr: any = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.headers || {}),
        },
        cache: "no-store",
      });

      const txt = await res.text();
      let json: any = null;

      try {
        json = txt ? JSON.parse(txt) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        const msg =
          json?.fault?.faultstring ||
          json?.errors?.[0]?.detail ||
          json?.message ||
          txt ||
          `TM error ${res.status}`;

        const err = new Error(msg) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      return json;
    } catch (e: any) {
      lastErr = e;

      if (isQuotaError(e)) break;

      if (attempt < 2) {
        await sleep(150 * (attempt + 1));
      }
    }
  }

  throw lastErr || new Error("Ticketmaster fetch failed");
}

async function tmFetchJson(
  path: string,
  params: Record<string, any>,
  init?: RequestInit
) {
  const key = makeCacheKey(path, params);
  const cached = readFreshCache(key);
  if (cached) return cached;

  const pending = tmFetchJsonUncached(path, params, init)
    .then((data) => {
      writeResolvedCache(key, data);
      return data;
    })
    .catch((err) => {
      clearCacheKey(key);
      throw err;
    });

  writePendingCache(key, pending);
  return pending;
}

export type TMSearchParams = {
  latlong?: string;
  radius?: number;
  unit?: "miles" | "km";
  startDateTime?: string;
  endDateTime?: string;
  countryCode?: string;
  classificationName?: string;
  attractionId?: string;
  keyword?: string;
  size?: number;
  page?: number;
  sort?: string;
};

export type TMVenueSearchParams = {
  keyword?: string;
  city?: string;
  stateCode?: string;
  countryCode?: string;
  size?: number;
  page?: number;
  sort?: string;
};

export type TMAttractionSearchParams = {
  keyword: string;
  size?: number;
  sort?: string;
};

export type TMSearchAllOptions = {
  hardCap?: number;
  maxPages?: number;
  onPage?: (
    eventsSoFar: TMEvent[],
    latestPageEvents: TMEvent[],
    page: number,
    json: any
  ) => boolean;
};

async function tmSearchEventsPage(params: TMSearchParams) {
  return tmFetchJson("/events.json", params);
}

export async function searchEvents(params: TMSearchParams) {
  return tmFetchJson("/events.json", params);
}

export async function searchVenues(params: TMVenueSearchParams) {
  return tmFetchJson("/venues.json", params);
}

export async function searchAttractions(params: TMAttractionSearchParams) {
  return tmFetchJson("/attractions.json", params);
}

export async function tmSearchEventsAll(
  params: TMSearchParams,
  options?: number | TMSearchAllOptions
): Promise<TMEvent[]> {
  const opts: TMSearchAllOptions =
    typeof options === "number" ? { hardCap: options } : options || {};

  const size = Math.min(Math.max(params.size ?? 100, 1), 200);
  const hardCap = Math.max(size, opts.hardCap ?? 1000);
  const maxPages = Math.max(1, opts.maxPages ?? 10);

  let page = 0;
  const out: TMEvent[] = [];

  while (page < maxPages) {
    const remaining = hardCap - out.length;
    if (remaining <= 0) break;

    const pageSize = Math.min(size, remaining);
    if (!Number.isFinite(pageSize) || pageSize < 1) break;

    const json = await tmSearchEventsPage({
      ...params,
      size: pageSize,
      page,
    });

    const pageEvents: TMEvent[] = json?._embedded?.events || [];
    const totalPages = Number(json?.page?.totalPages ?? 0);
    const totalElements = Number(json?.page?.totalElements ?? 0);

    if (!pageEvents.length) break;

    out.push(...pageEvents);

    const shouldStop = opts.onPage?.(out, pageEvents, page, json);
    page += 1;

    if (shouldStop) break;
    if (totalPages && page >= totalPages) break;
    if (totalElements && out.length >= totalElements) break;
    if (out.length >= hardCap) break;
  }

  return out.slice(0, hardCap);
}

const TM = {
  tmFetchJson,
  tmSearchEventsAll,
  searchEvents,
  searchVenues,
  searchAttractions,
};

export default TM;