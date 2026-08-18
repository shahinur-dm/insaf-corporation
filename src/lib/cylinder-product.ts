import type { Cylinder, CylinderStatus, Product } from "@/types";

export function isCylinderProduct(p?: Pick<Product, "uom"> | null) {
  return p?.uom === "cyl";
}

/** Map existing cylinder statuses into filled / empty / refill-pending buckets. */
export function cylinderStatusCounts(cylinders: Pick<Cylinder, "status">[]) {
  let filled = 0;
  let empty = 0;
  let refillPending = 0;
  for (const c of cylinders) {
    const bucket = cylinderFillBucket(c.status);
    if (bucket === "filled") filled += 1;
    else if (bucket === "refill") refillPending += 1;
    else empty += 1;
  }
  return { total: cylinders.length, filled, empty, refillPending };
}

export function cylinderFillBucket(status: CylinderStatus): "filled" | "empty" | "refill" {
  if (status === "refilling") return "refill";
  if (status === "in_stock" || status === "at_customer" || status === "in_transit") return "filled";
  return "empty";
}

export function parseSerials(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const s = raw.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function pickFifo(
  cylinders: Cylinder[],
  productId: string,
  qty: number,
  exclude = new Set<string>(),
) {
  return cylinders
    .filter((c) => c.productId === productId && c.status === "in_stock" && !exclude.has(c.id))
    .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt))
    .slice(0, qty)
    .map((c) => c.id);
}

export function suggestSerials(code: string, qty: number) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = (code || "CYL").replace(/\s+/g, "").toUpperCase();
  return Array.from({ length: qty }, (_, i) => `${prefix}-${stamp}-${String(i + 1).padStart(3, "0")}`);
}
