import { formatEventMeta } from "@/lib/format/dateTime";
import type { NormEvent } from "./utils";

export function areaEventToSharedCardProps(event: NormEvent) {
  return {
    title: event.name,
    subtitle: formatEventMeta(
      event.localDate,
      event.localTime,
      event.city,
      event.region
    ),
    primaryPill: event.pillLabel || null,
    ticketHref: event.url || null,
  };
}