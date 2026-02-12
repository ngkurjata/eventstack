import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { pin } = await req.json().catch(() => ({} as any));
  const expected = process.env.SITE_PIN;

  if (!expected) {
    return NextResponse.json({ error: "Server is missing SITE_PIN" }, { status: 500 });
  }

  const clean = String(pin || "").replace(/\D/g, "").slice(0, 4);
  if (clean.length !== 4) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 400 });
  }

  if (clean !== expected) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: "eventstack_pin_ok",
    value: "1",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14, // 14 days
  });
  return res;
}
