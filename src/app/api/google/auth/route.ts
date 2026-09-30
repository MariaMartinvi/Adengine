import { NextResponse } from "next/server";
import { authUrl } from "@/lib/google/auth";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.redirect(authUrl("adengine")); }
