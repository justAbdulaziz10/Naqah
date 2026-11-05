import { NextResponse, type NextRequest } from "next/server";

const LOCALES = ["ar", "en"];

/** Redirect locale-less paths to /ar or /en (Arabic first unless the browser prefers English). */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) return;

  const cookie = request.cookies.get("naqah-locale")?.value;
  const accept = request.headers.get("accept-language") ?? "";
  const prefersEnglish = /^en\b/i.test(accept.trim()) && !/\bar\b/i.test(accept.split(",")[0] ?? "");
  const locale = cookie && LOCALES.includes(cookie) ? cookie : prefersEnglish ? "en" : "ar";

  request.nextUrl.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  matcher: ["/((?!_next|api|icon|apple-icon|pwa-icons|favicon|brand|.*\\..*).*)"],
};
