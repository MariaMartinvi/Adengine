import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { listAccessibleCustomers } from "@/lib/google/ads";
import BusinessPanel from "@/components/BusinessPanel";
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: { id: string } }) {
  const b = await db.business.findUnique({
    where: { id: params.id },
    include: {
      campaigns: { orderBy: { createdAt: "desc" }, include: { keywords: { orderBy: { volume: "desc" }, include: { metrics: true } }, ads: true, metrics: true, proposals: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" } } } },
      actions: { orderBy: { createdAt: "desc" }, take: 40 },
      sales: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!b) notFound();
  let accounts: { id: string; name: string }[] = [];
  try { accounts = await listAccessibleCustomers(); } catch { /* sin conexión aún */ }
  return <BusinessPanel data={JSON.parse(JSON.stringify(b))} accounts={accounts} />;
}
