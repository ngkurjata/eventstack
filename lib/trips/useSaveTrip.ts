// FILE: lib/trips/useSaveTrip.ts
"use client";

import { useCallback, useState } from "react";
import type { SaveTripResponse, TripDraft } from "./saveTrip";

function isYMD(s: any): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

export function useSaveTrip() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  const run = useCallback(async (draft: TripDraft): Promise<SaveTripResponse> => {
    setError("");

    // Basic client-side guardrails (server is authoritative)
    const home = String(draft?.homeBase || "").trim().toUpperCase();
    if (home.length !== 3) {
      const msg = "homeBase must be a 3-letter IATA code.";
      setError(msg);
      return { ok: false, error: msg };
    }
    if (!isYMD(draft?.startDate) || !isYMD(draft?.endDate)) {
      const msg = "startDate/endDate must be YYYY-MM-DD.";
      setError(msg);
      return { ok: false, error: msg };
    }
    if (!Array.isArray(draft?.events) || draft.events.length === 0) {
      const msg = "Select at least one event before saving.";
      setError(msg);
      return { ok: false, error: msg };
    }

    setSaving(true);
    try {
      const res = await fetch("/api/trips/save", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });

      const j = (await res.json().catch(() => ({}))) as any;

      if (!res.ok || !j?.ok) {
        const msg = String(j?.error || `Save failed (${res.status})`);
        const detail = j?.detail ? String(j.detail) : undefined;
        setError(detail ? `${msg} — ${detail}` : msg);
        return { ok: false, error: msg, detail };
      }

      return { ok: true, tripId: String(j.tripId) };
    } catch (e: any) {
      const msg = String(e?.message || e || "Save failed");
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }, []);

  return { saving, error, run };
}