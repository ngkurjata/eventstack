// FILE: app/trip/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { csvToList, decodeJsonParam } from "@/lib/url";
import { clearDraft, loadDraft, toggleDraftEvent, isInDraft, type DraftEvent } from "@/lib/tripDraft";

type Favorite = {
  id: string;
  label: string;
  attractionId: string;
  defaultGenre: string;
};

type NormEvent = {
  id: string;
  name: string;
  localDate: string;
  localTime: string | null;
  city: string;
  region: string | null;
  venueName: string | null;
  url: string | null;

  matched?: {
    favorites?: string[];
  };
};

type ContextResp = {
  anchorWindow: { start: string; end: string; daysEachSide: number };
  filters: {
    userGenres: string[];
    defaultGenres: string[];
    classificationName: string[];
    radiusMiles: number;
  };
  crossoverInWindow: boolean;
  count: number;
  events: NormEvent[];
  error?: string;
};

function groupByDate(events: NormEvent[]) {
  const m = new Map<string, NormEvent[]>();
  for (const e of events) {
    const d = e.localDate || "Unknown";
    const arr = m.get(d) || [];
    arr.push(e);
    m.set(d, arr);
  }
  return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export default function TripPage() {
  const sp = useSearchParams();
  const router = useRouter();

  const source = sp.get("source"); // "draft" or null

  // draft mode (from Area Results or from manual selection)
  const [draft, setDraft] = useState<DraftEvent[]>([]);
  const [originAirport, setOriginAirport] = useState("");

  // anchor mode (from Favorites Results)
  const anchorEventId = sp.get("anchorEventId");
  const anchorLocalDate = sp.get("anchorLocalDate") || "";
  const anchorLat = Number(sp.get("anchorLat") || "");
  const anchorLon = Number(sp.get("anchorLon") || "");
  const anchorName = sp.get("anchorName") || "";
  const anchorCity = sp.get("anchorCity") || "";
  const anchorRegion = sp.get("anchorRegion") || "";
  const anchorVenue = sp.get("anchorVenue") || "";
  const anchorUrl = sp.get("anchorUrl") || "";
  const countryCode = sp.get("countryCode") || "US,CA";

  const favorites = useMemo(() => {
    const decoded = decodeJsonParam<Favorite[]>(sp.get("favorites"));
    return Array.isArray(decoded) ? decoded : [];
  }, [sp]);

  const genres = useMemo(() => csvToList(sp.get("genres")), [sp]);

  // anchor context
  const [loading, setLoading] = useState(false);
  const [ctx, setCtx] = useState<ContextResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // load draft if draft mode
  useEffect(() => {
    if (source === "draft") {
      setDraft(loadDraft());
    }
  }, [source]);

  // load anchor context if anchor mode
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!anchorEventId) return;

      setLoading(true);
      setErr(null);
      setCtx(null);

      try {
        const r = await fetch("/api/trip/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            anchorEventId,
            anchor: {
              localDate: anchorLocalDate,
              lat: anchorLat,
              lon: anchorLon,
              city: anchorCity,
            },
            favorites,
            genres,
            radiusMiles: 90,
            countryCode,
          }),
        });

        const j = (await r.json()) as ContextResp;
        if (!r.ok) throw new Error((j as any)?.error || "Failed");

        if (!cancelled) setCtx(j);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [anchorEventId, anchorLocalDate, anchorLat, anchorLon, anchorCity, favorites, genres, countryCode]);

  // selection helpers for anchor-mode events
  function toDraftEventFromNorm(e: NormEvent): DraftEvent {
    return {
      id: e.id,
      name: e.name,
      localDate: e.localDate,
      localTime: e.localTime,
      city: e.city,
      region: e.region,
      venueName: e.venueName,
      url: e.url,
    };
  }

  function toggleFromCtx(e: NormEvent) {
    const next = toggleDraftEvent(toDraftEventFromNorm(e));
    setDraft(next);
  }

  function clearAll() {
    clearDraft();
    setDraft([]);
  }

  function copyShareLink() {
    navigator.clipboard?.writeText(window.location.href);
    alert("Share link copied.");
  }

  const grouped = useMemo(() => groupByDate(ctx?.events || []), [ctx]);

  // Expedia links: keep simple/stable
  const expediaHome = "https://www.expedia.com/";
  const expediaHotels = "https://www.expedia.com/Hotels";
  const expediaFlights = "https://www.expedia.com/Flights";
  const expediaPackages = "https://www.expedia.com/Vacation-Packages";

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Trip Builder</h1>
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            {anchorEventId ? (
              <>
                Anchor: <b>{anchorName || anchorEventId}</b> • {anchorLocalDate} • {anchorCity}{anchorRegion ? `, ${anchorRegion}` : ""} • {anchorVenue}
              </>
            ) : (
              <>Draft-based trip (selected events)</>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={copyShareLink} style={{ padding: "10px 12px" }}>Copy Share Link</button>
          <button onClick={clearAll} style={{ padding: "10px 12px" }}>Clear Selection</button>
          <button onClick={() => router.push("/")} style={{ padding: "10px 12px" }}>Home</button>
        </div>
      </div>

      <div style={{ marginTop: 14, border: "1px solid #eee", borderRadius: 14, padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, alignItems: "end" }}>
          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Departure airport (IATA)</div>
            <input value={originAirport} onChange={(e) => setOriginAirport(e.target.value)} placeholder="YVR" style={{ width: "100%", padding: 10 }} />
          </label>

          <a href={expediaHotels} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <button style={{ width: "100%", padding: "10px 12px" }}>Hotels (Expedia)</button>
          </a>
          <a href={expediaFlights} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <button style={{ width: "100%", padding: "10px 12px" }}>Flights (Expedia)</button>
          </a>
          <a href={expediaPackages} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <button style={{ width: "100%", padding: "10px 12px" }}>Packages (Expedia)</button>
          </a>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          Tip: This page is shareable by URL. Expedia links are generic/stable; if you want deep links with dates/route, we can add those next.
        </div>
      </div>

      {/* Anchor context section */}
      {anchorEventId && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>
              Trip Window: ±{ctx?.anchorWindow?.daysEachSide ?? 3} days
              {ctx?.anchorWindow ? ` • ${ctx.anchorWindow.start} → ${ctx.anchorWindow.end}` : ""}
              {ctx?.crossoverInWindow ? (
                <span style={{ marginLeft: 10, fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "rgba(255, 210, 80, 0.35)" }}>
                  CROSSOVER FOUND IN WINDOW
                </span>
              ) : null}
            </div>
            {anchorUrl ? (
              <a href={anchorUrl} target="_blank" rel="noreferrer">Anchor tickets</a>
            ) : null}
          </div>

          {loading && <div style={{ marginTop: 12 }}>Loading trip context…</div>}
          {err && <div style={{ marginTop: 12, color: "crimson" }}>{err}</div>}

          {!loading && !err && ctx && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
                Filters: user genres [{ctx.filters.userGenres.join(", ") || "—"}] • default genres [{ctx.filters.defaultGenres.join(", ") || "—"}]
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {grouped.map(([date, items]) => (
                  <div key={date} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>{date}</div>
                    <div style={{ display: "grid", gap: 10 }}>
                      {items.map((e) => {
                        const checked = isInDraft(e.id);
                        const isFav = (e.matched?.favorites || []).length >= 1;
                        return (
                          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <div>
                              <div style={{ fontWeight: 700 }}>
                                {e.name}{" "}
                                {isFav && (
                                  <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "rgba(0,0,0,0.07)" }}>
                                    Favorite
                                  </span>
                                )}
                              </div>
                              <div style={{ opacity: 0.75, marginTop: 2 }}>
                                {e.localTime ? `${e.localTime} • ` : ""}{e.city}{e.region ? `, ${e.region}` : ""} • {e.venueName || "Venue"}
                              </div>
                              {e.url && (
                                <div style={{ marginTop: 4 }}>
                                  <a href={e.url} target="_blank" rel="noreferrer">Tickets</a>
                                </div>
                              )}
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <input type="checkbox" checked={checked} onChange={() => toggleFromCtx(e)} />
                                Select
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {ctx.events.length === 0 && <div style={{ marginTop: 12, opacity: 0.7 }}>No events in this window after dedupe.</div>}
            </div>
          )}
        </div>
      )}

      {/* Draft summary always visible */}
      <div style={{ marginTop: 18 }}>
        <h2 style={{ marginBottom: 8 }}>Selected events</h2>
        <div style={{ opacity: 0.8, marginBottom: 10 }}>
          Count: <b>{draft.length}</b>
        </div>

        {draft.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No events selected yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {draft
              .slice()
              .sort((a, b) => (a.localDate.localeCompare(b.localDate)) || a.name.localeCompare(b.name))
              .map((e) => (
                <div key={e.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>{e.name}</div>
                      <div style={{ opacity: 0.75, marginTop: 4 }}>
                        {e.localDate}{e.localTime ? ` • ${e.localTime}` : ""} • {e.city}{e.region ? `, ${e.region}` : ""} • {e.venueName || "Venue"}
                      </div>
                      {e.url && (
                        <div style={{ marginTop: 6 }}>
                          <a href={e.url} target="_blank" rel="noreferrer">Tickets</a>
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        onClick={() => {
                          const next = toggleDraftEvent(e);
                          setDraft(next);
                        }}
                        style={{ padding: "10px 12px" }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.7 }}>
        If you want the trip page to persist to a backend (true “saved trips”), we can add a /api/trips/save endpoint next.
      </div>
    </div>
  );
}