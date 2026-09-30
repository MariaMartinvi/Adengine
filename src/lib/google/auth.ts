import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

const SCOPE = "https://www.googleapis.com/auth/adwords";
const redirect = () => `${process.env.APP_URL}/api/google/callback`;

export function authUrl(state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirect(),
    response_type: "code",
    scope: `${SCOPE} email`,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirect(),
      grant_type: "authorization_code",
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`OAuth: ${JSON.stringify(j)}`);
  const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${j.access_token}` },
  }).then((x) => x.json());
  return { refreshToken: j.refresh_token as string, email: info.email as string };
}

let cache: { token: string; exp: number } | null = null;

export async function accessToken() {
  if (cache && cache.exp > Date.now() + 60_000) return cache.token;
  const conn = await db.googleConnection.findFirst({ orderBy: { createdAt: "desc" } });
  if (!conn) throw new Error("Google Ads no está conectado. Pulsa «Conectar Google Ads».");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: decrypt(conn.refreshTokenEnc),
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Refresh: ${JSON.stringify(j)}`);
  cache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cache.token;
}
