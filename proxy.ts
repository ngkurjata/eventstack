import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow:
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/pin" ||
    pathname.startsWith("/api/pin") ||
    pathname === "/share"
  ) {
    return NextResponse.next();
  }

  const ok = req.cookies.get("eventstack_pin_ok")?.value;

  if (!ok) {
    const url = req.nextUrl.clone();
    url.pathname = "/pin";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
