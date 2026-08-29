import type { Cylinder, CylinderMovement, Product } from "@/types";

export type CustomerCylinderBalance = {
  sent: number;
  returned: number;
  remaining: number;
  overdue: number;
  lost: number;
  damaged: number;
};

export type CustomerCylinderEvent = {
  id: string;
  date: string;
  type: CylinderMovement["type"];
  productName: string;
  serial?: string;
  sent: number;
  returned: number;
  remaining: number;
  notes?: string;
};

function forCustomer(m: CylinderMovement, customerId: string) {
  return m.customerId === customerId;
}

/** Transaction-based. Remaining is never stored — Remaining = Sent − Returned. */
export function customerCylinderBalance(
  customerId: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
): CustomerCylinderBalance {
  let sent = 0;
  let returned = 0;
  let lost = 0;
  let damaged = 0;

  for (const m of movements) {
    if (!forCustomer(m, customerId)) continue;
    if (m.type === "issued" && !m.sold) sent += 1;
    else if (m.type === "returned") returned += 1;
    else if (m.type === "lost") lost += 1;
    else if (m.type === "damaged") damaged += 1;
  }

  for (const c of cylinders) {
    if (c.status !== "at_customer" || c.customerId !== customerId) continue;
    const hasIssued = movements.some(
      (m) => m.cylinderId === c.id && m.type === "issued" && m.customerId === customerId && !m.sold,
    );
    if (!hasIssued) sent += 1;
  }

  return {
    sent,
    returned,
    remaining: sent - returned,
    overdue: 0,
    lost,
    damaged,
  };
}

export function customerCylinderHistory(
  customerId: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
  products: Product[],
): CustomerCylinderEvent[] {
  const cylMap = new Map(cylinders.map((c) => [c.id, c]));
  const rows = movements
    .filter((m) => forCustomer(m, customerId) && (m.type === "issued" || m.type === "returned" || m.type === "lost" || m.type === "damaged"))
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let runSent = 0;
  let runReturned = 0;
  return rows.map((m) => {
    const cyl = cylMap.get(m.cylinderId);
    const sent = m.type === "issued" && !m.sold ? 1 : 0;
    const returned = m.type === "returned" ? 1 : 0;
    runSent += sent;
    runReturned += returned;
    return {
      id: m.id,
      date: m.timestamp,
      type: m.type,
      productName: products.find((p) => p.id === cyl?.productId)?.name || cyl?.serialNumber || "Cylinder",
      serial: cyl?.serialNumber,
      sent,
      returned,
      remaining: runSent - runReturned,
      notes: m.notes,
    };
  }).reverse();
}
