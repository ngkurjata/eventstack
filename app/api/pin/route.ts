import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const submittedPin = String(body?.pin || "").trim();

    const correctPin = String(process.env.EVENTSTACK_PIN || "").trim();

    if (!correctPin) {
      return NextResponse.json(
        { ok: false, error: "Server PIN is not configured." },
        { status: 500 }
      );
    }

    if (submittedPin !== correctPin) {
      return NextResponse.json(
        { ok: false, error: "Incorrect PIN." },
        { status: 401 }
      );
    }

    const res = NextResponse.json({ ok: true });

    res.cookies.set("eventstack_pin_ok", "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return res;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request." },
      { status: 400 }
    );
  }
}