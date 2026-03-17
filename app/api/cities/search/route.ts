// FILE: lib/tm/client.ts

type TmListResponse<T = any> = {
  _embedded?: {
    events?: T[];
    attractions?: T[];
    venues?: T[];
  };
  page?: {
    size?: number;
    totalElements?: number;
    totalPages?: number;
    number?: number;
  };
};

function getApiKey() {
  const key = process.env.TM_API_KEY || process.env.TICKETMASTER_API_KEY;
  if (!key) {
    throw new Error("Missing TM API key (TM_API_KEY or TICKETMASTER_API_KEY).");
  }
  return key;
}

function toUrl(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>
) {
  const url = new URL(`https://app.ticketmaster.com${path}`);
  url.searchParams.set("apikey", getApiKey());

  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  return url.toString();
}

async function tmFetch<T = any>(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>
): Promise<T> {
  const url = toUrl(path, params);

  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(`TM fetch failed (${res.status}): ${text}`);
  }

  return json as T;
}

export type TmEventSearchParams = {
  latlong?: string;
  radius?: number;
  unit?: "miles" | "km";
  startDateTime?: string;
  endDateTime?: string;
  countryCode?: string;
  keyword?: string;
  classificationName?: string;
  sort?: string;
  size?: number;
  page?: number;
};

export type TmAttractionSearchParams = {
  keyword: string;
  size?: number;
  sort?: string;
};

export type TmVenueSearchParams = {
  keyword?: string;
  city?: string;
  stateCode?: string;
  countryCode?: string;
  size?: number;
  page?: number;
  sort?: string;
};

export const TM = {
  async searchEvents(params: TmEventSearchParams) {
    return tmFetch<TmListResponse>("/discovery/v2/events.json", params);
  },

  async searchAttractions(params: TmAttractionSearchParams) {
    return tmFetch<TmListResponse>("/discovery/v2/attractions.json", params);
  },

  async searchVenues(params: TmVenueSearchParams) {
    return tmFetch<TmListResponse>("/discovery/v2/venues.json", params);
  },
};

export default TM;