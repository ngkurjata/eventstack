// FILE: lib/geo/metroOverrides.ts

export type MetroKey = string; // "US|CA|Inglewood", "CA|ON|Mississauga"

/**
 * Conservative metro normalization: exact-ish city matches scoped by country + region (state/province),
 * with light normalization (trim, collapse spaces, standardize punctuation) to reduce duplicate keys.
 *
 * Goal: replace "suburb" venue cities with the metro label users expect.
 *
 * Add entries freely; no code changes needed elsewhere.
 */
export const METRO_CITY_OVERRIDES: Record<MetroKey, string> = {
  // =========================
  // UNITED STATES (US)
  // =========================

  // --- Los Angeles Metro (CA) ---
  "US|CA|los angeles": "Los Angeles",
  "US|CA|long beach": "Los Angeles",
  "US|CA|inglewood": "Los Angeles",
  "US|CA|anaheim": "Los Angeles",
  "US|CA|santa ana": "Los Angeles",
  "US|CA|irvine": "Los Angeles",
  "US|CA|pasadena": "Los Angeles",
  "US|CA|glendale": "Los Angeles",
  "US|CA|burbank": "Los Angeles",
  "US|CA|carson": "Los Angeles",
  "US|CA|torrance": "Los Angeles",
  "US|CA|el segundo": "Los Angeles",
  "US|CA|ontario": "Los Angeles",
  "US|CA|pomona": "Los Angeles",
  "US|CA|san bernardino": "Los Angeles",
  // common additions
  "US|CA|santa monica": "Los Angeles",
  "US|CA|west hollywood": "Los Angeles",
  "US|CA|hollywood": "Los Angeles",
  "US|CA|universal city": "Los Angeles",
  "US|CA|thousand oaks": "Los Angeles",

  // --- San Diego Metro (CA) ---
  "US|CA|san diego": "San Diego",
  "US|CA|chula vista": "San Diego",
  "US|CA|national city": "San Diego",
  "US|CA|escondido": "San Diego",
  "US|CA|oceanside": "San Diego",

  // --- San Francisco Bay Area (CA) ---
  "US|CA|san francisco": "San Francisco",
  "US|CA|oakland": "San Francisco",
  "US|CA|san jose": "San Francisco",
  "US|CA|santa clara": "San Francisco",
  "US|CA|san mateo": "San Francisco",
  "US|CA|berkeley": "San Francisco",
  "US|CA|daly city": "San Francisco",
  "US|CA|south san francisco": "San Francisco",
  "US|CA|mountain view": "San Francisco",
  "US|CA|palo alto": "San Francisco",
  "US|CA|redwood city": "San Francisco",

  // --- New York City Metro (NY/NJ/CT) ---
  "US|NY|new york": "New York",
  "US|NY|brooklyn": "New York",
  "US|NY|queens": "New York",
  "US|NY|bronx": "New York",
  "US|NY|staten island": "New York",
  "US|NY|elmont": "New York",
  "US|NY|uniondale": "New York",
  "US|NY|white plains": "New York",
  "US|NJ|east rutherford": "New York",
  "US|NJ|newark": "New York",
  "US|NJ|jersey city": "New York",
  "US|NJ|hoboken": "New York",
  "US|CT|stamford": "New York",
  "US|CT|bridgeport": "New York",
  // common additions
  "US|NJ|secaucus": "New York",
  "US|NJ|paterson": "New York",
  "US|NJ|union city": "New York",

  // --- Philadelphia (PA/NJ/DE) ---
  "US|PA|philadelphia": "Philadelphia",
  "US|PA|chester": "Philadelphia",
  "US|NJ|camden": "Philadelphia",
  "US|DE|wilmington": "Philadelphia",

  // --- Washington DC Metro (DC/VA/MD) ---
  "US|DC|washington": "Washington",
  "US|VA|arlington": "Washington",
  "US|VA|alexandria": "Washington",
  "US|VA|fairfax": "Washington",
  "US|VA|tysons": "Washington",
  "US|MD|bethesda": "Washington",
  "US|MD|silver spring": "Washington",
  "US|MD|college park": "Washington",
  "US|MD|landover": "Washington",
  "US|MD|oxon hill": "Washington",

  // --- Boston (MA/NH/RI) ---
  "US|MA|boston": "Boston",
  "US|MA|cambridge": "Boston",
  "US|MA|somerville": "Boston",
  "US|MA|worcester": "Boston",
  "US|MA|lowell": "Boston",
  "US|MA|foxborough": "Boston",
  "US|NH|manchester": "Boston",
  "US|RI|providence": "Boston",

  // --- Chicago (IL/IN) ---
  "US|IL|chicago": "Chicago",
  "US|IL|rosemont": "Chicago",
  "US|IL|schaumburg": "Chicago",
  "US|IL|evanston": "Chicago",
  "US|IL|naperville": "Chicago",
  "US|IN|gary": "Chicago",
  // common additions
  "US|IL|tinley park": "Chicago",
  "US|IL|aurora": "Chicago",
  "US|IL|champaign": "Chicago", // sometimes appears for big shows marketed as Chicago area (optional)

  // --- Minneapolis–Saint Paul (MN) ---
  "US|MN|minneapolis": "Minneapolis",
  "US|MN|saint paul": "Minneapolis",
  "US|MN|st paul": "Minneapolis",
  "US|MN|bloomington": "Minneapolis",

  // --- Seattle Metro (WA) ---
  "US|WA|seattle": "Seattle",
  "US|WA|tacoma": "Seattle",
  "US|WA|kent": "Seattle",
  "US|WA|bellevue": "Seattle",
  "US|WA|everett": "Seattle",

  // --- Denver (CO) ---
  "US|CO|denver": "Denver",
  "US|CO|commerce city": "Denver",
  "US|CO|aurora": "Denver",
  "US|CO|lakewood": "Denver",
  "US|CO|englewood": "Denver",

  // --- Phoenix (AZ) ---
  "US|AZ|phoenix": "Phoenix",
  "US|AZ|glendale": "Phoenix",
  "US|AZ|tempe": "Phoenix",
  "US|AZ|mesa": "Phoenix",
  "US|AZ|scottsdale": "Phoenix",

  // --- Las Vegas (NV) ---
  "US|NV|las vegas": "Las Vegas",
  "US|NV|paradise": "Las Vegas",
  "US|NV|henderson": "Las Vegas",

  // --- Dallas–Fort Worth (TX) ---
  "US|TX|dallas": "Dallas",
  "US|TX|fort worth": "Dallas",
  "US|TX|arlington": "Dallas",
  "US|TX|irving": "Dallas",
  "US|TX|frisco": "Dallas",
  "US|TX|grapevine": "Dallas",

  // --- Houston (TX) ---
  "US|TX|houston": "Houston",
  "US|TX|sugar land": "Houston",
  "US|TX|the woodlands": "Houston",
  "US|TX|pasadena": "Houston",
  "US|TX|katy": "Houston",

  // --- Austin (TX) ---
  "US|TX|austin": "Austin",
  "US|TX|cedar park": "Austin",
  "US|TX|round rock": "Austin",

  // --- Miami (FL) ---
  "US|FL|miami": "Miami",
  "US|FL|miami beach": "Miami",
  "US|FL|miami gardens": "Miami",
  "US|FL|fort lauderdale": "Miami",
  "US|FL|hollywood": "Miami",
  "US|FL|sunrise": "Miami",

  // --- Tampa Bay (FL) ---
  "US|FL|tampa": "Tampa",
  "US|FL|st petersburg": "Tampa",
  "US|FL|saint petersburg": "Tampa",
  "US|FL|clearwater": "Tampa",

  // --- Orlando (FL) ---
  "US|FL|orlando": "Orlando",
  "US|FL|kissimmee": "Orlando",

  // --- Atlanta (GA) ---
  "US|GA|atlanta": "Atlanta",
  "US|GA|college park": "Atlanta",
  "US|GA|duluth": "Atlanta",
  "US|GA|marietta": "Atlanta",

  // =========================
  // CANADA (CA)
  // =========================

  // --- Metro Vancouver (BC) ---
  "CA|BC|vancouver": "Vancouver",
  "CA|BC|richmond": "Vancouver",
  "CA|BC|burnaby": "Vancouver",
  "CA|BC|surrey": "Vancouver",
  "CA|BC|new westminster": "Vancouver",
  "CA|BC|coquitlam": "Vancouver",
  "CA|BC|port coquitlam": "Vancouver",
  "CA|BC|port moody": "Vancouver",
  "CA|BC|langley": "Vancouver",
  "CA|BC|delta": "Vancouver",
  "CA|BC|north vancouver": "Vancouver",
  "CA|BC|west vancouver": "Vancouver",

  // --- Greater Victoria (BC) ---
  "CA|BC|victoria": "Victoria",
  "CA|BC|saanich": "Victoria",
  "CA|BC|esquimalt": "Victoria",
  "CA|BC|langford": "Victoria",
  "CA|BC|colwood": "Victoria",

  // --- Calgary Metro (AB) ---
  "CA|AB|calgary": "Calgary",
  "CA|AB|airdrie": "Calgary",
  "CA|AB|cochrane": "Calgary",
  "CA|AB|okotoks": "Calgary",

  // --- Edmonton Metro (AB) ---
  "CA|AB|edmonton": "Edmonton",
  "CA|AB|st albert": "Edmonton",
  "CA|AB|st. albert": "Edmonton",
  "CA|AB|sherwood park": "Edmonton",
  "CA|AB|spruce grove": "Edmonton",
  "CA|AB|leduc": "Edmonton",

  // --- Winnipeg Metro (MB) ---
  "CA|MB|winnipeg": "Winnipeg",

  // --- Greater Toronto Area (ON) ---
  "CA|ON|toronto": "Toronto",
  "CA|ON|mississauga": "Toronto",
  "CA|ON|brampton": "Toronto",
  "CA|ON|vaughan": "Toronto",
  "CA|ON|markham": "Toronto",
  "CA|ON|richmond hill": "Toronto",
  "CA|ON|oakville": "Toronto",
  "CA|ON|burlington": "Toronto",
  "CA|ON|pickering": "Toronto",
  "CA|ON|ajax": "Toronto",
  "CA|ON|whitby": "Toronto",
  "CA|ON|oshawa": "Toronto",
  // common additions
  "CA|ON|scarborough": "Toronto",
  "CA|ON|etobicoke": "Toronto",
  "CA|ON|north york": "Toronto",

  // --- Ottawa–Gatineau (ON/QC) ---
  "CA|ON|ottawa": "Ottawa",
  "CA|QC|gatineau": "Ottawa",

  // --- Montréal (QC) ---
  "CA|QC|montreal": "Montreal",
  "CA|QC|montréal": "Montreal",
  "CA|QC|laval": "Montreal",
  "CA|QC|longueuil": "Montreal",
  "CA|QC|brossard": "Montreal",

  // --- Québec City (QC) ---
  "CA|QC|quebec": "Quebec City",
  "CA|QC|québec": "Quebec City",

  // --- Halifax (NS) ---
  "CA|NS|halifax": "Halifax",
  "CA|NS|dartmouth": "Halifax",
};

function normToken(s: any) {
  // light normalization: trim, collapse spaces, lowercase
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function metroKey(country: string | null, region: string | null, city: string) {
  return `${normToken(country)}|${normToken(region)}|${normToken(city)}` as MetroKey;
}

export function canonicalMetroCity(rawCity: string, region: string | null, country: string | null) {
  const city = String(rawCity || "").trim();
  const key = metroKey(country, region, city);
  return METRO_CITY_OVERRIDES[key] ?? city;
}