export type AnchorCard = {
  id: string;
  name: string;
  localDate: string;
  localTime: string | null;
  city: string;
  region: string | null;
  venueName: string | null;
  lat: number | null;
  lon: number | null;
  url: string | null;
  matched: {
    favorites: string[];
    defaultGenres: string[];
    genres?: string[];
  };
  isCrossover: boolean;
};

export function groupByDate(events: AnchorCard[]) {
  const sorted = [...events].sort((a, b) => {
    const dateDiff = String(a.localDate || "").localeCompare(
      String(b.localDate || "")
    );
    if (dateDiff !== 0) return dateDiff;

    const aTime = String(a.localTime || "23:59");
    const bTime = String(b.localTime || "23:59");
    const timeDiff = aTime.localeCompare(bTime);
    if (timeDiff !== 0) return timeDiff;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  const map = new Map<string, AnchorCard[]>();

  for (const event of sorted) {
    const key = event.localDate || "Unknown Date";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(event);
  }

  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export function addDaysYMD(ymd: string, delta: number) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + delta);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}