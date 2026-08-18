import type { Customer, SalesOrder, Voucher } from "@/types";
import { parseRecordTime } from "@/lib/date-range";

/** Signed opening for customer AR: receivable +, payable −. Legacy docs without a type keep the stored sign. */
export function customerOpeningSigned(c: Pick<Customer, "openingBalance" | "openingBalanceType">): number {
  const raw = Number(c.openingBalance) || 0;
  if (c.openingBalanceType === "payable") return -Math.abs(raw);
  if (c.openingBalanceType === "receivable") return Math.abs(raw);
  return raw;
}

export function customerOutstanding(c: Customer, sales: SalesOrder[], vouchers: Voucher[]): number {
  const salesNet = sales
    .filter((s) => s.customerId === c.id && s.status !== "cancelled" && s.status !== "draft")
    .reduce((a, s) => a + (s.total || 0) - (s.paid || 0), 0);
  let voucherAdj = 0;
  for (const v of vouchers) {
    if (v.partyType !== "customer" || v.partyId !== c.id || v.type === "journal") continue;
    if (v.type === "receipt") voucherAdj -= v.amount || 0;
    else if (v.type === "payment") voucherAdj += v.amount || 0;
  }
  return customerOpeningSigned(c) + salesNet + voucherAdj;
}

export type CreditReminderNotice = {
  id: string;
  name: string;
  days: number;
  due: number;
};

export function creditReminderNotice(
  c: Customer,
  sales: SalesOrder[],
  vouchers: Voucher[],
  now = Date.now(),
): CreditReminderNotice | null {
  if (!c.creditReminderEnabled) return null;
  const period = Math.floor(Number(c.creditReminderDays) || 0);
  if (period < 1) return null;
  const due = customerOutstanding(c, sales, vouchers);
  if (due <= 0) return null;

  let oldest: number | null = customerOpeningSigned(c) > 0 ? (parseRecordTime(c.createdAt) ?? null) : null;
  for (const s of sales) {
    if (s.customerId !== c.id || s.status === "cancelled" || s.status === "draft") continue;
    if ((s.total || 0) - (s.paid || 0) <= 0) continue;
    const t = parseRecordTime(s.date);
    if (t == null) continue;
    oldest = oldest == null ? t : Math.min(oldest, t);
  }
  if (oldest == null) oldest = parseRecordTime(c.createdAt) ?? now;
  const ageDays = Math.floor((now - oldest) / 86400000);
  if (ageDays < period) return null;
  return { id: c.id, name: c.name, days: ageDays, due };
}
