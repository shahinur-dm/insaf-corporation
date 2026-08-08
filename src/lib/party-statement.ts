import type { Customer, PurchaseOrder, SalesOrder, Supplier, Voucher } from "@/types";
import { parseRecordTime, type DateRange } from "@/lib/date-range";

export type PartyKind = "customer" | "supplier";

export type StatementLineType = "opening" | "invoice" | "purchase" | "payment" | "receipt";

export type StatementLineHref =
  | { to: "/sales/$id"; params: { id: string } }
  | { to: "/purchases/$id"; params: { id: string } };

export type StatementLine = {
  id: string;
  date: string;
  particulars: string;
  type: StatementLineType;
  debit: number;
  credit: number;
  balance: number;
  href?: StatementLineHref;
};

export type PartyStatementModel = {
  partyId: string;
  partyName: string;
  partyKind: PartyKind;
  phone: string;
  address: string;
  gstin?: string;
  openingBalance: number;
  lines: StatementLine[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
};

type RawLine = Omit<StatementLine, "balance">;

function signedDelta(kind: PartyKind, debit: number, credit: number) {
  return kind === "customer" ? debit - credit : credit - debit;
}

function buildCustomerRaws(sales: SalesOrder[], vouchers: Voucher[], partyId: string): RawLine[] {
  const lines: RawLine[] = [];
  for (const inv of sales) {
    if (inv.customerId !== partyId) continue;
    if (inv.status === "cancelled" || inv.status === "draft") continue;
    lines.push({
      id: `inv-${inv.id}`,
      date: inv.date,
      particulars: inv.orderNo,
      type: "invoice",
      debit: inv.total || 0,
      credit: 0,
      href: { to: "/sales/$id", params: { id: inv.id } },
    });
    if ((inv.paid || 0) > 0) {
      lines.push({
        id: `inv-pay-${inv.id}`,
        date: inv.date,
        particulars: inv.orderNo,
        type: "payment",
        debit: 0,
        credit: inv.paid,
        href: { to: "/sales/$id", params: { id: inv.id } },
      });
    }
  }
  for (const v of vouchers) {
    if (v.partyType !== "customer" || v.partyId !== partyId) continue;
    if (v.type === "journal") continue;
    const isReceipt = v.type === "receipt";
    lines.push({
      id: `vch-${v.id}`,
      date: v.date,
      particulars: v.voucherNo + (v.notes ? ` — ${v.notes}` : ""),
      type: isReceipt ? "receipt" : "payment",
      debit: isReceipt ? 0 : v.amount,
      credit: isReceipt ? v.amount : 0,
    });
  }
  return lines;
}

function buildSupplierRaws(purchases: PurchaseOrder[], vouchers: Voucher[], partyId: string): RawLine[] {
  const lines: RawLine[] = [];
  for (const po of purchases) {
    if (po.supplierId !== partyId) continue;
    if (po.status === "cancelled" || po.status === "draft") continue;
    lines.push({
      id: `po-${po.id}`,
      date: po.date,
      particulars: po.orderNo,
      type: "purchase",
      debit: 0,
      credit: po.total || 0,
      href: { to: "/purchases/$id", params: { id: po.id } },
    });
    if ((po.paid || 0) > 0) {
      lines.push({
        id: `po-pay-${po.id}`,
        date: po.date,
        particulars: po.orderNo,
        type: "payment",
        debit: po.paid,
        credit: 0,
        href: { to: "/purchases/$id", params: { id: po.id } },
      });
    }
  }
  for (const v of vouchers) {
    if (v.partyType !== "supplier" || v.partyId !== partyId) continue;
    if (v.type === "journal") continue;
    const isPayment = v.type === "payment";
    lines.push({
      id: `vch-${v.id}`,
      date: v.date,
      particulars: v.voucherNo + (v.notes ? ` — ${v.notes}` : ""),
      type: isPayment ? "payment" : "receipt",
      debit: isPayment ? v.amount : 0,
      credit: isPayment ? 0 : v.amount,
    });
  }
  return lines;
}

function sortByDate(a: RawLine, b: RawLine) {
  return (parseRecordTime(a.date) ?? 0) - (parseRecordTime(b.date) ?? 0);
}

export function buildPartyStatement(opts: {
  kind: "customer";
  party: Customer;
  sales: SalesOrder[];
  purchases?: PurchaseOrder[];
  vouchers: Voucher[];
  range: DateRange;
}): PartyStatementModel;
export function buildPartyStatement(opts: {
  kind: "supplier";
  party: Supplier;
  sales?: SalesOrder[];
  purchases: PurchaseOrder[];
  vouchers: Voucher[];
  range: DateRange;
}): PartyStatementModel;
export function buildPartyStatement(opts: {
  kind: PartyKind;
  party: Customer | Supplier;
  sales?: SalesOrder[];
  purchases?: PurchaseOrder[];
  vouchers: Voucher[];
  range: DateRange;
}): PartyStatementModel {
  const { kind, party, vouchers, range } = opts;
  const raws = (
    kind === "customer"
      ? buildCustomerRaws(opts.sales ?? [], vouchers, party.id)
      : buildSupplierRaws(opts.purchases ?? [], vouchers, party.id)
  ).sort(sortByDate);

  const fromTs = range.preset !== "all" && range.from ? parseRecordTime(range.from) : null;
  const toTs = range.preset !== "all" && range.to ? parseRecordTime(`${range.to}T23:59:59`) : null;

  let opening = party.openingBalance || 0;
  const period: RawLine[] = [];
  for (const line of raws) {
    const t = parseRecordTime(line.date) ?? 0;
    if (fromTs != null && t < fromTs) {
      opening += signedDelta(kind, line.debit, line.credit);
      continue;
    }
    if (toTs != null && t > toTs) continue;
    period.push(line);
  }

  const openingDate = range.from || party.createdAt;
  let running = opening;
  const openingDebit = kind === "customer"
    ? (opening >= 0 ? opening : 0)
    : (opening < 0 ? -opening : 0);
  const openingCredit = kind === "customer"
    ? (opening < 0 ? -opening : 0)
    : (opening >= 0 ? opening : 0);
  const lines: StatementLine[] = [
    {
      id: "opening",
      date: openingDate,
      particulars: "",
      type: "opening",
      debit: openingDebit,
      credit: openingCredit,
      balance: opening,
    },
  ];

  for (const line of period) {
    running += signedDelta(kind, line.debit, line.credit);
    lines.push({ ...line, balance: running });
  }

  const totalDebit = lines.reduce((a, l) => a + l.debit, 0);
  const totalCredit = lines.reduce((a, l) => a + l.credit, 0);

  return {
    partyId: party.id,
    partyName: party.name,
    partyKind: kind,
    phone: party.phone,
    address: party.address,
    gstin: party.gstin,
    openingBalance: opening,
    lines,
    totalDebit,
    totalCredit,
    closingBalance: running,
  };
}
