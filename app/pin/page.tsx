"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function PinPage() {
  const sp = useSearchParams();
  const nextUrl = useMemo(() => sp.get("next") || "/", [sp]);

  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const clean = pin.replace(/\D/g, "").slice(0, 4);
    if (clean.length !== 4) {
      setErr("Enter a 4-digit PIN.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: clean }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || "Wrong PIN.");
        return;
      }

      window.location.href = nextUrl;
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow p-6">
        <h1 className="text-xl font-semibold">EventStack</h1>
        <p className="text-sm text-slate-600 mt-1">Enter the 4-digit PIN to continue.</p>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg tracking-widest text-center"
            placeholder="••••"
          />

          {err && <div className="text-sm text-red-600">{err}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 text-white py-3 font-medium disabled:opacity-60"
          >
            {loading ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    </main>
  );
}
