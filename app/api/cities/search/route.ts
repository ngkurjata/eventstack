export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import TM from "@/lib/tm/client";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") || "").trim();

    if (!q) {
      return json({ ok: true, q, cities: [] });
    }

    const resp = await TM.tmFetchJson("/venues.json", {
      keyword: q,
      size: 20,
      sort: "name,asc",
    });

    const venues = Array.isArray(resp?._embedded?.venues)
      ? resp._embedded.venues
      : [];

    const seen = new Set<string>();

    const cities = venues
      .map((venue: any) => {
        const city = String(venue?.city?.name || "").trim();

        const region =
          String(venue?.state?.stateCode || "").trim() ||
          String(venue?.province?.provinceCode || "").trim() ||
          String(venue?.country?.countryCode || "").trim();

        const latRaw = venue?.location?.latitude;
        const lonRaw = venue?.location?.longitude;

        const lat = latRaw == null ? null : Number(latRaw);
        const lon = lonRaw == null ? null : Number(lonRaw);

        if (!city || !Number.isFinite(lat) || !Number.isFinite(lon)) {
          return null;
        }

        const label = region ? `${city}, ${region}` : city;
        const dedupeKey = label.toLowerCase();

        if (seen.has(dedupeKey)) return null;
        seen.add(dedupeKey);

        return {
          label,
          city,
          region: region || null,
          lat,
          lon,
        };
      })
      .filter(Boolean);

    return json({
      ok: true,
      q,
      cities,
    });
  } catch (err: any) {
    return json(
      {
        ok: false,
        q: "",
        cities: [],
        error: err?.message || "Unknown error",
      },
      500
    );
  }
}
