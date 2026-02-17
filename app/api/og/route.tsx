import { ImageResponse } from "next/og";

export const runtime = "edge";

function b64urlDecodeToUtf8(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function safeParsePayload(o: string) {
  try {
    const decodedParam = decodeURIComponent(o);
    const json = b64urlDecodeToUtf8(decodedParam);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function fmtPretty(ymd?: string | null) {
  if (!ymd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd));
  if (!m) return String(ymd);
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(dt);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const o = searchParams.get("o") || "";
  const payload = o ? safeParsePayload(o) : null;

  const city = String(payload?.cityState || "Trip location");
  const start = payload?.startYMD || null;
  const end = payload?.endYMD || null;

  const startText = fmtPretty(start);
  const endText = fmtPretty(end);

  const dateLine =
    start && end ? (start === end ? startText : `${startText} - ${endText}`) : startText || endText || "";

  const titles = Array.isArray(payload?.fallbackTitles)
    ? payload.fallbackTitles.filter(Boolean).slice(0, 4)
    : [];

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          background: "#f8fafc",
          padding: "60px",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
        }}
      >
        <div
          style={{
            width: "100%",
            borderRadius: "36px",
            background: "white",
            border: "1px solid #e2e8f0",
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
            padding: "54px",
            display: "flex",
            flexDirection: "column",
            gap: "22px",
          }}
        >
          <div style={{ fontSize: 44, fontWeight: 800, color: "#0f172a" }}>Hear me out…</div>

          <div style={{ fontSize: 34, fontWeight: 800, color: "#0f172a" }}>{city}</div>

          {dateLine ? (
            <div style={{ fontSize: 28, fontWeight: 700, color: "#334155" }}>{dateLine}</div>
          ) : null}

          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 14 }}>
            {titles.map((t: string, idx: number) => (
              <div key={idx} style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: "#16a34a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontWeight: 900,
                    fontSize: 20,
                  }}
                >
                  ✓
                </div>
                <div style={{ fontSize: 28, fontWeight: 750, color: "#0f172a" }}>{String(t)}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "auto", fontSize: 30, fontWeight: 900, color: "#0f172a" }}>
            We should do this… right!?
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
