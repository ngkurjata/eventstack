// FILE: app/api/resolve/favorite/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  resolveFavorite,
  searchFavoriteOptions,
  type FavoriteSearchKind,
} from "@/lib/favorites/resolve";

type ResolveKind = "team" | "artist";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status });
}

function parseSearchKind(value: string | null): FavoriteSearchKind | "all" {
  const v = String(value || "")
    .trim()
    .toLowerCase();

  if (v === "team") return "team";
  if (v === "artist") return "artist";
  return "all";
}

function parseResolveKind(value: string | null): ResolveKind | null {
  const v = String(value || "")
    .trim()
    .toLowerCase();

  if (v === "team") return "team";
  if (v === "artist") return "artist";
  return null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const q = String(searchParams.get("q") || "").trim();
    const kind = parseSearchKind(searchParams.get("kind"));
    const limit = Math.max(
      1,
      Math.min(25, Number(searchParams.get("limit") || 12)),
    );

    if (!q) {
      return json({
        ok: true,
        q,
        items: [],
      });
    }

    if (kind === "all") {
      const [artistItems, teamItems] = await Promise.all([
        searchFavoriteOptions(q, "artist", limit),
        searchFavoriteOptions(q, "team", limit),
      ]);

      const merged = [...artistItems, ...teamItems]
        .sort((a, b) => {
          const byScore = Number(b.score || 0) - Number(a.score || 0);
          if (byScore !== 0) return byScore;

          if (a.kind !== b.kind) {
            return a.kind === "artist" ? -1 : 1;
          }

          return a.label.localeCompare(b.label);
        })
        .slice(0, limit);

      return json({
        ok: true,
        q,
        items: merged,
      });
    }

    const items = await searchFavoriteOptions(q, kind, limit);

    return json({
      ok: true,
      q,
      items,
    });
  } catch (e: any) {
    console.error("api/resolve/favorite GET error:", e);
    return json(
      {
        ok: false,
        q: "",
        items: [],
        error: String(e?.message || "Failed to search favorites"),
      },
      500,
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const kind = parseResolveKind(body?.kind);
    const label = String(body?.label || "").trim();

    if (!kind) {
      return json({ error: "kind must be 'team' or 'artist'" }, 400);
    }

    if (!label) {
      return json({ error: "label required" }, 400);
    }

    const favorite = await resolveFavorite(label, kind);

    if (!favorite) {
      return json({ error: "Could not resolve favorite" }, 404);
    }

    return json({
      ok: true,
      favorite,
    });
  } catch (e: any) {
    const msg = String(e?.message || "Failed to resolve favorite");
    console.error("api/resolve/favorite POST error:", e);
    return json({ ok: false, error: msg }, 500);
  }
}