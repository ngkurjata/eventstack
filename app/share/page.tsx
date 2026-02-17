import Link from "next/link";
import ShareRedirectClient from "./ShareRedirectClient";

function b64urlDecodeToString(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = Buffer.from(b64 + pad, "base64");
  return bin.toString("utf8");
}

function safeParsePayload(o: string) {
  try {
    const decodedParam = decodeURIComponent(o);
    const json = b64urlDecodeToString(decodedParam);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function generateMetadata({ searchParams }: { searchParams: any }) {
  const o = String(searchParams?.o || "");
  const payload = o ? safeParsePayload(o) : null;

  const title = payload?.cityState ? `EventStack trip: ${payload.cityState}` : "EventStack trip idea";
  const description = "Open this EventStack trip idea.";

  const ogImage = o ? `/api/og?o=${encodeURIComponent(o)}` : "/api/og";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default function SharePage({ searchParams }: { searchParams: any }) {
  const o = String(searchParams?.o || "");
  const payload = o ? safeParsePayload(o) : null;

  const buildTripUrl = payload
    ? `/build-trip?data=${encodeURIComponent(JSON.stringify(payload))}`
    : "/";

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-6">
      {/* Client redirect for humans */}
      {payload ? <ShareRedirectClient to={buildTripUrl} /> : null}

      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-5">
          <h1 className="text-2xl font-semibold">Someone shared an EventStack trip idea with you</h1>
          <p className="mt-2 text-slate-600">
            EventStack helps you plan trips around live events and quickly jump to flights and hotels.
          </p>

          <div className="mt-4 flex gap-3 flex-wrap">
            <Link
              href={payload ? buildTripUrl : "/"}
              className="inline-flex items-center rounded-xl px-4 py-2 bg-slate-900 text-white"
            >
              {payload ? "Open Trip Hub" : "Try it yourself"}
            </Link>
            <Link
              href="/"
              className="inline-flex items-center rounded-xl px-4 py-2 border border-slate-300"
            >
              Search your own events
            </Link>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white border border-slate-200 p-5">
          {!payload ? (
            <>
              <h2 className="text-lg font-semibold">This shared link isn’t valid</h2>
              <p className="mt-2 text-slate-600">
                The link may be incomplete or too long for the app that sent it.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Opening the trip…</h2>
              <p className="mt-2 text-slate-600">If nothing happens, tap the button above.</p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
