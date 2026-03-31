"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DayPicker, type Matcher } from "react-day-picker";
import "react-day-picker/style.css";
import {
  fmtDateChip,
  isYMD,
  localDateFromYMD,
  ymdFromLocalDate,
} from "@/lib/date/ymd";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Props = {
  value: string;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
  initialMonth?: string;
  placeholder: string;
  buttonClassName?: string;
  panelClassName?: string;
};

export default function DateField({
  value,
  onChange,
  min,
  max,
  initialMonth,
  placeholder,
  buttonClassName,
  panelClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const selected = isYMD(value) ? localDateFromYMD(value) : undefined;
  const minDate = isYMD(min) ? localDateFromYMD(min) : undefined;
  const maxDate = isYMD(max) ? localDateFromYMD(max) : undefined;

  const openingMonth = useMemo(() => {
    if (isYMD(value)) return localDateFromYMD(value);
    if (isYMD(initialMonth)) return localDateFromYMD(initialMonth);
    if (isYMD(min)) return localDateFromYMD(min);
    return undefined;
  }, [value, initialMonth, min]);

  const disabledDays: Matcher[] = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={cx(
          "inline-flex h-10 w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-900 outline-none hover:border-slate-300 sm:h-11 sm:gap-3 sm:px-4 sm:text-sm",
          buttonClassName
        )}
      >
        <span className="min-w-0 truncate">
          {value ? fmtDateChip(value) : placeholder}
        </span>

        <span
          aria-hidden="true"
          className="hidden text-base leading-none sm:inline-block"
        >
          📅
        </span>
      </button>

      {open ? (
        <div
          className={cx(
            "absolute left-0 top-full z-[80] mt-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg",
            panelClassName
          )}
        >
          <DayPicker
            mode="single"
            defaultMonth={openingMonth}
            selected={selected}
            onSelect={(day) => {
              if (!day) return;
              onChange(ymdFromLocalDate(day));
              setOpen(false);
            }}
            onDayClick={(day, modifiers) => {
              if (!modifiers.selected) return;
              setOpen(false);
            }}
            disabled={disabledDays}
            className="text-slate-900"
            classNames={{
              months: "text-slate-900",
              month: "text-slate-900",
              caption: "flex items-center justify-center pt-1 pb-3",
              caption_label: "text-sm font-bold text-slate-900",

              nav: "flex items-center gap-1",
              button_previous:
                "inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-900 hover:bg-slate-100",
              button_next:
                "inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-900 hover:bg-slate-100",

              weekdays: "text-slate-500",
              weekday: "text-xs font-semibold text-slate-500",

              week: "mt-1",
              day: "h-9 w-9",

              day_button:
                "h-9 w-9 rounded-full text-slate-900 hover:bg-slate-100 aria-selected:bg-slate-900 aria-selected:text-white disabled:text-slate-300",

              today: "text-slate-900",

              disabled: "text-slate-300 opacity-50",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}