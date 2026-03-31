"use client";

import React from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type FlashKind = "added" | "removed" | null;

type Props = {
  title: string;
  subtitle: string;
  primaryPill?: string | null;
  secondaryPill?: string | null;
  ticketHref?: string | null;
  showTickets?: boolean;
  selected?: boolean;
  onCardClick?: () => void;
  endAdornment?: React.ReactNode;
  className?: string;
  disableFlash?: boolean;
  orderLabel?: string;
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
  endAdornment,
  className,
  disableFlash = false,
  orderLabel,
}: Props) {
  const interactive = typeof onCardClick === "function";

  const [flash, setFlash] = React.useState<FlashKind>(null);
  const flashTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  function showFlash(kind: Exclude<FlashKind, null>) {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }

    setFlash(kind);

    flashTimerRef.current = setTimeout(() => {
      setFlash(null);
    }, 2000);
  }

  function handleToggle() {
    if (!interactive) return;

    onCardClick?.();

    if (!disableFlash) {
      showFlash(selected ? "removed" : "added");
    }
  }

  function handleKeyDown(evt: React.KeyboardEvent<HTMLDivElement>) {
    if (!interactive) return;
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      handleToggle();
    }
  }

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? handleToggle : undefined}
      onKeyDown={handleKeyDown}
      className={cx(
        "relative block overflow-hidden rounded-[20px] border px-3 py-3 transition-all duration-200 sm:px-5 sm:py-4",
        selected
          ? "border-2 border-slate-900 bg-white ring-2 ring-slate-900/10 shadow-sm"
          : "border border-[#d9e0ea] bg-white",
        interactive && "cursor-pointer",
        interactive && !selected && "hover:border-slate-300 hover:bg-slate-50/40",
        className
      )}
    >
      {!disableFlash && flash ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-center pb-4">
          <div
            className={cx(
              "animate-[fadeFlash_2s_ease-in-out_forwards] text-center text-[13px] font-extrabold uppercase tracking-wide sm:text-[16px]",
              flash === "added" ? "text-green-600" : "text-red-600"
            )}
          >
            {flash === "added" ? "ADDED TO TRIP" : "REMOVED FROM TRIP"}
          </div>
        </div>
      ) : null}

      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 pr-12 sm:pr-14">
            {orderLabel ? (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-black leading-none text-white sm:h-7 sm:w-7 sm:text-[12px]">
                {orderLabel}
              </div>
            ) : null}

            <div
              className={cx(
                "min-w-0 break-words pr-1 text-[14px] leading-[1.15] text-[#071b3b] sm:text-[18px]",
                selected ? "font-black" : "font-extrabold"
              )}
            >
              {title}
            </div>
          </div>

          {endAdornment ? (
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

        <div className="mt-2 break-words text-[12px] leading-[1.45] text-[#5e7597] sm:text-[14px]">
          {subtitle}
        </div>

        {(primaryPill || secondaryPill || showTickets) && (
          <div className="mt-3 flex w-full items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {primaryPill ? (
                <div className="inline-flex min-h-7 items-center justify-center whitespace-nowrap rounded-full bg-[#111] px-3 py-1 text-[10px] font-bold text-white sm:min-h-8 sm:text-[12px]">
                  {primaryPill}
                </div>
              ) : null}

              {secondaryPill ? (
                <div className="inline-flex min-h-7 items-center justify-center whitespace-nowrap rounded-full bg-[#17315f] px-3 py-1 text-[10px] font-bold text-white sm:min-h-8 sm:text-[12px]">
                  {secondaryPill}
                </div>
              ) : null}
            </div>

            {showTickets ? (
              ticketHref ? (
                <a
                  href={ticketHref}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(evt) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    window.open(ticketHref, "_blank", "noopener,noreferrer");
                  }}
                  className="ml-auto inline-flex min-h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-[#17315f] bg-[#17315f] px-3 py-1 text-[10px] font-extrabold text-white sm:min-h-8 sm:px-4 sm:text-[12px]"
                >
                  Tickets
                </a>
              ) : (
                <div className="ml-auto inline-flex min-h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-slate-200 px-3 py-1 text-[10px] font-extrabold text-slate-500 sm:min-h-8 sm:px-4 sm:text-[12px]">
                  No link
                </div>
              )
            ) : null}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes fadeFlash {
          0% {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          15% {
            opacity: 1;
            transform: translateY(0px) scale(1);
          }
          75% {
            opacity: 1;
            transform: translateY(0px) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-6px) scale(1.02);
          }
        }
      `}</style>
    </div>
  );
}