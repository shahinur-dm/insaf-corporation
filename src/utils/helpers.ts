import type { LineItem } from "@/types";

export const lineAmount = (item: LineItem) => (Number(item.price) || 0) * (Number(item.quantity) || 0);

export const computeTotals = (items: LineItem[]) => {
  const subtotal = items.reduce((s, i) => s + lineAmount(i), 0);
  return { subtotal, tax: 0, total: subtotal };
};

export function paymentStatus(total: number, paid: number): "unpaid" | "partial" | "paid" {
  if ((paid || 0) <= 0.009) return "unpaid";
  if ((paid || 0) + 0.009 >= (total || 0) && (total || 0) > 0) return "paid";
  return "partial";
}

export const genOrderNo = (prefix = "SO") => {
  const y = new Date().getFullYear();
  const n = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${y}-${n}`;
};
