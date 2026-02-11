import fetch from "node-fetch";

// Haversine formula to calculate distance
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { team1, team2, genre1, genre2, tripLength, radius, city } = req.body;
  const favorites = [team1, team2, genre1, genre2].filter(Boolean);

  if (favorites.length < 2) {
    return res.status(400).json({ error: "Select at least 2 teams/genres" });
  }

  const API_KEY = "CrZBYXSG2dqNSLE1yhTFS16t5w2TW0xD";

  const now = new Date();
  const startDateTime = new Date(now.getTime() - 24*60*60*1000).toISOString();
  const endDateTime = new Date(now.getTime() + (tripLength + 1)*24*60*60*1000).toISOString();

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${API_KEY}&city=${encodeURIComponent(city || "New York")}&startDateTime=${startDateTime}&endDateTime=${endDateTime}&size=200`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const events = (data._embedded?.events || []).map((e) => ({
      name: e.name,
      type: e.classifications[0].segment.name,
      date: e.dates.start.dateTime,
      venue: e._embedded.venues[0].name,
      lat: parseFloat(e._embedded.venues[0].location?.latitude),
      lng: parseFloat(e._embedded.venues[0].location?.longitude),
    }));

    const matches = [];
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const a = events[i];
        const b = events[j];

        if (favorites.includes(a.name) && favorites.includes(b.name) && a.name !== b.name) {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          const diffDays = Math.abs(dateA - dateB)/(1000*60*60*24);

          if (diffDays <= 1) {
            if (a.lat && a.lng && b.lat && b.lng) {
              const distance = getDistanceKm(a.lat, a.lng, b.lat, b.lng);
              if (distance <= radius) {
                matches.push({
                  eventA: a,
                  eventB: b,
                  diffDays,
                  distanceKm: Math.round(distance*10)/10,
                });
              }
            }
          }
        }
      }
    }

    res.status(200).json({ matches });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
}
