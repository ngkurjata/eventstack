"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type BaseOption = {
  id: string;
  label: string;
};

type ComboBoxProps<T extends BaseOption> = {
  label?: string;
  placeholder?: string;
  options: T[];
  value: T | null;
  onChange: (next: T | null) => void;
  disabled?: boolean;
  loading?: boolean;
  // optional: custom filter
  filter?: (opt: T, query: string) => boolean;
};

export default function ComboBox<T extends BaseOption>({
  label,
  placeholder = "Type to search…",
  options,
  value,
  onChange,
  disabled = false,
  loading = false,
  filter,
}: ComboBoxProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Keep input text in sync with selection when closing/opening
  useEffect(() => {
    if (!open) {
      setQuery(value?.label ?? "");
      setActiveIndex(-1);
    }
  }, [open, value?.label]);

  // Close on outside click
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!normalizedQuery) return options;
    const fn =
      filter ??
      ((opt: T, q: string) => opt.label.toLowerCase().includes(q));
    return options.filter((o) => fn(o, normalizedQuery));
  }, [options, normalizedQuery, filter]);

  // Reset active index when list changes
  useEffect(() => {
    if (!open) return;
    setActiveIndex(filtered.length ? 0 : -1);
  }, [open, filtered.length]);

  function commit(opt: T | null) {
    onChange(opt);
    setOpen(false);
    // ensure input shows selection
    setQuery(opt?.label ?? "");
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }

    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => {
        const next = i + 1;
        return next >= filtered.length ? 0 : next;
      });
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => {
        const next = i - 1;
        return next < 0 ? Math.max(filtered.length - 1, 0) : next;
      });
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) commit(opt);
      return;
    }
  }

  return (
    <div ref={rootRef} className="w-full">
      {label ? (
        <div className="mb-1 text-sm font-semibold text-slate-900">
          {label}
        </div>
      ) : null}

      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          placeholder={loading ? "Loading…" : placeholder}
          disabled={disabled || loading}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 disabled:bg-slate-100"
          aria-autocomplete="list"
          aria-expanded={open}
        />

        {/* Clear button */}
        {value && !disabled && !loading ? (
          <button
            type="button"
            onClick={() => commit(null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            aria-label="Clear selection"
          >
            ✕
          </button>
        ) : null}

        {open ? (
          <div className="absolute z-50 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow">
            {loading ? (
              <div className="px-3 py-2 text-sm text-slate-600">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-600">
                No matches
              </div>
            ) : (
              filtered.map((opt, idx) => {
                const active = idx === activeIndex;
                const selected = value?.id === opt.id;

                return (
                  <button
                    key={opt.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => {
                      // prevent input blur before click registers
                      e.preventDefault();
                    }}
                    onClick={() => commit(opt)}
                    className={[
                      "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                      active ? "bg-slate-100" : "",
                    ].join(" ")}
                    role="option"
                    aria-selected={selected}
                  >
                    <span className="truncate">{opt.label}</span>
                    {selected ? (
                      <span className="ml-3 text-xs text-slate-600">Selected</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}