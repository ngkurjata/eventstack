export function formatSectionDate(dateStr: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) {
    return dateStr || "TBD";
  }

  const d = new Date(`${dateStr}T12:00:00`);

  return d
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase();
}