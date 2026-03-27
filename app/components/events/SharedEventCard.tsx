// FILE: app/components/events/SharedEventCard.tsx
"use client";

import React from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Props = {
  title: string;
  subtitle: string;
  primaryPill?: string | null;
  secondaryPill?: string | null;
  ticketHref?: string | null;
  showTickets?: boolean;
  selected?: boolean;
  onCardClick?: () => void;
  onRemove?: () => void;
  removeAriaLabel?: string;
  endAdornment?: React.ReactNode;
  className?: string;
};

export default function SharedEventCard({
  title,
  subtitle,
  primaryPill,
  secondaryPill,
  ticketHref,
  showTickets = false,
  selected = false,
  onCardClick,
  onRemove,
  removeAriaLabel = "Remove",
  endAdornment,
  className,
}: Props) {
  const interactive = typeof onCardClick === "function";
  const showAddButton = !selected && interactive && !onRemove;
  const showRemoveButton = selected && typeof onRemove === "function";

  function handleKeyDown(evt: React.KeyboardEvent<HTMLDivElement>) {
    if (!interactive) return;
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      onCardClick?.();
    }
  }

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onCardClick : undefined}
      onKeyDown={handleKeyDown}
      className={cx(
        "block rounded-[18px] border px-3 py-3 transition",
        selected
          ? "border-2 border-[#17315f] bg-[#f8fbff] shadow-[0_6px_18px_rgba(23,49,95,0.10)]"
          : "border border-[#d9e0ea] bg-transparent",
        interactive && !selected && "cursor-pointer hover:border-slate-300",
        interactive && selected && "cursor-default",
        className
      )}
    >
      <div className="flex items-start gap-[10px]">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 break-words pr-1 text-[16px] font-extrabold leading-[1.2] text-[#071b3b] sm:text-[18px]">
              {title}
            </div>

            {showRemoveButton ? (
              <button
                type="button"
                aria-label={removeAriaLabel}
                onClick={(evt) => {
                  evt.preventDefault();
                  evt.stopPropagation();
                  onRemove?.();
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-red-600 bg-red-50 text-[16px] font-extrabold leading-none text-red-600"
              >
                ×
              </button>
            ) : showAddButton ? (
              <button
                type="button"
                aria-label="Add to selected events"
                onClick={(evt) => {
                  evt.preventDefault();
                  evt.stopPropagation();
                  onCardClick?.();
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-green-600 bg-green-50 text-[16px] font-extrabold leading-none text-green-600"
              >
                +
              </button>
            ) : endAdornment ? (
              <div
                className="shrink-0"
                onClick={(evt) => {
                  evt.preventDefault();
                  evt.stopPropagation();
                }}
              >
                {endAdornment}
              </div>
            ) : null}
          </div>

          <div className="mt-1 break-words text-[14px] leading-[1.3] text-[#5e7597]">
            {subtitle}
          </div>

          <div className="mt-[10px] flex flex-wrap items-center justify-between gap-[10px]">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {primaryPill ? (
                <div className="inline-flex min-h-6 items-center justify-center whitespace-nowrap rounded-full bg-[#111] px-2 py-[2px] text-[11px] font-bold text-white">
                  {primaryPill}
                </div>
              ) : null}

              {secondaryPill ? (
                <div className="inline-flex min-h-6 items-center justify-center whitespace-nowrap rounded-full bg-[#17315f] px-2 py-[2px] text-[11px] font-bold text-white">
                  {secondaryPill}
                </div>
              ) : null}
            </div>

            <div className="ml-auto flex-[0_0_auto]">
              {showTickets ? (
                ticketHref ? (
                  <a
                    href={ticketHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(evt) => evt.stopPropagation()}
                    className="inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-full border border-[#17315f] bg-[#17315f] px-3 text-[13px] font-extrabold text-white"
                  >
                    Tickets
                  </a>
                ) : (
                  <div className="inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-full bg-slate-200 px-3 text-[13px] font-extrabold text-slate-500">
                    No link
                  </div>
                )
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}