// FILE: lib/tm/client.ts

export type TMEvent = any;

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tmFetchJson(path: string, params: Record<string, any>, init?: RequestInit) {
  const apikey = mustEnv("TICKETMASTER_API_KEY");

  const url = new URL(`${TM_BASE}${path}`);
  url.searchParams.set("apikey", apikey);

  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

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
          json?.errors?.[0]?.detail ||
          json?.message ||
          txt ||
          `TM error ${res.status}`;
        throw new Error(msg);
      }

      return json;
    } catch (e) {
      lastErr = e;
      await sleep(150 * (attempt + 1));
    }
  }

  throw lastErr || new Error("Ticketmaster fetch failed");
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

async function tmSearchEventsAll(
  params: TMSearchParams,
  hardCap = 1200
): Promise<TMEvent[]> {
  const size = Math.min(Math.max(params.size ?? 200, 20), 200);

  let page = 0;
  const out: TMEvent[] = [];

  while (true) {
    const json = await tmFetchJson("/events.json", {
      ...params,
      size,
      page,
    });

    const pageEvents: TMEvent[] = json?._embedded?.events || [];
    out.push(...pageEvents);

    const totalPages = Number(json?.page?.totalPages ?? 0);
    page++;

    if (!totalPages || page >= totalPages) break;
    if (out.length >= hardCap) break;
  }

  return out.slice(0, hardCap);
}

const TM = {
  tmFetchJson,
  tmSearchEventsAll,
};

export default TM;