import { NextResponse } from "next/server";

// POST /api/resolve-team
// body: { team: "Blue Jays", league: "MLB" }  (league is optional hint)
export async function POST(req) {
  try {
    const apiKey = process.env.TICKETMASTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing TICKETMASTER_API_KEY in .env.local" }, { status: 500 });
    }

    const body = await req.json();
    const team = String(body.team || "").trim();
    const league = String(body.league || "").trim(); // optional hint
    const countryCode = String(body.countryCode || "US,CA").trim(); // optional hint

    if (!team) {
      return NextResponse.json({ error: "Missing team in request body" }, { status: 400 });
    }

    // Attractions endpoint: search for entities like teams/artists. :contentReference[oaicite:2]{index=2}
    const params = new URLSearchParams();
    params.set("apikey", apiKey);
    params.set("keyword", team);
    params.set("segmentName", "Sports");
    params.set("size", "20");

    // Some TM deployments accept comma-separated country codes; if it errors, you can remove this.
    if (countryCode) params.set("countryCode", countryCode);

    const url = `https://app.ticketmaster.com/discovery/v2/attractions.json?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data?.errors?.length) {
      return NextResponse.json({ error: data.errors[0]?.detail || "Ticketmaster error", raw: data.errors }, { status: 502 });
    }

    const attractions = data?._embedded?.attractions || [];

    // Score candidates (simple heuristics)
    const q = team.toLowerCase();
    const scored = attractions.map((a) => {
      const name = String(a?.name || "");
      const nameLc = name.toLowerCase();

      let score = 0;
      if (nameLc === q) score += 100;
      if (nameLc.includes(q)) score += 40;
      if (league && nameLc.includes(league.toLowerCase())) score += 10;

      const seg = a?.classifications?.[0]?.segment?.name || null;
      const genre = a?.classifications?.[0]?.genre?.name || null;
      const subGenre = a?.classifications?.[0]?.subGenre?.name || null;

      return {
        score,
        id: a?.id || null,
        name,
        segment: seg,
        genre,
        subGenre,
        url: a?.url || null,
        externalLinks: a?.externalLinks || null,
      };
    });

    scored.sort((x, y) => y.score - x.score);

    return NextResponse.json({
      query: { team, league, countryCode },
      candidates: scored.slice(0, 10),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error resolving team." }, { status: 500 });
  }
}
