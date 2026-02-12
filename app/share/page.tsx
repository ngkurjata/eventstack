"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function b64urlDecode(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export default function SharePage() {
  const sp = useSearchParams();
  const encoded = sp.get("o") || "";

  const occurrence = useMemo(() => {
    if (!encoded) return null;
    try {
      const decodedParam = decodeURIComponent(encoded);
      const json = b64urlDecode(decodedParam);
      return JSON.parse(json);
    } catch {
      return null;
    }
  }, [encoded]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-6">
      <div className="max-w-3xl mx-auto">
        {/* CTA header */}
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-5">
          <h1 className="text-2xl font-semibold">
            Someone shared an EventStack trip idea with you
          </h1>
          <p className="mt-2 text-slate-600">
            EventStack helps you plan trips around live events and quickly jump to flights and hotels.
          </p>

          <div className="mt-4 flex gap-3 flex-wrap">
            <Link
              href="/"
              className="inline-flex items-center rounded-xl px-4 py-2 bg-slate-900 text-white"
            >
              Try it yourself
            </Link>
            <Link
              href="/"
              className="inline-flex items-center rounded-xl px-4 py-2 border border-slate-300"
            >
              Search your own events
            </Link>
          </div>
        </div>

        {/* Shared content */}
        <div className="mt-6">
          {!occurrence ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-5">
              <h2 className="text-lg font-semibold">This shared link isn’t valid</h2>
              <p className="mt-2 text-slate-600">
                The link may be incomplete or too long for the app that sent it.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-slate-200 p-4 overflow-auto">
              <pre className="text-sm whitespace-pre-wrap">
                {JSON.stringify(occurrence, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
