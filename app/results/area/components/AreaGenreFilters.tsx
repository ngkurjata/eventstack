"use client";

import React from "react";
import type { FilterFamily } from "../utils";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function FilterButton(props: {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const { active, disabled, onClick, children } = props;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "rounded-full border px-3 py-2 text-center text-[13px] font-extrabold transition sm:rounded-3xl sm:px-5 sm:py-4 sm:text-[18px]",
        active
          ? "border-[#1f3f78] bg-[#1f3f78] text-white"
          : "border-slate-200 bg-white text-[#1f3f78]",
        disabled && "cursor-not-allowed opacity-40"
      )}
    >
      {children}
    </button>
  );
}

function GenreButton(props: {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const { active, disabled, onClick, children } = props;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={cx(
        "min-h-[32px] rounded-[14px] border px-2 py-1 text-center text-[11px] font-bold leading-tight whitespace-normal break-words [overflow-wrap:anywhere] transition sm:min-h-[36px] sm:rounded-[16px] sm:px-3 sm:py-1.5 sm:text-[12px]",
        active
          ? "border-black bg-black text-white"
          : disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
          : "border-slate-200 bg-white text-[#1f3f78]"
      )}
    >
      <span className="block">{children}</span>
    </button>
  );
}

type Props = {
  show: boolean;
  activeFamily: FilterFamily;
  activeGenre: string | null;
  sportsGenres: string[];
  concertGenres: string[];
  availableSportsSet: Set<string>;
  availableConcertsSet: Set<string>;
  norm: (value: unknown) => string;
  onActivateFamily: (next: FilterFamily) => void;
  onSelectGenre: (genre: string) => void;
};

export default function AreaGenreFilters({
  show,
  activeFamily,
  activeGenre,
  sportsGenres,
  concertGenres,
  availableSportsSet,
  availableConcertsSet,
  norm,
  onActivateFamily,
  onSelectGenre,
}: Props) {
  if (!show) return null;

  return (
    <section className="mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:mt-5 sm:rounded-3xl sm:p-7">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <FilterButton
          active={activeFamily === "sports"}
          onClick={() => onActivateFamily("sports")}
        >
          Sports
        </FilterButton>

        <FilterButton
          active={activeFamily === "music"}
          onClick={() => onActivateFamily("music")}
        >
          Concerts
        </FilterButton>
      </div>

      {activeFamily === "sports" ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:mt-4 sm:grid-cols-2 sm:gap-2">
          {sportsGenres.map((label) => {
            const disabled = !availableSportsSet.has(norm(label));

            return (
              <GenreButton
                key={label}
                active={activeGenre === label}
                disabled={disabled}
                onClick={() => onSelectGenre(label)}
              >
                {label}
              </GenreButton>
            );
          })}
        </div>
      ) : null}

      {activeFamily === "music" ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:mt-4 sm:grid-cols-2 sm:gap-2">
          {concertGenres.map((label) => {
            const disabled = !availableConcertsSet.has(norm(label));

            return (
              <GenreButton
                key={label}
                active={activeGenre === label}
                disabled={disabled}
                onClick={() => onSelectGenre(label)}
              >
                {label}
              </GenreButton>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}