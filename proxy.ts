import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const customerHost = process.env.CUSTOMER_APP_HOST?.toLowerCase();
  const requestHost = request.headers.get("host")?.split(":")[0]?.toLowerCase();

  if (customerHost && requestHost === customerHost) {
    const pathname = request.nextUrl.pathname;
    const customerPage = pathname === "/mi" || pathname.startsWith("/mi/");
    const customerApi = pathname === "/api/mi" || pathname.startsWith("/api/mi/");
    if (pathname.startsWith("/api/") && !customerApi) {
      return new NextResponse("No encontrado", { status: 404 });
    }
    if (pathname === "/" || (!customerPage && !customerApi)) {
      const url = request.nextUrl.clone();
      url.pathname = "/mi";
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
