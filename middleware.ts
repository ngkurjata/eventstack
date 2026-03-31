import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/pin" ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/build-trip")
  ) {
    return NextResponse.next();
  }

  const ok = req.cookies.get("eventstack_pin_ok")?.value;

  if (!ok) {
    const url = req.nextUrl.clone();
    const intended = `${pathname}${search || ""}`;
    url.pathname = "/pin";
    url.searchParams.set("next", intended);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};