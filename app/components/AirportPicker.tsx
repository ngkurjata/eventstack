"use client";

import React, { useMemo, useRef, useState } from "react";

export type Airport = {
  iata: string;
  name: string;
  city: string;
  region: string;
  country: string;
  lat: number | null;
  lon: number | null;
};

function label(a: Airport) {
  const regionShort =
    a.region && a.region.includes("-") ? a.region.split("-")[1] : a.region;

  return [`${a.iata} — ${a.name}`, a.city || null, regionShort || null, a.country || null]
    .filter(Boolean)
    .join(" • ");
}

export function AirportPicker(props: {
  airports: Airport[];
  valueIata: string; // stored IATA
  onPick: (iata: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => {
    const v = (props.valueIata || "").trim().toUpperCase();
    return props.airports.find((a) => a.iata === v) || null;
  }, [props.valueIata, props.airports]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query || selected) return [];

    const matches = props.airports.filter((a) => {
      const iata = a.iata.toLowerCase();
      const name = (a.name || "").toLowerCase();
      const city = (a.city || "").toLowerCase();
      return iata.startsWith(query) || name.includes(query) || city.includes(query);
    });

    matches.sort((a, b) => {
      const qi = query;
      const aI = a.iata.toLowerCase();
      const bI = b.iata.toLowerCase();
      const aC = (a.city || "").toLowerCase();
      const bC = (b.city || "").toLowerCase();

      const score = (I: string, C: string) =>
        (I.startsWith(qi) ? 0 : 10) + (C.startsWith(qi) ? 0 : C.includes(qi) ? 3 : 10);

      return score(aI, aC) - score(bI, bC);
    });

    return matches.slice(0, 12);
  }, [q, props.airports, selected]);

  const isOpen = results.length > 0 && !selected;

  function commitAirport(a: Airport) {
    props.onPick(a.iata);
    setQ("");
    setActiveIdx(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) return;

    if (e.key === "Escape") {
      // close dropdown by clearing highlight (results will still show while typing;
      // but highlight is gone, consistent with your favorites behavior)
      setActiveIdx(-1);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((idx) => (idx < 0 ? 0 : Math.min(idx + 1, results.length - 1)));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((idx) => (idx <= 0 ? results.length - 1 : idx - 1));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[activeIdx];
      if (pick) commitAirport(pick);
      return;
    }

    // ✅ Tab commits highlighted item (if any) and lets focus move naturally
    if (e.key === "Tab") {
      const pick = results[activeIdx];
      if (pick) commitAirport(pick);
      // IMPORTANT: do not preventDefault(), so the browser tabs to the next input
      return;
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <div className="text-lg font-extrabold text-slate-900 mb-5">Nearest airport</div>

      <input
  ref={inputRef}
  value={selected ? label(selected) : q}
  onFocus={() => {
    if (selected) requestAnimationFrame(() => inputRef.current?.select());
  }}
  onChange={(e) => {
    props.onPick("");
    setQ(e.target.value);
    setActiveIdx(-1);
  }}
        onKeyDown={onKeyDown}
        placeholder={props.placeholder ?? "Type city or IATA (e.g., Kelowna or YLW)"}
  className="text-slate-900 placeholder:text-slate-400"
  style={{
    width: "100%",
    padding: 10,
    borderRadius: 12,
    border: "1px solid #d7d7d7",
    background: "#fff",
    outline: "none",
  }}
  autoComplete="off"
/>
      {/* Always show helper text */}
      <div className="mt-2 text-xs text-slate-600">
  Required (autofills Expedia)
</div>

      {isOpen ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: 320,
            overflow: "auto",
            border: "1px solid #e6e6e6",
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            padding: 4,
          }}
        >
          {results.map((a, idx) => {
            const isActive = idx === activeIdx;
            return (
              <button
                key={a.iata}
                type="button"
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(ev) => {
                  // onMouseDown prevents input blur before selection
                  ev.preventDefault();
                  commitAirport(a);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 10,
                  background: isActive ? "#0f172a" : "transparent", // slate-900
                  color: isActive ? "#fff" : "#0f172a",
                }}
              >
                <div style={{ fontWeight: 900 }}>{a.iata}</div>
                <div style={{ fontSize: 12, opacity: isActive ? 0.85 : 0.75 }}>
                  {label(a)}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
