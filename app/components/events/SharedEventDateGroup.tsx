// FILE: app/components/events/SharedEventDateGroup.tsx
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
    <div className={className}>
      <div className="mb-[10px] text-[13px] font-extrabold uppercase tracking-wide text-[#536b8f]">
        {title}
      </div>

      <div className="grid gap-[10px]">{children}</div>
    </div>
  );
}