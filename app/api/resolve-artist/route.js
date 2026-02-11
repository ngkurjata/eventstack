import { NextResponse } from "next/server";

function scoreCandidate(query, candName) {
  const q = String(query || "").toLowerCase().trim();
  const n = String(candName || "").toLowerCase().trim();
  if (!q || !n) return 0;

  let score = 0;
  if (n === q) score += 100;
  if (n.includes(q)) score += 40;

  // small bonuses for word overlap
  const qWords = new Set(q.split(/\s+/).filter(Boolean));
  const nWords = new Set(n.split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const w of qWords) if (nWords.has(w)) overlap += 1;
  score += overlap * 5;

  return score;
}

export async function GET(req) {
  try {
    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing TICKETMASTER_API_KEY" }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const name = (searchParams.get("name") || "").trim();
    const countryCode = (searchParams.get("countryCode") || "US,CA").trim();

    if (!name) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 });
    }

    const params = new URLSearchParams();
    params.set("apikey", apiKey);
    params.set("segmentName", "Music");
    params.set("keyword", name);
    params.set("size", "20");
    if (countryCode) params.set("countryCode", countryCode);

    const url = `https://app.ticketmaster.com/discovery/v2/attractions.json?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json();

    const attractions = data?._embedded?.attractions || [];
    const candidates = attractions.map((a) => {
      const c = a?.classifications?.[0] || {};
      const segment = c?.segment?.name || null;
      const genre = c?.genre?.name || null;
      const subGenre = c?.subGenre?.name || null;

      return {
        id: a?.id || null,
        name: a?.name || "",
        url: a?.url || null,
        segment,
        genre,
        subGenre,
        score: scoreCandidate(name, a?.name),
      };
    });

    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));

    return NextResponse.json({
      query: name,
      candidates: candidates.filter((c) => c.id).slice(0, 10),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Resolve artist failed" }, { status: 500 });
  }
}
