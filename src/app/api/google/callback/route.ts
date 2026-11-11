import { NextResponse } from "next/server";
import { exchangeCode, missingAdsScope } from "@/lib/google/auth";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${process.env.APP_URL}/?error=${encodeURIComponent(url.searchParams.get("error") || "sin código")}`);
  try {
    const { refreshToken, email, scope } = await exchangeCode(code);
    if (!refreshToken) throw new Error("Google no devolvió refresh token. Revoca el acceso en tu cuenta de Google y vuelve a conectar.");
    if (missingAdsScope(scope)) throw new Error("No se concedió el permiso de Google Ads. Vuelve a conectar y marca todas las casillas de permisos.");
    // createdAt se renueva: la conexión que se usa es la última conectada (ver accessToken).
    await db.googleConnection.upsert({ where: { email }, create: { email, refreshTokenEnc: encrypt(refreshToken) }, update: { refreshTokenEnc: encrypt(refreshToken), createdAt: new Date() } });
    return NextResponse.redirect(`${process.env.APP_URL}/?connected=1`);
  } catch (e: any) {
    return NextResponse.redirect(`${process.env.APP_URL}/?error=${encodeURIComponent(e.message)}`);
  }
}
