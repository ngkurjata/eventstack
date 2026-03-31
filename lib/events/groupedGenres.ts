import type { GenreKey } from "@/lib/events/genres";

export type GenreFamily = "music" | "sports";

export type GroupedGenreOption = {
  id: GenreKey;
  label: string;
  family: GenreFamily;
  examples?: string[];
  aliases?: string[];
};

export const GROUPED_GENRES: GroupedGenreOption[] = [
  {
    id: "country",
    label: "Country",
    family: "music",
    examples: ["Luke Combs", "Morgan Wallen", "Jason Aldean"],
    aliases: ["country music", "americana", "bluegrass", "folk"],
  },
  {
    id: "rock",
    label: "Rock",
    family: "music",
    examples: ["KISS", "Journey", "Def Leppard"],
    aliases: ["alternative", "alternative rock", "alt rock", "indie", "indie rock", "classic rock"],
  },
  {
    id: "pop",
    label: "Pop",
    family: "music",
    examples: ["Taylor Swift", "Dua Lipa", "Katy Perry"],
    aliases: ["pop music", "top 40", "dance pop"],
  },
  {
    id: "hip_hop",
    label: "Hip-Hop/Rap",
    family: "music",
    examples: ["Drake", "Kendrick Lamar", "Travis Scott"],
    aliases: ["hip hop", "hip-hop", "rap", "trap"],
  },
  {
    id: "electronic",
    label: "Electronic",
    family: "music",
    examples: ["Calvin Harris", "Deadmau5"],
    aliases: ["electronic / dance", "edm", "dance", "house", "techno", "dj"],
  },
  {
    id: "rnb",
    label: "R&B",
    family: "music",
    examples: ["Usher", "SZA"],
    aliases: ["rhythm and blues", "soul"],
  },
  {
    id: "metal",
    label: "Metal",
    family: "music",
    examples: ["Metallica", "Slipknot"],
    aliases: ["heavy metal", "death metal"],
  },
  {
    id: "latin",
    label: "Latin",
    family: "music",
    examples: ["Bad Bunny", "Karol G"],
    aliases: ["reggaeton", "regional mexican", "tejano", "salsa"],
  },
  {
    id: "jazz",
    label: "Jazz",
    family: "music",
    examples: ["Herbie Hancock"],
    aliases: ["smooth jazz", "big band"],
  },
  {
    id: "blues",
    label: "Blues",
    family: "music",
    examples: ["Buddy Guy"],
    aliases: ["delta blues", "electric blues"],
  },
  {
    id: "classical",
    label: "Classical",
    family: "music",
    examples: ["Symphonies", "Orchestras"],
    aliases: ["orchestra", "symphony", "philharmonic", "opera"],
  },
  {
    id: "comedy",
    label: "Comedy",
    family: "music",
    examples: ["Chris Rock", "Kevin Hart"],
    aliases: ["stand up", "stand-up", "comedian"],
  },
  {
    id: "theatre",
    label: "Theatre",
    family: "music",
    examples: ["Broadway", "Musicals"],
    aliases: ["theater", "musical", "cabaret"],
  },
  {
    id: "football",
    label: "Football",
    family: "sports",
    examples: ["NFL", "CFL", "NCAA Football"],
    aliases: ["gridiron", "nfl", "cfl", "college football"],
  },
  {
    id: "basketball",
    label: "Basketball",
    family: "sports",
    examples: ["NBA", "WNBA", "NCAA Basketball"],
    aliases: ["nba", "wnba", "college basketball"],
  },
  {
    id: "baseball",
    label: "Baseball",
    family: "sports",
    examples: ["MLB", "MiLB", "College Baseball"],
    aliases: ["mlb", "milb", "minor league baseball"],
  },
  {
    id: "hockey",
    label: "Hockey",
    family: "sports",
    examples: ["NHL", "AHL", "WHL"],
    aliases: ["nhl", "ahl", "whl", "ice hockey"],
  },
  {
    id: "soccer",
    label: "Soccer",
    family: "sports",
    examples: ["MLS", "Premier League"],
    aliases: ["mls", "fifa", "football club", "fc"],
  },
  {
    id: "motorsports",
    label: "Motorsports",
    family: "sports",
    examples: ["Formula 1", "NASCAR", "IndyCar"],
    aliases: ["formula 1", "f1", "nascar", "indy", "auto racing"],
  },
  {
    id: "combat_sports",
    label: "Combat Sports",
    family: "sports",
    examples: ["UFC", "WWE", "AEW", "Boxing"],
    aliases: ["mma", "ufc", "wrestling", "boxing", "pro wrestling"],
  },
  {
    id: "equestrian",
    label: "Horse Racing",
    family: "sports",
    examples: ["Derby", "Thoroughbred Racing"],
    aliases: ["horse racing", "equestrian", "derby"],
  },
  {
    id: "golf",
    label: "Golf",
    family: "sports",
    examples: ["PGA", "LPGA", "LIV Golf"],
    aliases: ["pga", "lpga", "golf tournament"],
  },
  {
    id: "tennis",
    label: "Tennis",
    family: "sports",
    examples: ["ATP", "WTA", "Grand Slams"],
    aliases: ["atp", "wta", "grand slam", "us open tennis"],
  },
];