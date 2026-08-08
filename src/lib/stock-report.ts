import type { Product, StockMovement } from "@/types";
import { parseRecordTime, type DateRange } from "@/lib/date-range";

export type StockLedgerLine = {
  id: string;
  date: string;
  particulars: string;
  qtyIn: number;
  qtyOut: number;
  inHand: number;
  unitCost: number;
  valuation: number;
};

export type ProductStockReport = {
  id: string;
  code: string;
  name: string;
  qtyIn: number;
  qtyOut: number;
  inHand: number;
  unitCost: number;
  valuation: number;
  lines: StockLedgerLine[];
};

function isIn(type: StockMovement["type"]) {
  return type === "in" || type === "return";
}

function isOut(type: StockMovement["type"]) {
  return type === "out";
}

function qtyInOf(m: StockMovement) {
  if (isIn(m.type)) return m.quantity;
  return 0;
}

function qtyOutOf(m: StockMovement) {
  if (isOut(m.type)) return m.quantity;
  return 0;
}

function refLabel(m: StockMovement) {
  const bits = [m.notes, m.refType, m.refId].filter(Boolean);
  if (bits.length) return bits[0] as string;
  if (m.type === "in") return "Stock In";
  if (m.type === "out") return "Stock Out";
  return m.type;
}

export function buildStockReport(
  products: Product[],
  movements: StockMovement[],
  range: DateRange,
): ProductStockReport[] {
  const fromTs = range.preset !== "all" && range.from ? parseRecordTime(range.from) : null;
  const toTs = range.preset !== "all" && range.to ? parseRecordTime(`${range.to}T23:59:59`) : null;

  const byProduct = new Map<string, StockMovement[]>();
  for (const m of movements) {
    const list = byProduct.get(m.productId) ?? [];
    list.push(m);
    byProduct.set(m.productId, list);
  }

  return products
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const all = (byProduct.get(p.id) ?? []).slice().sort(
        (a, b) => (parseRecordTime(a.date) ?? 0) - (parseRecordTime(b.date) ?? 0),
      );

      let openingQty = 0;
      let lastCost = p.cost ?? 0;
      const period: StockMovement[] = [];

      if (all.length === 0) {
        openingQty = p.stock ?? 0;
      } else {
        for (const m of all) {
          const t = parseRecordTime(m.date) ?? 0;
          if (fromTs != null && t < fromTs) {
            openingQty = m.balanceAfter;
            if (m.unitCost != null) lastCost = m.unitCost;
            continue;
          }
          if (toTs != null && t > toTs) continue;
          period.push(m);
        }
        if (period.length && (fromTs == null || !all.some((m) => {
          const t = parseRecordTime(m.date) ?? 0;
          return fromTs != null && t < fromTs;
        }))) {
          const first = period[0];
          openingQty = first.balanceAfter - qtyInOf(first) + qtyOutOf(first);
        }
      }

      const lines: StockLedgerLine[] = [];
      let run = openingQty;
      const openingDate = range.from || p.createdAt;
      lines.push({
        id: `${p.id}-open`,
        date: openingDate,
        particulars: "Opening",
        qtyIn: 0,
        qtyOut: 0,
        inHand: openingQty,
        unitCost: lastCost,
        valuation: openingQty * lastCost,
      });

      let periodIn = 0;
      let periodOut = 0;
      for (const m of period) {
        const qIn = qtyInOf(m);
        const qOut = qtyOutOf(m);
        periodIn += qIn;
        periodOut += qOut;
        run = m.balanceAfter;
        if (m.unitCost != null) lastCost = m.unitCost;
        lines.push({
          id: m.id,
          date: m.date,
          particulars: refLabel(m),
          qtyIn: qIn,
          qtyOut: qOut,
          inHand: run,
          unitCost: m.unitCost ?? lastCost,
          valuation: run * (m.unitCost ?? lastCost),
        });
      }

      const inHand = period.length ? run : openingQty;
      const unitCost = lastCost;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        qtyIn: periodIn,
        qtyOut: periodOut,
        inHand,
        unitCost,
        valuation: inHand * unitCost,
        lines,
      };
    });
}
