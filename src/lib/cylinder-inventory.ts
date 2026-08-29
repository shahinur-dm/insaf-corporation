import type { Cylinder, Delivery, Product, SalesOrder, StockMovement } from "@/types";
import { cylinderIsEmpty, cylinderIsFullStock, isCylinderProduct } from "@/lib/cylinder-product";

export type InventoryStockStatus = "normal" | "low" | "out";

export type ProductInventoryRow = {
  id: string;
  sl: number;
  productId: string;
  name: string;
  category?: string;
  total: number;
  full: number;
  reserved: number;
  delivered: number;
  empty: number;
  refillPending: number;
  available: number;
  reorderLevel: number;
  status: InventoryStockStatus;
};

const OPEN_SO = new Set(["confirmed", "invoiced", "paid"]);
const DONE_DELIVERY = new Set(["delivered", "confirmed"]);

export function deliveredQtyByProduct(deliveries: Delivery[], productId: string, salesOrderId?: string) {
  let qty = 0;
  for (const d of deliveries) {
    if (!DONE_DELIVERY.has(d.status)) continue;
    if (salesOrderId && d.salesOrderId !== salesOrderId) continue;
    for (const it of d.items) {
      if (it.productId === productId) qty += Number(it.quantity) || 0;
    }
  }
  return qty;
}

/** Open SO qty not yet delivered, excluding orders that already deducted product stock (legacy). */
export function reservedQtyForProduct(
  productId: string,
  sales: SalesOrder[],
  deliveries: Delivery[],
  movements: StockMovement[],
) {
  const deductedSo = new Set(
    movements.filter((m) => m.refType === "sales" && m.type === "out" && m.refId).map((m) => m.refId as string),
  );
  let reserved = 0;
  for (const so of sales) {
    if (!OPEN_SO.has(so.status)) continue;
    if (deductedSo.has(so.id)) continue;
    const ordered = so.items
      .filter((it) => it.productId === productId)
      .reduce((a, it) => a + (Number(it.quantity) || 0), 0);
    if (ordered <= 0) continue;
    const delivered = deliveredQtyByProduct(deliveries, productId, so.id);
    reserved += Math.max(0, ordered - delivered);
  }
  return reserved;
}

export function remainingOrderQty(so: SalesOrder, deliveries: Delivery[], productId: string) {
  const ordered = so.items.filter((i) => i.productId === productId).reduce((a, i) => a + (Number(i.quantity) || 0), 0);
  return Math.max(0, ordered - deliveredQtyByProduct(deliveries, productId, so.id));
}

export function buildProductInventory(
  products: Product[],
  cylinders: Cylinder[],
  sales: SalesOrder[],
  deliveries: Delivery[],
  movements: StockMovement[],
): ProductInventoryRow[] {
  return products.map((p, idx) => {
    const mine = cylinders.filter((c) => c.productId === p.id && c.status !== "damaged" && c.status !== "lost");
    const isCyl = isCylinderProduct(p) || (p.productType !== "gas" && mine.length > 0);
    const reserved = reservedQtyForProduct(p.id, sales, deliveries, movements);
    let total: number;
    let full: number;
    let delivered: number;
    let empty: number;
    let refillPending: number;
    if (isCyl) {
      total = mine.length;
      full = mine.filter(cylinderIsFullStock).length;
      delivered = mine.filter((c) => c.status === "at_customer").length;
      empty = mine.filter((c) => cylinderIsEmpty(c) && c.status !== "at_customer" && c.status !== "in_transit").length;
      refillPending = mine.filter((c) =>
        c.status === "refilling" || (cylinderIsEmpty(c) && c.status === "in_stock"),
      ).length;
    } else {
      total = Math.max(0, (p.stock || 0) + reserved);
      full = Math.max(0, p.stock || 0);
      delivered = deliveredQtyByProduct(deliveries, p.id);
      empty = 0;
      refillPending = 0;
    }
    const available = Math.max(0, full - reserved);
    const status: InventoryStockStatus = available <= 0
      ? "out"
      : available <= (p.reorderLevel || 0)
        ? "low"
        : "normal";
    return {
      id: p.id,
      sl: idx + 1,
      productId: p.id,
      name: p.name,
      category: p.category,
      total,
      full,
      reserved,
      delivered,
      empty,
      refillPending,
      available,
      reorderLevel: p.reorderLevel || 0,
      status,
    };
  });
}

export function sumInventory(rows: ProductInventoryRow[]) {
  return rows.reduce(
    (a, r) => ({
      total: a.total + r.total,
      full: a.full + r.full,
      reserved: a.reserved + r.reserved,
      delivered: a.delivered + r.delivered,
      empty: a.empty + r.empty,
      refillPending: a.refillPending + r.refillPending,
      available: a.available + r.available,
    }),
    { total: 0, full: 0, reserved: 0, delivered: 0, empty: 0, refillPending: 0, available: 0 },
  );
}
