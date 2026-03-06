"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "@/app/components/BrandLogo";
import { csvToList } from "@/lib/url";
import {
  BuildTripPayload,
  RowEvent,
  coerceTripContextResponse,
  encodeBuildTripDataParam,
  eventKey,
  fmtYMDPretty,
  groupByDate,
  isYMD,
} from "@/lib/trips/sharePayload";

type Favorite = {
  id: string;
  label: string;
  attractionId: string;
  defaultGenre: string;
};

type AnchorCard = {
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
  };

  isCrossover: boolean;
};

type ApiResp = {
  mode: "favorites";
  favorites: { id: string; label: string; defaultGenre: string }[];
  startDate: string | null;
  endDate: string | null;
  count: number;
  anchorCards: AnchorCard[];
  error?: string;
};

type ContextState = {
  loading: boolean;
  error: string;
  anchor?: RowEvent | null;
  events: RowEvent[];
  // selections are keyed by stable eventKey()
  selected: Record<string, boolean>;
};

const BUILD_TRIP_ROUTE = "/build-trip"; // change this if your hub route differs

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function makeFavorite(id: string, label: string, attractionId: string, defaultGenre: string): Favorite {
  return { id, label, attractionId, defaultGenre };
}

function normalizeIata(raw: string) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
}

function anchorToRowEvent(a: AnchorCard): RowEvent {
  return {
    date: a.localDate || null,
    name: a.name || "Anchor event",
    location: [a.city, a.region].filter(Boolean).join(", "),
    genre: (a.matched?.defaultGenres || [])[0] || null,
    url: a.url || null,
    lat: typeof a.lat === "number" ? a.lat : null,
    lon: typeof a.lon === "number" ? a.lon : null,
    localTime: a.localTime || null,
  };
}

function ensureAnchorIncluded(anchor: RowEvent | null | undefined, events: RowEvent[]) {
  const out = Array.isArray(events) ? [...events] : [];
  if (!anchor) return out;

  const ak = eventKey(anchor);
  const exists = out.some((e) => eventKey(e) === ak);
  if (!exists) out.unshift(anchor);
  return out;
}

function isRenderableRowEvent(e: RowEvent) {
  const name = String(e?.name || "").trim();
  const loc = String(e?.location || "").trim();

  // Drop placeholder / incomplete rows
  if (!name) return false;
  if (name.toLowerCase().includes("untitled")) return false;

  // optional: also require a real location (prevents "Location TBD" rows)
  if (!loc) return false;
  if (loc.toLowerCase().includes("location tbd")) return false;

  return true;
}

