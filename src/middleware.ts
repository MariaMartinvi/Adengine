import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Rutas que llaman máquinas, no personas: snippet de medición, Stripe (firma propia) y cron (CRON_SECRET).
const PUBLIC = ["/api/track", "/adengine.js", "/api/webhooks/stripe", "/api/cron/sync"];

// Todo lo demás pide usuario y contraseña (Basic Auth). Sin ADMIN_PASSWORD, la app queda cerrada.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();

  const expected = `${process.env.ADMIN_USER || "admin"}:${process.env.ADMIN_PASSWORD || ""}`;
  const header = req.headers.get("authorization") || "";
  const given = header.startsWith("Basic ") ? atob(header.slice(6)) : "";
  if (process.env.ADMIN_PASSWORD && given === expected) return NextResponse.next();

  return new NextResponse("Acceso restringido", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="AdEngine"' } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
