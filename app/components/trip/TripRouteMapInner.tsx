"use client";

import React, { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";

type TripMapEvent = {
  id: string;
  title: string;
  date?: string | null;
  localTime?: string | null;
  city?: string | null;
  region?: string | null;
  venueName?: string | null;
  lat: number;
  lon: number;
  orderLabel: string;
};

type PlottedTripMapEvent = TripMapEvent & {
  plotLat: number;
  plotLon: number;
};

type Props = {
  events: TripMapEvent[];
};

function FitBounds({ events }: { events: PlottedTripMapEvent[] }) {
  const map = useMap();

  useEffect(() => {
    if (!events.length) return;

    if (events.length === 1) {
      const center: LatLngTuple = [events[0].plotLat, events[0].plotLon];
      map.setView(center, 9);
      return;
    }

    const bounds: LatLngBoundsExpression = events.map(
      (e) => [e.plotLat, e.plotLon] as LatLngTuple
    );

    map.fitBounds(bounds, { padding: [40, 40] });
  }, [events, map]);

  return null;
}

function makeNumberIcon(label: string) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width: 34px;
        height: 34px;
        border-radius: 9999px;
        background: #0f172a;
        color: white;
        border: 2px solid white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-size: 14px;
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.25);
      ">
        ${label}
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    tooltipAnchor: [0, -18],
  });
}

function makeDistanceIcon(distanceText: string, timeText: string) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-width: 84px;
        padding: 7px 10px;
        border-radius: 14px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.18);
        text-align: center;
        white-space: nowrap;
        line-height: 1.1;
      ">
        <div style="
          font-size: 12px;
          font-weight: 900;
          color: #0f172a;
          letter-spacing: 0.05em;
        ">
          ${distanceText}
        </div>
        <div style="
          margin-top: 3px;
          font-size: 11px;
          font-weight: 900;
          color: #0f172a;
          letter-spacing: 0.05em;
        ">
          ${timeText}
        </div>
      </div>
    `,
    iconSize: [84, 40],
    iconAnchor: [42, 20],
  });
}

function fmtWhen(date?: string | null, localTime?: string | null) {
  const parts = [String(date || "").trim(), String(localTime || "").trim()].filter(
    Boolean
  );
  return parts.join(" • ");
}

function spreadOverlappingEvents(events: TripMapEvent[]): PlottedTripMapEvent[] {
  const seen = new Map<string, number>();
  const radius = 0.0000001;

  return events.map((event) => {
    const key = `${event.lat.toFixed(4)},${event.lon.toFixed(4)}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);

    if (count === 0) {
      return {
        ...event,
        plotLat: event.lat,
        plotLon: event.lon,
      };
    }

    const angle = count * 0.9;
    const latOffset = Math.sin(angle) * radius;
    const lonOffset = Math.cos(angle) * radius;

    return {
      ...event,
      plotLat: event.lat + latOffset,
      plotLon: event.lon + lonOffset,
    };
  });
}

function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

function formatMiles(miles: number) {
  return `${Math.round(miles)} MI`;
}

function formatDriveTime(miles: number) {
  const totalMinutes = Math.max(1, Math.round((miles / 60) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes}M`;
  }

  if (minutes === 0) {
    return `${hours}H`;
  }

  return `${hours}H ${minutes}M`;
}

export default function TripRouteMapInner({ events }: Props) {
  const [showSegmentLabels, setShowSegmentLabels] = useState(true);

  const validEvents = useMemo(
    () =>
      events.filter(
        (event) => Number.isFinite(event.lat) && Number.isFinite(event.lon)
      ),
    [events]
  );

  const plottedEvents = useMemo(
    () => spreadOverlappingEvents(validEvents),
    [validEvents]
  );

  const center = useMemo<LatLngTuple | null>(() => {
    if (!plottedEvents.length) return null;
    return [plottedEvents[0].plotLat, plottedEvents[0].plotLon];
  }, [plottedEvents]);

  const positions = useMemo<LatLngTuple[]>(
    () =>
      plottedEvents.map(
        (event) => [event.plotLat, event.plotLon] as LatLngTuple
      ),
    [plottedEvents]
  );

  const segments = useMemo(() => {
    const segs: {
      mid: LatLngTuple;
      distanceText: string;
      timeText: string;
    }[] = [];

    for (let i = 0; i < plottedEvents.length - 1; i++) {
      const a = plottedEvents[i];
      const b = plottedEvents[i + 1];

      const miles = haversineMiles(
        { lat: a.lat, lon: a.lon },
        { lat: b.lat, lon: b.lon }
      );

      if (miles < 0.5) continue;

      const mid: LatLngTuple = [
        (a.plotLat + b.plotLat) / 2,
        (a.plotLon + b.plotLon) / 2,
      ];

      segs.push({
        mid,
        distanceText: formatMiles(miles),
        timeText: formatDriveTime(miles),
      });
    }

    return segs;
  }, [plottedEvents]);

  if (!plottedEvents.length || !center) return null;

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="relative h-[420px] w-full">
        <div className="pointer-events-none absolute right-3 top-3 z-[1000]">
          <button
            type="button"
            onClick={() => setShowSegmentLabels((prev) => !prev)}
            className="pointer-events-auto rounded-2xl border border-slate-300 bg-white/95 px-4 py-2 text-xs font-extrabold text-slate-900 shadow-md backdrop-blur-sm transition hover:bg-white"
          >
            {showSegmentLabels ? "HIDE DIST / TIME" : "SHOW DIST / TIME"}
          </button>
        </div>

        <MapContainer
          center={center}
          zoom={5}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitBounds events={plottedEvents} />

          {positions.length >= 2 ? (
            <Polyline
              positions={positions}
              pathOptions={{
                color: "#0f172a",
                weight: 4,
                opacity: 0.75,
              }}
            />
          ) : null}

          {showSegmentLabels
            ? segments.map((seg, i) => (
                <Marker
                  key={`seg-${i}`}
                  position={seg.mid}
                  icon={makeDistanceIcon(seg.distanceText, seg.timeText)}
                />
              ))
            : null}

          {plottedEvents.map((event) => {
            const markerPosition: LatLngTuple = [event.plotLat, event.plotLon];

            return (
              <Marker
                key={event.id}
                position={markerPosition}
                icon={makeNumberIcon(event.orderLabel)}
              >
                <Tooltip>
                  <div className="min-w-[180px]">
                    <div className="font-extrabold text-slate-900">
                      {event.orderLabel}. {event.title}
                    </div>

                    <div className="mt-1 text-xs font-semibold text-slate-600">
                      {fmtWhen(event.date, event.localTime)}
                    </div>

                    <div className="mt-1 text-xs text-slate-600">
                      {[event.city, event.region].filter(Boolean).join(", ")}
                    </div>

                    {event.venueName ? (
                      <div className="mt-1 text-xs text-slate-600">
                        {event.venueName}
                      </div>
                    ) : null}
                  </div>
                </Tooltip>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}