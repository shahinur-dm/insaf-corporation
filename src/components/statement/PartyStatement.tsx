import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Printer } from "lucide-react";
import { customerService } from "@/services/customer.service";
import { supplierService } from "@/services/supplier.service";
import { salesService } from "@/services/sales.service";
import { purchaseService } from "@/services/purchase.service";
import { accountingService } from "@/services/accounting.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { BrandLogo } from "@/components/common/BrandLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { EMPTY_DATE_RANGE, type DateRange } from "@/lib/date-range";
import { buildPartyStatement, type PartyKind, type StatementLine } from "@/lib/party-statement";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";

const LINE_LABEL: Record<StatementLine["type"], MessageKey> = {
  opening: "statement.opening",
  invoice: "statement.invoice",
  purchase: "statement.purchase",
  payment: "statement.payment",
  receipt: "statement.receipt",
};

export function PartyStatement({ kind, id }: { kind: PartyKind; id: string }) {
  const t = useT();
  const [range, setRange] = useState<DateRange>(EMPTY_DATE_RANGE);

  const partyQuery = useQuery({
    queryKey: [kind === "customer" ? "customers" : "suppliers", id],
    queryFn: () => (kind === "customer" ? customerService.get(id) : supplierService.get(id)),
  });
  const { data: sales = [] } = useQuery({
    queryKey: ["sales"],
    queryFn: salesService.list,
    enabled: kind === "customer",
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: purchaseService.list,
    enabled: kind === "supplier",
  });
  const { data: vouchers = [] } = useQuery({
    queryKey: ["vouchers"],
    queryFn: accountingService.listVouchers,
  });

  const party = partyQuery.data;
  const statement = useMemo(() => {
    if (!party) return null;
    if (kind === "customer") {
      return buildPartyStatement({ kind: "customer", party, sales, vouchers, range });
    }
    return buildPartyStatement({ kind: "supplier", party, purchases, vouchers, range });
  }, [kind, party, sales, purchases, vouchers, range]);

  if (partyQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }
  if (partyQuery.isFetched && !party) {
    return (
      <div className="p-6 text-sm text-destructive">
        {kind === "customer" ? t("customers.notFound") : t("suppliers.notFound")}
      </div>
    );
  }
  if (!party || !statement) return null;

  const closingLabel = kind === "customer"
    ? (statement.closingBalance >= 0 ? t("statement.receivable") : t("statement.advance"))
    : (statement.closingBalance >= 0 ? t("statement.payable") : t("statement.advance"));

  const backTo = kind === "customer"
    ? { to: "/customers/$id", params: { id } }
    : { to: "/suppliers/$id", params: { id } };

  return (
    <div>
      <PageHeader
        title={`${t("statement.title")} — ${party.name}`}
        description={t("statement.desc")}
        backTo={backTo}
        backLabel={party.name}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" /> {t("statement.print")}
            </Button>
          </div>
        }
      />

      <div className="no-print mb-4 rounded-xl border bg-card/60 p-3">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <Card className="statement-sheet">
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
            <div className="flex items-start gap-3">
              <BrandLogo size="lg" className="rounded-lg" />
              <div>
                <p className="font-display text-base font-semibold">{t("brand.name")}</p>
                <p className="text-xs text-muted-foreground">{t("brand.tagline")}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold">
                  <FileText className="h-4 w-4 text-primary" />
                  {t("statement.title")}
                </p>
              </div>
            </div>
            <div className="text-sm">
              <p className="font-display text-base font-semibold">{party.name}</p>
              <p className="text-muted-foreground">{party.phone}</p>
              {party.address && <p className="max-w-xs text-muted-foreground">{party.address}</p>}
              {party.gstin && <p className="text-muted-foreground">{t("customers.gstin")}: {party.gstin}</p>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryTile label={t("statement.opening")} value={formatCurrency(Math.abs(statement.openingBalance))} />
            <SummaryTile
              label={kind === "customer" ? t("common.total") : t("common.total")}
              value={formatCurrency(kind === "customer" ? statement.totalDebit : statement.totalCredit)}
            />
            <SummaryTile
              label={`${t("statement.closing")} · ${closingLabel}`}
              value={formatCurrency(Math.abs(statement.closingBalance))}
              emphasize
            />
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">{t("common.date")}</TableHead>
                  <TableHead>{t("common.type")}</TableHead>
                  <TableHead>{t("statement.particulars")}</TableHead>
                  <TableHead className="text-right">{t("statement.debit")}</TableHead>
                  <TableHead className="text-right">{t("statement.credit")}</TableHead>
                  <TableHead className="text-right">{t("statement.balance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.lines.map((line) => (
                  <TableRow key={line.id} className={line.type === "opening" ? "bg-muted/40 font-medium" : undefined}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDate(line.date)}</TableCell>
                    <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t(LINE_LABEL[line.type])}
                    </TableCell>
                    <TableCell>
                      {line.href ? (
                        <Link
                          to={line.href.to}
                          params={line.href.params}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {line.particulars}
                        </Link>
                      ) : (
                        <span className="text-sm">{line.particulars || t(LINE_LABEL[line.type])}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.debit ? formatCurrency(line.debit) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.credit ? formatCurrency(line.credit) : "—"}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right tabular-nums font-medium",
                      line.balance < 0 && "text-emerald-700 dark:text-emerald-400",
                    )}>
                      {formatCurrency(Math.abs(line.balance))}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        {kind === "customer"
                          ? (line.balance >= 0 ? t("statement.dr") : t("statement.cr"))
                          : (line.balance >= 0 ? t("statement.cr") : t("statement.dr"))}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {statement.lines.length <= 1 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      {t("statement.empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="font-semibold">{t("statement.closing")}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(statement.totalDebit)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(statement.totalCredit)}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(Math.abs(statement.closingBalance))}{" "}
                    <span className="text-xs font-normal text-muted-foreground">{closingLabel}</span>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-muted/30 p-3", emphasize && "border-primary/30 bg-primary/5")}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold">{value}</p>
    </div>
  );
}
