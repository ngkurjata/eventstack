"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ComboRow } from "@/lib/filters/groupedCombobox";
import { filterComboRows } from "@/lib/filters/groupedCombobox";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Props = {
  label?: string;
  value: string;
  placeholder?: string;
  rows: ComboRow[];
  onChange: (next: string) => void;
  onPick: (row: Extract<ComboRow, { type: "option" }>) => void;
  onClear?: () => void;
  onBlurCommit?: () => void;
  disabled?: boolean;
  maxHeightClassName?: string;
};

function splitDisplayLabel(label: string) {
  const idx = label.indexOf(" - ");
  if (idx === -1) {
    return { main: label, suffix: "" };
  }

  return {
    main: label.slice(0, idx),
    suffix: label.slice(idx),
  };
}

export default function GroupedComboBox({
  label,
  value,
  placeholder,
  rows,
  onChange,
  onPick,
  onClear,
  onBlurCommit,
  disabled,
  maxHeightClassName = "max-h-96",
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const visibleRows = useMemo(
    () => filterComboRows(rows, value, 3000),
    [rows, value]
  );

  const optionRows = useMemo(
    () =>
      visibleRows.filter(
        (r): r is Extract<ComboRow, { type: "option" }> => r.type === "option"
      ),
    [visibleRows]
  );

  useEffect(() => {
    setActive(0);
  }, [value, rows]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function move(delta: number) {
    if (!optionRows.length) return;

    setActive((prev) => {
      const next = prev + delta;
      if (next < 0) return optionRows.length - 1;
      if (next >= optionRows.length) return 0;
      return next;
    });
  }

  function pickActive() {
    const row = optionRows[active];
    if (!row) return;
    onPick(row);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative w-full overflow-visible text-left">
      {label ? (
        <label className="mb-2 block text-sm font-semibold text-slate-700">
          {label}
        </label>
      ) : null}

      <div className="relative">
        <input
          value={value}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => {
              onBlurCommit?.();
            }, 0);
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
              setOpen(true);
              return;
            }

            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pickActive();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className={cx(
            "h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 pr-12 text-left text-sm text-slate-900 outline-none",
            "focus:border-slate-400"
          )}
        />

        {onClear && value ? (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={onClear}
            className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-white text-sm text-slate-500 hover:bg-slate-50"
          >
            ×
          </button>
        ) : null}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className={cx("overflow-y-auto text-left", maxHeightClassName)}>
              {visibleRows.length ? (
                visibleRows.map((row) => {
                  if (row.type === "section") {
                    return (
                      <div
                        key={row.key}
                        className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50 px-4 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-500"
                      >
                        {row.label}
                      </div>
                    );
                  }

                  if (row.type === "group") {
                    return (
                      <div
                        key={row.key}
                        className="sticky top-[33px] z-20 border-b border-slate-200 bg-white px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"
                      >
                        {row.label}
                      </div>
                    );
                  }

                  const idx = optionRows.findIndex((x) => x.key === row.key);
                  const isActive = idx === active;
                  const { main, suffix } = splitDisplayLabel(row.displayLabel);

                  return (
                    <button
                      key={row.key}
                      type="button"
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        onPick(row);
                        setOpen(false);
                      }}
                      className={cx(
                        "block w-full border-b border-slate-100 px-4 py-3 text-left text-sm last:border-b-0",
                        isActive
                          ? "bg-slate-900 text-white"
                          : "bg-white text-slate-900 hover:bg-slate-50"
                      )}
                    >
                      <span>{main}</span>
                      {suffix ? (
                        <span
                          className={cx(
                            "ml-1",
                            isActive ? "text-slate-300" : "text-slate-400"
                          )}
                        >
                          {suffix}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-3 text-left text-sm text-slate-500">
                  No matches.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}