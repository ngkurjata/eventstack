// app/api/options/route.js
import { NextResponse } from "next/server";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";
const TM_ATTRACTIONS = `${TM_BASE}/attractions.json`;
const TM_KEY = process.env.TICKETMASTER_API_KEY;

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

function sortByLabel(a, b) {
  return String(a.label).localeCompare(String(b.label));
}

// Canonical team rosters
const TEAMS_BY_LEAGUE = {
  NHL: [
    "Anaheim Ducks","Arizona Coyotes","Boston Bruins","Buffalo Sabres","Calgary Flames","Carolina Hurricanes",
    "Chicago Blackhawks","Colorado Avalanche","Columbus Blue Jackets","Dallas Stars","Detroit Red Wings",
    "Edmonton Oilers","Florida Panthers","Los Angeles Kings","Minnesota Wild","Montreal Canadiens",
    "Nashville Predators","New Jersey Devils","New York Islanders","New York Rangers","Ottawa Senators",
    "Philadelphia Flyers","Pittsburgh Penguins","San Jose Sharks","Seattle Kraken","St. Louis Blues",
    "Tampa Bay Lightning","Toronto Maple Leafs","Vancouver Canucks","Vegas Golden Knights","Washington Capitals",
    "Winnipeg Jets"
  ],
  NBA: [
    "Atlanta Hawks","Boston Celtics","Brooklyn Nets","Charlotte Hornets","Chicago Bulls","Cleveland Cavaliers",
    "Dallas Mavericks","Denver Nuggets","Detroit Pistons","Golden State Warriors","Houston Rockets","Indiana Pacers",
    "LA Clippers","Los Angeles Lakers","Memphis Grizzlies","Miami Heat","Milwaukee Bucks","Minnesota Timberwolves",
    "New Orleans Pelicans","New York Knicks","Oklahoma City Thunder","Orlando Magic","Philadelphia 76ers",
    "Phoenix Suns","Portland Trail Blazers","Sacramento Kings","San Antonio Spurs","Toronto Raptors",
    "Utah Jazz","Washington Wizards"
  ],
  MLB: [
    "Arizona Diamondbacks","Atlanta Braves","Baltimore Orioles","Boston Red Sox","Chicago Cubs","Chicago White Sox",
    "Cincinnati Reds","Cleveland Guardians","Colorado Rockies","Detroit Tigers","Houston Astros","Kansas City Royals",
    "Los Angeles Angels","Los Angeles Dodgers","Miami Marlins","Milwaukee Brewers","Minnesota Twins","New York Mets",
    "New York Yankees","Oakland Athletics","Philadelphia Phillies","Pittsburgh Pirates","San Diego Padres",
    "San Francisco Giants","Seattle Mariners","St. Louis Cardinals","Tampa Bay Rays","Texas Rangers",
    "Toronto Blue Jays","Washington Nationals"
  ],
  NFL: [
    "Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills","Carolina Panthers","Chicago Bears",
    "Cincinnati Bengals","Cleveland Browns","Dallas Cowboys","Denver Broncos","Detroit Lions","Green Bay Packers",
    "Houston Texans","Indianapolis Colts","Jacksonville Jaguars","Kansas City Chiefs","Las Vegas Raiders",
    "Los Angeles Chargers","Los Angeles Rams","Miami Dolphins","Minnesota Vikings","New England Patriots",
    "New Orleans Saints","New York Giants","New York Jets","Philadelphia Eagles","Pittsburgh Steelers",
    "San Francisco 49ers","Seattle Seahawks","Tampa Bay Buccaneers","Tennessee Titans","Washington Commanders"
  ],
  MLS: [
    "Atlanta United","Austin FC","CF Montréal","Charlotte FC","Chicago Fire FC","Colorado Rapids","Columbus Crew",
    "D.C. United","FC Cincinnati","FC Dallas","Houston Dynamo FC","Inter Miami CF","LA Galaxy",
    "Los Angeles Football Club","Minnesota United FC","Nashville SC","New England Revolution",
    "New York City FC","New York Red Bulls","Orlando City SC","Philadelphia Union","Portland Timbers",
    "Real Salt Lake","San Diego FC","San Jose Earthquakes","Seattle Sounders FC","Sporting Kansas City",
    "St. Louis CITY SC","Toronto FC","Vancouver Whitecaps FC"
  ],
  CFL: [
    "BC Lions","Calgary Stampeders","Edmonton Elks","Saskatchewan Roughriders","Winnipeg Blue Bombers",
    "Hamilton Tiger-Cats","Toronto Argonauts","Ottawa Redblacks","Montreal Alouettes"
  ],
};

function buildTeamOptions() {
  const out = [];
  for (const league of Object.keys(TEAMS_BY_LEAGUE)) {
    const teams = TEAMS_BY_LEAGUE[league].slice().sort((a, b) => a.localeCompare(b));
    for (const name of teams) {
      out.push({
        id: `team:${league}:${name}`,
        label: name,
        group: league,
        kind: "team",
        league,
      });
    }
  }
  return out;
}

async function findArtistByKeyword(name) {
  if (!TM_KEY) return null;
  const params = new URLSearchParams();
  params.set("apikey", TM_KEY);
  params.set("segmentName", "Music");
  params.set("keyword", name);
  params.set("size", "20");
  params.set("countryCode", "US,CA");

  const url = `${TM_ATTRACTIONS}?${params.toString()}`;
  const r = await fetchJson(url);
  const list = r.json?._embedded?.attractions || [];
  const best = list.find((a) => a?.id && a?.name) || null;
  return best ? { id: best.id, name: best.name } : null;
}

async function getMusicArtists(limit = 1200) {
  if (!TM_KEY) return [];

  const pagesToFetch = 10; // up to ~2000 raw records
  const size = 200;

  const all = [];

  for (let page = 0; page < pagesToFetch; page++) {
    const url =
      `${TM_ATTRACTIONS}?apikey=${TM_KEY}` +
      `&classificationName=music` +
      `&size=${size}&page=${page}&sort=relevance,desc` +
      `&countryCode=US,CA`;

    const r = await fetchJson(url);
    if (!r.ok) continue;

    const attractions = r.json?._embedded?.attractions ?? [];
    for (const a of attractions) {
      if (!a?.id || !a?.name) continue;
      all.push({
        id: `artist:${a.id}`,
        label: a.name,
        group: "Artists",
        kind: "artist",
      });
    }
  }

  // Force include Luke Combs if still missing
  const mustHave = ["Luke Combs"];
  for (const name of mustHave) {
    const exists = all.some((x) => x.label.toLowerCase() === name.toLowerCase());
    if (!exists) {
      const found = await findArtistByKeyword(name);
      if (found?.id) {
        all.push({
          id: `artist:${found.id}`,
          label: found.name,
          group: "Artists",
          kind: "artist",
        });
      }
    }
  }

  // dedupe by label
  const map = new Map();
  for (const o of all) {
    const key = o.label.trim().toLowerCase();
    if (!map.has(key)) map.set(key, o);
  }

  return Array.from(map.values()).sort(sortByLabel).slice(0, limit);
}

export async function GET() {
  try {
    const teams = buildTeamOptions();
    const artists = await getMusicArtists(1200);
    const combined = [...teams, ...artists];

    return NextResponse.json({
      combined,
      debug: { teamsCount: teams.length, artistsCount: artists.length, combinedCount: combined.length },
    });
  } catch (err) {
    return NextResponse.json({ combined: [], error: err?.message || "Unknown error" }, { status: 500 });
  }
}
