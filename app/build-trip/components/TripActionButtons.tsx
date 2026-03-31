"use client";

type Props = {
  copied: boolean;
  shared: boolean;
  onCopy: () => void;
  onShare: () => void;
};

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.7l6.8-3.4" />
      <path d="M8.6 13.3l6.8 3.4" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v6h8V3" />
      <path d="M8 17h8" />
    </svg>
  );
}

export default function TripActionButtons({
  copied,
  shared,
  onCopy,
  onShare,
}: Props) {
  return (
    <div className="mb-4 flex justify-end gap-3">
      <button
        type="button"
        onClick={onCopy}
        title={copied ? "Saved" : "Save Trip Link"}
        aria-label={copied ? "Saved" : "Save Trip Link"}
        className={`flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm transition sm:h-12 sm:w-12 ${
          copied ? "bg-slate-700" : "bg-slate-900 hover:bg-slate-800"
        }`}
      >
        <SaveIcon />
      </button>

      <button
        type="button"
        onClick={onShare}
        title={shared ? "Shared" : "Share Trip"}
        aria-label={shared ? "Shared" : "Share Trip"}
        className={`flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm transition sm:h-12 sm:w-12 ${
          shared ? "bg-slate-700" : "bg-slate-900 hover:bg-slate-800"
        }`}
      >
        <ShareIcon />
      </button>
    </div>
  );
}