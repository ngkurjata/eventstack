"use client";

import React from "react";
import DateField from "@/app/components/date/DateField";
import { addDaysLocal, isYMD } from "@/lib/date/ymd";
import type { CityOpt, SearchState } from "../utils";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function norm(s: unknown) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function ComboBox<T extends { label: string }>(props: {
  label: string;
  value: string;
  placeholder?: string;
  options: T[];
  onChange: (next: string) => void;
  onPick: (opt: T) => void;
}) {
  const { label, value, placeholder, options, onChange, onPick } = props;

  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const filtered = React.useMemo(() => {
    const q = norm(value);
    const base = options || [];
    if (!q) return base.slice(0, 20);

    const starts = base.filter((o) => norm(o.label).startsWith(q));
    const contains = base.filter(
      (o) => !norm(o.label).startsWith(q) && norm(o.label).includes(q)
    );

    return [...starts, ...contains].slice(0, 20);
  }, [options, value]);

  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  React.useEffect(() => {
    setActive(0);
  }, [value]);

  return (
    <div ref={wrapRef} className="relative z-20 overflow-visible">
      <div className="mb-2 text-xs font-semibold text-slate-700">{label}</div>

      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
            setOpen(true);
            return;
          }

          if (!open) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((n) => Math.min(n + 1, Math.max(0, filtered.length - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((n) => Math.max(0, n - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const opt = filtered[active];
            if (opt) {
              onPick(opt);
              setOpen(false);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="mobile-input"
      />

      {open && value.trim().length > 0 && (
        <div className="absolute left-0 right-0 top-full z-[70] mt-2 rounded-2xl border border-slate-200 bg-white shadow-lg">
          {filtered.length > 0 ? (
            <div className="max-h-96 overflow-y-auto overscroll-contain py-1">
              {filtered.map((opt, idx) => {
                const isActive = idx === active;
                return (
                  <button
                    type="button"
                    key={(opt as { key?: string }).key || opt.label}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => {
                      onPick(opt);
                      setOpen(false);
                    }}
                    className={cx(
                      "w-full border-b border-slate-100 px-4 py-3 text-left text-sm last:border-b-0",
                      isActive
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-900 hover:bg-slate-50"
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-3 text-sm text-slate-500">No matches.</div>
          )}
        </div>
      )}
    </div>
  );
}

type Props = {
  cities: CityOpt[];
  search: SearchState;
  loading: boolean;
  err: string | null;
  onCityChange: (next: string) => void;
  onCityPick: (opt: CityOpt) => void;
  onStartDateChange: (next: string) => void;
  onEndDateChange: (next: string) => void;
  onSearch: () => void;
};

export default function AreaSearchPanel({
  cities,
  search,
  loading,
  err,
  onCityChange,
  onCityPick,
  onStartDateChange,
  onEndDateChange,
  onSearch,
}: Props) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-7">
      <h1 className="text-2xl font-black text-slate-900">Add Events by City</h1>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="relative z-40 sm:col-span-3">
          <ComboBox<CityOpt>
            label="City"
            value={search.cityLabel}
            placeholder="Type a city…"
            options={cities}
            onChange={onCityChange}
            onPick={onCityPick}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:col-span-3 sm:grid-cols-2">
          <div className="relative z-20">
            <div className="mb-2 text-xs font-semibold text-slate-700">Start</div>
            <DateField
              value={search.startDate}
              onChange={onStartDateChange}
              placeholder="Start date"
            />
          </div>

          <div className="relative z-10">
            <div className="mb-2 text-xs font-semibold text-slate-700">End</div>
            <DateField
              value={search.endDate}
              onChange={onEndDateChange}
              min={search.startDate || undefined}
              max={
                isYMD(search.startDate)
                  ? addDaysLocal(search.startDate, 13)
                  : undefined
              }
              placeholder="End date"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={onSearch}
          disabled={loading}
          className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-extrabold text-white disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {err ? <div className="mt-4 text-sm font-semibold text-red-600">{err}</div> : null}
    </section>
  );
}