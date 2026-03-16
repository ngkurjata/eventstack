// FILE: app/api/suggest/attractions/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { findCuratedFavorites } from "@/lib/favorites/catalog";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

type SuggestItem = {
  id: string;
  name: string;
  genre: string;
  favoriteId?: string;
  curated: boolean;
};

function uniqueById(items: SuggestItem[]): SuggestItem[] {
  const seen = new Set<string>();
  const out: SuggestItem[] = [];

  for (const item of items) {
    const id = String(item.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }

  return out;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") || "").trim();
    if (!q) return json({ ok: true, q, items: [] });

    const curated: SuggestItem[] = findCuratedFavorites(q).map((fav) => ({
      id: fav.attractionId,
      name: fav.label,
      genre: fav.defaultGenre,
      favoriteId: fav.id,
      curated: true,
    }));

    const key = process.env.TM_API_KEY || process.env.TICKETMASTER_API_KEY;
    if (!key) {
      return json({
        ok: false,
        q,
        items: curated,
        error: "Missing TM API key (TM_API_KEY or TICKETMASTER_API_KEY).",
      });
    }

    const qs = new URLSearchParams();
    qs.set("apikey", key);
    qs.set("keyword", q);
    qs.set("size", "8");
    qs.set("sort", "name,asc");

    const r = await fetch(
      `https://app.ticketmaster.com/discovery/v2/attractions.json?${qs.toString()}`,
      { cache: "no-store" }
    );

    const j = await r.json().catch(() => ({} as any));
    if (!r.ok) {
      return json(
        {
          ok: false,
          q,
          items: curated,
          error: `TM attractions failed (${r.status})`,
          detail: j,
        },
        500
      );
    }

    const list = (j?._embedded?.attractions || []) as any[];

    const tmItems: SuggestItem[] = list.flatMap((a): SuggestItem[] => {
      const id = String(a?.id || "").trim();
      const name = String(a?.name || "").trim();
      if (!id || !name) return [];

      const genre =
        a?.classifications?.[0]?.genre?.name ||
        a?.classifications?.[0]?.segment?.name ||
        "";

      return [
        {
          id,
          name,
          genre: String(genre || "").trim(),
          curated: false,
        },
      ];
    });

    const items = uniqueById([...curated, ...tmItems]);

    return json({ ok: true, q, items });
  } catch (e: any) {
    console.error("api/suggest/attractions error:", e);
    return json({ ok: false, items: [], error: e?.message || "Failed" }, 500);
  }
}