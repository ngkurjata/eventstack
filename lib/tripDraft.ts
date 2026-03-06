// FILE: lib/tripDraft.ts

export type DraftEvent = {
  id: string;
  name: string;
  localDate: string;
  localTime: string | null;
  city: string;
  region: string | null;
  venueName: string | null;
  url: string | null;
};

const LS_KEY = "eventstack_trip_draft_v1";

export function loadDraft(): DraftEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveDraft(events: DraftEvent[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(events || []));
}

export function clearDraft() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LS_KEY);
}

export function toggleDraftEvent(e: DraftEvent) {
  const cur = loadDraft();
  const exists = cur.some((x) => x.id === e.id);
  const next = exists ? cur.filter((x) => x.id !== e.id) : [...cur, e];
  saveDraft(next);
  return next;
}

export function isInDraft(id: string) {
  const cur = loadDraft();
  return cur.some((x) => x.id === id);
}