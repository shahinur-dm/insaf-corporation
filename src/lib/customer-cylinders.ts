import type { Cylinder, CylinderMovement, Product } from "@/types";

export type PartyCylinderKind = "customer" | "supplier";

export type PartyCylinderBalance = {
  sent: number;
  returned: number;
  remaining: number;
  overdue: number;
  lost: number;
  damaged: number;
};

export type PartyCylinderEvent = {
  id: string;
  date: string;
  type: CylinderMovement["type"];
  typeKey:
    | "cyl.move.fullToCustomer"
    | "cyl.move.emptyFromCustomer"
    | "cyl.move.toSupplier"
    | "cyl.move.fromSupplier"
    | "cyl.move.damaged"
    | "cyl.move.lost";
  productName: string;
  serial?: string;
  sent: number;
  returned: number;
  remaining: number;
  lost: number;
  notes?: string;
};

function forParty(m: CylinderMovement, kind: PartyCylinderKind, id: string) {
  return kind === "customer" ? m.customerId === id : m.supplierId === id;
}

function isSend(kind: PartyCylinderKind, m: CylinderMovement) {
  if (kind === "customer") return m.type === "issued" && !m.sold;
  return m.type === "transferred";
}

function isReturn(kind: PartyCylinderKind, m: CylinderMovement) {
  if (kind === "customer") return m.type === "returned";
  return m.type === "received" || m.type === "refilled" || m.type === "returned" || m.type === "damaged";
}

function typeKey(kind: PartyCylinderKind, m: CylinderMovement): PartyCylinderEvent["typeKey"] {
  if (m.type === "lost") return "cyl.move.lost";
  if (m.type === "damaged") return "cyl.move.damaged";
  if (kind === "supplier") {
    if (isSend(kind, m)) return "cyl.move.toSupplier";
    return "cyl.move.fromSupplier";
  }
  if (m.type === "returned") return "cyl.move.emptyFromCustomer";
  return "cyl.move.fullToCustomer";
}

function overdueCount(
  kind: PartyCylinderKind,
  id: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
) {
  const now = Date.now();
  let n = 0;
  for (const c of cylinders) {
    const held = kind === "customer"
      ? c.status === "at_customer" && c.customerId === id
      : Boolean(c.supplierId === id) && c.status !== "damaged" && c.status !== "lost" && c.status !== "at_customer";
    if (!held) continue;
    const last = movements
      .filter((m) => m.cylinderId === c.id && forParty(m, kind, id) && m.expectedReturnAt)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .at(-1);
    if (last?.expectedReturnAt && new Date(last.expectedReturnAt).getTime() < now) n += 1;
  }
  return n;
}

/** Transaction-based. Remaining is never stored — Remaining = Sent − Returned. Lost is separate. */
export function partyCylinderBalance(
  kind: PartyCylinderKind,
  id: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
): PartyCylinderBalance {
  let sent = 0;
  let returned = 0;
  let lost = 0;
  let damaged = 0;

  for (const m of movements) {
    if (!forParty(m, kind, id)) continue;
    if (isSend(kind, m)) sent += 1;
    else if (isReturn(kind, m)) returned += 1;
    if (m.type === "lost") lost += 1;
    if (m.type === "damaged") damaged += 1;
  }

  return {
    sent,
    returned,
    remaining: sent - returned,
    overdue: overdueCount(kind, id, cylinders, movements),
    lost,
    damaged,
  };
}

export function partyCylinderHistory(
  kind: PartyCylinderKind,
  id: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
  products: Product[],
): PartyCylinderEvent[] {
  const cylMap = new Map(cylinders.map((c) => [c.id, c]));
  const rows = movements
    .filter((m) => forParty(m, kind, id) && (isSend(kind, m) || isReturn(kind, m) || m.type === "lost" || m.type === "damaged"))
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let runSent = 0;
  let runReturned = 0;
  return rows.map((m) => {
    const cyl = cylMap.get(m.cylinderId);
    const sent = isSend(kind, m) ? 1 : 0;
    const returned = isReturn(kind, m) ? 1 : 0;
    runSent += sent;
    runReturned += returned;
    return {
      id: m.id,
      date: m.timestamp,
      type: m.type,
      typeKey: typeKey(kind, m),
      productName: products.find((p) => p.id === cyl?.productId)?.name || cyl?.serialNumber || "Cylinder",
      serial: cyl?.serialNumber,
      sent,
      returned,
      remaining: runSent - runReturned,
      lost: m.type === "lost" ? 1 : 0,
      notes: m.notes,
    };
  }).reverse();
}

/** Cylinders physically with a party that have no matching send movement. Never used to inflate Sent. */
export function partyCylinderMissingMoves(
  kind: PartyCylinderKind,
  id: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
) {
  let n = 0;
  for (const c of cylinders) {
    if (kind === "customer") {
      if (c.status !== "at_customer" || c.customerId !== id) continue;
      const hasIssued = movements.some(
        (m) => m.cylinderId === c.id && m.type === "issued" && m.customerId === id && !m.sold,
      );
      if (!hasIssued) n += 1;
    } else if (c.supplierId === id && c.status !== "damaged" && c.status !== "lost" && c.status !== "scrapped" && c.status !== "written_off") {
      const hasSend = movements.some(
        (m) => m.cylinderId === c.id && m.supplierId === id && m.type === "transferred",
      );
      if (!hasSend) n += 1;
    }
  }
  return n;
}

export const customerCylinderBalance = (
  customerId: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
) => partyCylinderBalance("customer", customerId, cylinders, movements);

export const customerCylinderHistory = (
  customerId: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
  products: Product[],
) => partyCylinderHistory("customer", customerId, cylinders, movements, products);

export const supplierCylinderBalance = (
  supplierId: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
) => partyCylinderBalance("supplier", supplierId, cylinders, movements);

export const supplierCylinderHistory = (
  supplierId: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
  products: Product[],
) => partyCylinderHistory("supplier", supplierId, cylinders, movements, products);
