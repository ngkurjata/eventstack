"use client";

import React, { useMemo, useRef, useState } from "react";

export type City = {
  id: string; // stable key: "US|CA|Anaheim"
  name: string;
  region: string; // "CA" or "BC"
  country: string; // "US" | "CA"
  lat: number;
  lon: number;
  population?: number | null;
  airportIata?: string | null; // computed nearest airport (optional)
};

function label(c: City) {
  const bits = [
    `${c.name}${c.region ? `, ${c.region}` : ""}`,
    c.country || null,
    c.airportIata ? `airport ${c.airportIata}` : null,
  ].filter(Boolean);

  return bits.join(" • ");
}

export function CityPicker(props: {
  cities: City[];
  valueCityId: string;
  onPick: (city: City | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => {
    const v = (props.valueCityId || "").trim();
    return props.cities.find((c) => c.id === v) || null;
  }, [props.valueCityId, props.cities]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query || selected) return [];

    const matches = props.cities.filter((c) => {
      const n = (c.name || "").toLowerCase();
      const r = (c.region || "").toLowerCase();
      const cc = (c.country || "").toLowerCase();
      const iata = (c.airportIata || "").toLowerCase();
      return (
        n.startsWith(query) ||
        n.includes(query) ||
        r.startsWith(query) ||
        r.includes(query) ||
        cc === query ||
        iata.startsWith(query)
      );
    });

    // prefix matches first, then alphabetical
    matches.sort((a, b) => {
      const qi = query;
      const aN = (a.name || "").toLowerCase();
      const bN = (b.name || "").toLowerCase();
      const aR = (a.region || "").toLowerCase();
      const bR = (b.region || "").toLowerCase();

      const pref = (s: string) => (s.startsWith(qi) ? 0 : s.includes(qi) ? 3 : 10);
      const sa = pref(aN) + pref(aR);
      const sb = pref(bN) + pref(bR);
      if (sa !== sb) return sa - sb;

      return (a.name + a.region + a.country).localeCompare(b.name + b.region + b.country);
    });

    return matches.slice(0, 12);
  }, [q, props.cities, selected]);

  const isOpen = results.length > 0 && !selected;

  function commitCity(c: City) {
    props.onPick(c);
    setQ("");
    setActiveIdx(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) return;

    if (e.key === "Escape") {
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
      if (pick) commitCity(pick);
      return;
    }
    if (e.key === "Tab") {
      const pick = results[activeIdx];
      if (pick) commitCity(pick);
      return; // do not preventDefault
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={selected ? label(selected) : q}
        onFocus={() => {
          if (selected) requestAnimationFrame(() => inputRef.current?.select());
        }}
        onChange={(e) => {
          props.onPick(null);
          setQ(e.target.value);
          setActiveIdx(-1);
        }}
        onKeyDown={onKeyDown}
        placeholder={props.placeholder ?? "Type a city (e.g., Anaheim, Kelowna)"}
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

      <div className="mt-2 text-xs text-center text-slate-600">
        City sets the event radius. Nearest airport is auto-selected for one-click Expedia.
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
          {results.map((c, idx) => {
            const isActive = idx === activeIdx;
            return (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  commitCity(c);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 10,
                  background: isActive ? "#0f172a" : "transparent",
                  color: isActive ? "#fff" : "#0f172a",
                }}
              >
                <div style={{ fontWeight: 900 }}>
                  {c.name}{c.region ? `, ${c.region}` : ""} {c.country ? `(${c.country})` : ""}
                </div>
                <div style={{ fontSize: 12, opacity: isActive ? 0.85 : 0.75 }}>
                  {label(c)}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}