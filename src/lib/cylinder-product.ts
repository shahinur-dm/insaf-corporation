import type { Cylinder, CylinderStatus, Product } from "@/types";

export function isCylinderProduct(p?: Pick<Product, "uom"> | null) {
  return p?.uom === "cyl";
}

export const CYLINDER_SIZE_OPTIONS = [12, 35, 45] as const;

export function cylinderIsEmpty(c: Pick<Cylinder, "status" | "fillLevel">) {
  if (c.fillLevel === "empty") return true;
  if (c.fillLevel === "full") return false;
  return c.status === "refilling";
}

export function cylinderIsFullStock(c: Pick<Cylinder, "status" | "fillLevel">) {
  return c.status === "in_stock" && !cylinderIsEmpty(c);
}

/** Map existing cylinder statuses into overview buckets. */
export function cylinderOverviewCounts(cylinders: Pick<Cylinder, "status" | "fillLevel">[]) {
  let full = 0;
  let empty = 0;
  let refillPending = 0;
  let inTransit = 0;
  for (const c of cylinders) {
    if (c.status === "in_transit") inTransit += 1;
    if (c.status === "refilling" || (cylinderIsEmpty(c) && c.status === "in_stock")) {
      refillPending += 1;
    }
    if (cylinderIsFullStock(c)) full += 1;
    else if (cylinderIsEmpty(c) && c.status !== "at_customer" && c.status !== "in_transit") empty += 1;
  }
  return { total: cylinders.length, full, empty, refillPending, inTransit };
}

/** @deprecated use cylinderOverviewCounts */
export function cylinderStatusCounts(cylinders: Pick<Cylinder, "status">[]) {
  const c = cylinderOverviewCounts(cylinders);
  return { total: c.total, filled: c.full, empty: c.empty, refillPending: c.refillPending };
}

export function cylinderFillBucket(status: CylinderStatus): "filled" | "empty" | "refill" | "transit" {
  if (status === "refilling") return "refill";
  if (status === "in_transit") return "transit";
  if (status === "in_stock") return "filled";
  return "empty";
}

export function matchesCylinderSize(capacity: number, size: number) {
  return Math.abs((capacity || 0) - size) < 0.5;
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
    .filter((c) => c.productId === productId && c.status === "in_stock" && !cylinderIsEmpty(c) && !exclude.has(c.id))
    .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt))
    .slice(0, qty)
    .map((c) => c.id);
}

export function suggestSerials(code: string, qty: number) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = (code || "CYL").replace(/\s+/g, "").toUpperCase();
  return Array.from({ length: qty }, (_, i) => `${prefix}-${stamp}-${String(i + 1).padStart(3, "0")}`);
}
