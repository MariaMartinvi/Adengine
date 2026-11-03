import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto";
const key = () => Buffer.from(process.env.ENCRYPTION_KEY || "", "hex");
export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function decrypt(blob: string) {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// Clave con la que la web de un negocio avisa de sus ventas. Se deriva del id: no se guarda y no se puede adivinar sin ENCRYPTION_KEY.
export function salesKey(businessId: string) {
  return createHmac("sha256", key()).update(`ventas:${businessId}`).digest("hex").slice(0, 32);
}
export function checkSalesKey(businessId: string, given: string) {
  const a = Buffer.from(salesKey(businessId)), b = Buffer.from(String(given || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
