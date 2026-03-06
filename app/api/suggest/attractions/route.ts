// FILE: app/api/suggest/attractions/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") || "").trim();
    if (!q) return json({ ok: true, q, items: [] });

    const key = process.env.TM_API_KEY || process.env.TICKETMASTER_API_KEY;
    if (!key) {
      return json({
        ok: false,
        q,
        items: [],
        error: "Missing TM API key (TM_API_KEY or TICKETMASTER_API_KEY).",
      });
    }

    const qs = new URLSearchParams();
    qs.set("apikey", key);
    qs.set("keyword", q);
    qs.set("size", "8");
    qs.set("sort", "name,asc");

    const r = await fetch(`https://app.ticketmaster.com/discovery/v2/attractions.json?${qs.toString()}`, {
      cache: "no-store",
    });

    const j = await r.json().catch(() => ({} as any));
    if (!r.ok) return json({ ok: false, q, items: [], error: `TM attractions failed (${r.status})`, detail: j }, 500);

    const list = (j?._embedded?.attractions || []) as any[];
    const items = list
      .map((a) => {
        const id = String(a?.id || "").trim();
        const name = String(a?.name || "").trim();
        if (!id || !name) return null;

        // try to pick a human-ish genre label, but UI mainly needs id+name
        const genre =
          a?.classifications?.[0]?.genre?.name ||
          a?.classifications?.[0]?.segment?.name ||
          "";

        return { id, name, genre: String(genre || "").trim() };
      })
      .filter(Boolean);

    return json({ ok: true, q, items });
  } catch (e: any) {
    console.error("api/suggest/attractions error:", e);
    return json({ ok: false, items: [], error: e?.message || "Failed" }, 500);
  }
}