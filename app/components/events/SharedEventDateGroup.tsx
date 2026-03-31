"use client";

import React from "react";

type Props = {
  title: string;
  children: React.ReactNode;
  className?: string;
};

export default function SharedEventDateGroup({
  title,
  children,
  className,
}: Props) {
  return (
    <section className={className}>
      <div className="sticky top-0 z-10 mb-2 sm:mb-3">
        <div className="border-b border-slate-200 bg-slate-50/95 pb-2 pt-2 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80">
          <div className="text-[13px] font-black uppercase tracking-[0.06em] text-slate-900 sm:text-[15px]">
            {title}
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:gap-3">{children}</div>
    </section>
  );
}