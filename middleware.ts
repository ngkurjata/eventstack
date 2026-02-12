import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|pin|api/pin).*)",
  ],
};

export function middleware(req: NextRequest) {
  const ok = req.cookies.get("eventstack_pin_ok")?.value === "1";
  if (ok) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/pin";
  url.searchParams.set(
    "next",
    req.nextUrl.pathname + req.nextUrl.search
  );
  return NextResponse.redirect(url);
}