export default function FavoritesResultsPage() {
  const sp = useSearchParams();
  const router = useRouter();

  // Keep Area Search unaffected: this page does only favorites behavior.
  const countryCode = sp.get("countryCode") || "US,CA";

  const f1 = useMemo(() => {
    return makeFavorite(
      "F1",
      sp.get("f1Label") || "",
      sp.get("f1AttractionId") || "",
      sp.get("f1DefaultGenre") || "Hockey"
    );
  }, [sp]);

  const hasF2 = !!sp.get("f2AttractionId");
  const f2 = useMemo(() => {
    if (!hasF2) return null;
    return makeFavorite(
      "F2",
      sp.get("f2Label") || "",
      sp.get("f2AttractionId") || "",
      sp.get("f2DefaultGenre") || "Country"
    );
  }, [sp, hasF2]);

  const start = sp.get("start");
  const end = sp.get("end");
  const userGenres = csvToList(sp.get("genres"));

  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Accordion open card id
  const [openId, setOpenId] = useState<string | null>(null);

  // Per-anchor context cache + selection
  const [ctxByAnchor, setCtxByAnchor] = useState<Record<string, ContextState>>({});

  // Departure airport (optional)
  const [airportIata, setAirportIata] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);

      try {
        const r = await fetch("/api/search/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            favorite1: f1,
            favorite2: f2,
            startDate: start || null,
            endDate: end || null,
            countryCode,
          }),
        });

        const j = (await r.json()) as ApiResp;
        if (!r.ok) throw new Error((j as any)?.error || "Failed");

        if (!cancelled) setResp(j);
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
  }, [f1, f2, start, end, countryCode]);

  const cards = resp?.anchorCards || [];

  const header = useMemo(() => {
    const favs = [f1.label, f2?.label].filter(Boolean).join(" + ");
    const datePart = start && end ? `${start} → ${end}` : "All upcoming";
    const genresPart = userGenres.length ? ` • +${userGenres.join(", ")}` : "";
    return `${favs} • ${datePart}${genresPart}`;
  }, [f1.label, f2?.label, start, end, userGenres]);

  const favoritesPayload = useMemo(() => [f1, ...(f2 ? [f2] : [])], [f1, f2]);

  async function fetchContextIfNeeded(card: AnchorCard) {
    if (!card.localDate || !isYMD(card.localDate) || !card.lat || !card.lon) {
      setCtxByAnchor((prev) => ({
        ...prev,
        [card.id]: {
          loading: false,
          error: "This anchor is missing valid localDate/lat/lon; cannot load nearby events.",
          events: [],
          selected: prev[card.id]?.selected || {},
        },
      }));
      return;
    }

    // If we already have events or currently loading, don't refetch.
    const existing = ctxByAnchor[card.id];
    if (existing?.loading) return;
    if (existing && existing.events.length > 0) return;

    setCtxByAnchor((prev) => ({
      ...prev,
      [card.id]: {
        loading: true,
        error: "",
        anchor: prev[card.id]?.anchor ?? null,
        events: prev[card.id]?.events ?? [],
        selected: prev[card.id]?.selected ?? {},
      },
    }));

    try {
      const body = {
        // Send multiple likely key names to stay compatible with the existing API.
        anchorLocalDate: card.localDate,
        anchorLat: card.lat,
        anchorLon: card.lon,

        localDate: card.localDate,
        lat: card.lat,
        lon: card.lon,

        favorites: favoritesPayload,
        genres: userGenres,
        countryCode,
      };

      const r = await fetch("/api/trip/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
      });

      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((json as any)?.error || `Context failed (${r.status})`);

      const { anchor, events } = coerceTripContextResponse(json);
      const resolvedAnchor = anchor || anchorToRowEvent(card);
      const withAnchor = ensureAnchorIncluded(resolvedAnchor, events);

      setCtxByAnchor((prev) => ({
        ...prev,
        [card.id]: {
          loading: false,
          error: "",
          anchor: resolvedAnchor,
          events: withAnchor,
          selected: prev[card.id]?.selected ?? {},
        },
      }));
    } catch (e: any) {
      setCtxByAnchor((prev) => ({
        ...prev,
        [card.id]: {
          loading: false,
          error: e?.message || "Failed to load nearby events",
          anchor: prev[card.id]?.anchor ?? anchorToRowEvent(card),
          events: prev[card.id]?.events ?? [],
          selected: prev[card.id]?.selected ?? {},
        },
      }));
    }
  }

  function toggleOpen(card: AnchorCard) {
    setOpenId((prev) => {
      const next = prev === card.id ? null : card.id;
      return next;
    });
  }

  // When opening a card, fetch context (once).
  useEffect(() => {
    if (!openId) return;
    const card = cards.find((c) => c.id === openId);
    if (!card) return;
    fetchContextIfNeeded(card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  function setChecked(anchorId: string, e: RowEvent, checked: boolean) {
    const k = eventKey(e);
    setCtxByAnchor((prev) => {
      const cur = prev[anchorId] || { loading: false, error: "", events: [], selected: {} };
      return {
        ...prev,
        [anchorId]: {
          ...cur,
          selected: {
            ...cur.selected,
            [k]: checked,
          },
        },
      };
    });
  }

  function buildTripForCard(card: AnchorCard) {
    const ctx = ctxByAnchor[card.id];
    const fallbackAnchor = anchorToRowEvent(card);
    const anchor = ctx?.anchor || fallbackAnchor;

    const allEvents = ensureAnchorIncluded(anchor, ctx?.events || []);
    const selectedMap = ctx?.selected || {};

    const selectedEvents = allEvents.filter((e) => selectedMap[eventKey(e)]);

    // Always include the anchor even if user selected nothing.
    const finalEvents = ensureAnchorIncluded(anchor, selectedEvents);

    const payload: BuildTripPayload = {
      tripStyle: "B",
      countryCode,
      airport: normalizeIata(airportIata) || undefined,
      anchor,
      events: finalEvents,
      // start/end are optional for the hub page; it derives dates from events anyway.
      startYMD: anchor?.date || null,
      endYMD: anchor?.date || null,
    };

    const data = encodeBuildTripDataParam(payload);
    router.push(`${BUILD_TRIP_ROUTE}?data=${data}`);
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-4 lg:max-w-4xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BrandLogo />
              <div className="min-w-0">
                <div className="text-base font-black tracking-tight text-slate-900 truncate">Favorites Results</div>
                <div className="text-xs text-slate-600 truncate">{header}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => router.push("/")}
                className="rounded-2xl bg-slate-900 px-3.5 py-2 text-[11px] font-extrabold text-white hover:bg-slate-800"
                title="Search again"
              >
                Search
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-700">Departure airport (optional)</div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <input
                value={airportIata}
                onChange={(e) => setAirportIata(normalizeIata(e.target.value))}
                placeholder="IATA (e.g., YLW)"
                className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400 sm:max-w-xs"
              />
              <div className="text-xs text-slate-500">
                Included in the build-trip payload (and in shared links).
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 py-6 lg:max-w-4xl lg:py-10">
        {loading && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              <div className="text-sm font-semibold text-slate-700">Loading favorites…</div>
            </div>
          </section>
        )}

        {err && (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
            <div className="text-sm font-black">Error</div>
            <div className="mt-2 text-sm font-semibold text-rose-700">{err}</div>
          </section>
        )}

        {!loading && !err && (
          <>
            <div className="mb-3 text-xs text-slate-600">
              Anchor cards: <span className="font-extrabold text-slate-900">{cards.length}</span>
              <span className="mx-2 text-slate-300">•</span>
              Each “Show nearby events” loads a fixed <span className="font-extrabold">±3 day</span> context window inline.
            </div>

            <div className="space-y-3">
              {cards.map((c) => {
                const isOpen = openId === c.id;
                const highlight = c.isCrossover;

                const ctx = ctxByAnchor[c.id];
                const nearbyEvents = ctx?.events || [];
                const grouped = groupByDate(nearbyEvents);
                const selectedCount = Object.values(ctx?.selected || {}).filter(Boolean).length;

                return (
                  <section
                    key={c.id}
                    className={cx(
                      "rounded-3xl border shadow-sm overflow-hidden",
                      highlight ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"
                    )}
                  >
                    <div className="p-5 sm:p-6">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-base font-black text-slate-900">{c.name}</div>
                            {highlight && (
                              <span className="rounded-full bg-amber-200/60 px-2.5 py-1 text-[11px] font-extrabold text-amber-900">
                                CROSSOVER
                              </span>
                            )}
                          </div>

                          <div className="mt-1 text-xs font-semibold text-slate-700">
                            {fmtYMDPretty(c.localDate)}
                            {c.localTime ? ` • ${c.localTime}` : ""}
                            <span className="mx-2 text-slate-300">•</span>
                            {c.city}
                            {c.region ? `, ${c.region}` : ""}
                            <span className="mx-2 text-slate-300">•</span>
                            {c.venueName || "Venue"}
                          </div>

                          <div className="mt-2 text-xs text-slate-500">
                            Default genres: {(c.matched?.defaultGenres || []).join(", ") || "—"}
                          </div>

                          {c.url && (
                            <div className="mt-2">
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-extrabold text-slate-900 underline decoration-slate-300 hover:decoration-slate-800"
                              >
                                Tickets
                              </a>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-2 sm:items-end">
                          <button
                            type="button"
                            onClick={() => {
                              // accordion: open/close inline
                              toggleOpen(c);
                            }}
                            className={cx(
                              "h-11 rounded-2xl px-4 text-sm font-extrabold transition border",
                              isOpen
                                ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800"
                                : "bg-white text-slate-900 border-slate-200 hover:bg-slate-50"
                            )}
                          >
                            {isOpen ? "Hide nearby events" : "Show nearby events"}
                          </button>

                          <button
                            type="button"
                            onClick={() => buildTripForCard(c)}
                            className="h-11 rounded-2xl bg-slate-900 px-4 text-sm font-extrabold text-white hover:bg-slate-800"
                            title="Open Trip Hub with your selected events"
                          >
                            Build trip{selectedCount ? ` (${selectedCount})` : ""}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Inline expanded content */}
                    {isOpen && (
                      <div className="border-t border-slate-200 bg-white">
                        <div className="p-5 sm:p-6">
                          {ctx?.loading ? (
                            <div className="flex items-center gap-3">
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                              <div className="text-sm font-semibold text-slate-700">Loading nearby events…</div>
                            </div>
                          ) : ctx?.error ? (
                            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                              <div className="font-black">Couldn’t load nearby events.</div>
                              <div className="mt-1 font-semibold">{ctx.error}</div>
                            </div>
                          ) : nearbyEvents.length === 0 ? (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                              No nearby events returned for this anchor window.
                            </div>
                          ) : (
                            <div className="space-y-5">
                              <div className="text-xs text-slate-600">
                                Tip: check the events you want included in the Trip Hub, then click <span className="font-extrabold">Build trip</span>.
                              </div>

{grouped
  .map((g) => ({ ...g, events: g.events.filter(isRenderableRowEvent) }))
  .filter((g) => g.events.length > 0)
  .map((g) => (
                                <div key={g.date} className="space-y-2">
                                  <div className="text-sm font-black text-slate-900">
                                    {g.date === "TBD" ? "Date TBD" : fmtYMDPretty(g.date)}
                                  </div>

                                  <div className="space-y-2">
                                    
                                    {g.events.filter(isRenderableRowEvent).map((e) => {
  const k = eventKey(e);
  const checked = Boolean(ctx?.selected?.[k]);
  const where = String(e.location || "").trim();
  return (
    <label
      key={k}
      className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 cursor-pointer"
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={checked}
        onChange={(ev) => setChecked(c.id, e, ev.target.checked)}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-slate-700">
          {where}
          {e.genre ? <span className="mx-2 text-slate-300">•</span> : null}
          {e.genre ? <span className="text-slate-600">{e.genre}</span> : null}
        </div>
        <div className="mt-1 text-sm font-black text-slate-900 truncate">
          {e.name}
        </div>

        {e.url ? (
          <div className="mt-2">
            <a
              href={e.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-extrabold text-slate-900 underline decoration-slate-300 hover:decoration-slate-800"
              onClick={(ev) => ev.stopPropagation()}
            >
              Tickets
            </a>
          </div>
        ) : null}
      </div>
    </label>
  );
})}

                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>

            {cards.length === 0 && (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
                No anchor events found.
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}