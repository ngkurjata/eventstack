// FILE: lib/events/groupedGenres.ts

export type GenreFamily = "music" | "sports";

export type GroupedGenreOption = {
  id: string;
  label: string;
  family: GenreFamily;
  examples?: string[];
  aliases?: string[];
};

export const GROUPED_GENRES: GroupedGenreOption[] = [
  // =========================
  // MUSIC
  // =========================
  {
    id: "country",
    label: "Country",
    family: "music",
    examples: ["Luke Combs", "Morgan Wallen", "Jason Aldean"],
    aliases: ["country music", "nashville", "country"],
  },
  {
    id: "rock",
    label: "Rock",
    family: "music",
    examples: ["KISS", "Journey", "Def Leppard"],
    aliases: ["rock music", "classic rock", "hard rock", "arena rock"],
  },
  {
    id: "pop",
    label: "Pop",
    family: "music",
    examples: ["Taylor Swift", "Dua Lipa", "Katy Perry"],
    aliases: ["pop music", "top 40", "radio pop"],
  },
  {
    id: "hiphop",
    label: "Hip-Hop / Rap",
    family: "music",
    examples: ["Drake", "Kendrick Lamar", "Travis Scott"],
    aliases: ["hip hop", "hip-hop", "rap", "hip hop rap"],
  },
  {
    id: "alternative",
    label: "Alternative",
    family: "music",
    examples: ["The Killers", "Arctic Monkeys"],
    aliases: ["alternative rock", "alt rock", "indie rock"],
  },
  {
    id: "indie",
    label: "Indie",
    family: "music",
    examples: ["Phoebe Bridgers", "Vampire Weekend"],
    aliases: ["indie", "indie music"],
  },
  {
    id: "metal",
    label: "Metal",
    family: "music",
    examples: ["Metallica", "Slipknot"],
    aliases: ["metal", "heavy metal", "death metal"],
  },
  {
    id: "electronic",
    label: "Electronic / Dance",
    family: "music",
    examples: ["Calvin Harris", "Deadmau5"],
    aliases: ["edm", "electronic", "dance", "dj", "house", "techno"],
  },
  {
    id: "rnb",
    label: "R&B",
    family: "music",
    examples: ["Usher", "SZA"],
    aliases: ["r&b", "rhythm and blues", "soul"],
  },
  {
    id: "jazz",
    label: "Jazz",
    family: "music",
    examples: ["Herbie Hancock"],
    aliases: ["jazz", "smooth jazz"],
  },
  {
    id: "blues",
    label: "Blues",
    family: "music",
    examples: ["Buddy Guy"],
    aliases: ["blues", "blues music"],
  },
  {
    id: "folk",
    label: "Folk",
    family: "music",
    examples: ["The Lumineers"],
    aliases: ["folk", "folk music", "americana"],
  },
  {
    id: "classical",
    label: "Classical",
    family: "music",
    examples: ["Symphonies", "Orchestras"],
    aliases: ["classical", "orchestra", "symphony", "philharmonic"],
  },
  {
    id: "comedy",
    label: "Comedy",
    family: "music",
    examples: ["Chris Rock", "Kevin Hart"],
    aliases: ["comedy", "stand up", "stand-up", "comedian"],
  },

  // =========================
  // SPORTS
  // =========================
  {
    id: "hockey",
    label: "Hockey",
    family: "sports",
    examples: ["NHL", "AHL", "WHL"],
    aliases: ["nhl", "ahl", "whl", "chl", "ice hockey", "junior hockey"],
  },
  {
    id: "baseball",
    label: "Baseball",
    family: "sports",
    examples: ["MLB", "MiLB", "College Baseball"],
    aliases: ["mlb", "minor league baseball", "milb", "college baseball"],
  },
  {
    id: "football",
    label: "Football",
    family: "sports",
    examples: ["NFL", "CFL", "NCAA Football"],
    aliases: ["nfl", "cfl", "college football", "ncaa football", "gridiron"],
  },
  {
    id: "basketball",
    label: "Basketball",
    family: "sports",
    examples: ["NBA", "WNBA", "NCAA Basketball"],
    aliases: ["nba", "wnba", "college basketball", "ncaa basketball"],
  },
  {
    id: "soccer",
    label: "Soccer",
    family: "sports",
    examples: ["MLS", "Premier League"],
    aliases: ["soccer", "mls", "football club", "fc", "fifa"],
  },
  {
    id: "mma",
    label: "MMA",
    family: "sports",
    examples: ["UFC"],
    aliases: ["mma", "ufc", "mixed martial arts"],
  },
  {
    id: "wrestling",
    label: "Wrestling",
    family: "sports",
    examples: ["WWE", "AEW"],
    aliases: ["wwe", "aew", "wrestling", "pro wrestling"],
  },
  {
    id: "lacrosse",
    label: "Lacrosse",
    family: "sports",
    examples: ["NLL", "PLL"],
    aliases: ["lacrosse", "nll", "pll"],
  },
  {
    id: "rodeo",
    label: "Rodeo",
    family: "sports",
    examples: ["PBR"],
    aliases: ["rodeo", "bull riding", "pbr"],
  },
  {
    id: "motorsports",
    label: "Motorsports",
    family: "sports",
    examples: ["Formula 1", "NASCAR", "Indy"],
    aliases: [
      "formula 1",
      "f1",
      "nascar",
      "indy",
      "indycar",
      "grand prix",
      "motogp",
      "racing",
      "auto racing",
    ],
  },
  {
    id: "golf",
    label: "Golf",
    family: "sports",
    examples: ["PGA", "LPGA", "LIV Golf"],
    aliases: ["pga", "lpga", "liv golf", "tgl", "golf tournament"],
  },
  {
    id: "tennis",
    label: "Tennis",
    family: "sports",
    examples: ["ATP", "WTA", "Grand Slams"],
    aliases: ["atp", "wta", "grand slam", "us open tennis", "tennis tour"],
  },
];