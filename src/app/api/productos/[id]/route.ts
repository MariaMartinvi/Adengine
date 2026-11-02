import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    await db.product.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
