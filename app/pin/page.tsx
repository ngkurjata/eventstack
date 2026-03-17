"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function PinPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pin }),
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        setError(data?.error || "Incorrect PIN");
        return;
      }

      const next = searchParams.get("next") || "/";
      router.replace(next);
      router.refresh();
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-2">Enter PIN</h1>
        <p className="text-sm text-neutral-600 mb-5">
          This site is protected. Enter the access PIN to continue.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            className="w-full rounded-xl border border-neutral-300 px-4 py-3 outline-none focus:border-neutral-500"
            autoFocus
          />

          {error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : null}

          <button
            type="submit"
            disabled={busy || !pin.trim()}
            className="w-full rounded-xl bg-black text-white py-3 font-medium disabled:opacity-50"
          >
            {busy ? "Checking..." : "Continue"}
          </button>
        </form>
      </div>
    </main>
  );
}