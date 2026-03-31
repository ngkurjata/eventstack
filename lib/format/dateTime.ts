export function formatEventMeta(
  localDate?: string | null,
  localTime?: string | null,
  city?: string | null,
  region?: string | null
) {
  const parts: string[] = [];

  // ✅ TIME ONLY
  if (localTime) {
    const [rawHour, rawMinute] = String(localTime).split(":");
    const hour = Number(rawHour);
    const minute = Number(rawMinute ?? "0");

    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      const d = new Date();
      d.setHours(hour, minute, 0, 0);

      parts.push(
        d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      );
    }
  }

  // ✅ LOCATION
  if (city && region) {
    parts.push(`${city}, ${region}`);
  } else if (city) {
    parts.push(city);
  } else if (region) {
    parts.push(region);
  }

  return parts.join(" · ");
}