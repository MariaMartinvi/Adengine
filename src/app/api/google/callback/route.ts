import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google/auth";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${process.env.APP_URL}/?error=${encodeURIComponent(url.searchParams.get("error") || "sin código")}`);
  try {
    const { refreshToken, email } = await exchangeCode(code);
    if (!refreshToken) throw new Error("Google no devolvió refresh token. Revoca el acceso en tu cuenta de Google y vuelve a conectar.");
    await db.googleConnection.upsert({ where: { email }, create: { email, refreshTokenEnc: encrypt(refreshToken) }, update: { refreshTokenEnc: encrypt(refreshToken) } });
    return NextResponse.redirect(`${process.env.APP_URL}/?connected=1`);
  } catch (e: any) {
    return NextResponse.redirect(`${process.env.APP_URL}/?error=${encodeURIComponent(e.message)}`);
  }
}
