import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cylinderService } from "@/services/cylinder.service";
import { productService } from "@/services/product.service";
import { customerService } from "@/services/customer.service";
import { supplierService } from "@/services/supplier.service";
import { buildCylinderLedger, type CylinderHeadKind, type CylinderHeadReport } from "@/lib/cylinder-ledger";
import { formatDate } from "@/utils/formatters";
import type { DateRange } from "@/lib/date-range";
import { useT, type MessageKey } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { PartyNameLink } from "@/components/common/PartyNameLink";

const KIND_ORDER: CylinderHeadKind[] = ["warehouse", "customer", "supplier"];
const KIND_LABEL: Record<CylinderHeadKind, MessageKey> = {
  warehouse: "cylinders.head.warehouse",
  customer: "cylinders.head.customer",
  supplier: "cylinders.head.supplier",
};

export function CylinderLedger({ range }: { range: DateRange }) {
  const t = useT();
  const { data: cylinders = [], isLoading: l1 } = useQuery({ queryKey: ["cylinders"], queryFn: cylinderService.list });
  const { data: movements = [], isLoading: l2 } = useQuery({ queryKey: ["cylinderMovements"], queryFn: cylinderService.listMovements });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: productService.list });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: customerService.list });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: supplierService.list });

  const heads = useMemo(
    () => buildCylinderLedger({ cylinders, movements, products, customers, suppliers, range }),
    [cylinders, movements, products, customers, suppliers, range],
  );

  const grouped = useMemo(() => {
    const map = new Map<CylinderHeadKind, CylinderHeadReport[]>();
    for (const k of KIND_ORDER) map.set(k, []);
    for (const h of heads) map.get(h.kind)?.push(h);
    return KIND_ORDER.filter((k) => (map.get(k)?.length ?? 0) > 0).map((k) => ({ kind: k, items: map.get(k)! }));
  }, [heads]);

  if (l1 || l2) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (heads.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("cylinders.ledgerEmpty")}</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">{t("cylinders.ledgerHint")}</p>
      {grouped.map((g) => (
        <div key={g.kind} className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t(KIND_LABEL[g.kind])}
          </h3>
          {g.items.map((head) => (
            <section key={head.id} className="overflow-hidden rounded-xl border">
              <div className="grid grid-cols-2 gap-3 border-b bg-muted/40 p-3 sm:grid-cols-4 sm:items-center">
                <div className="col-span-2 sm:col-span-1">
                  <p className="font-semibold">
                    {head.kind === "customer" && head.id.startsWith("c:") ? (
                      <PartyNameLink kind="customer" id={head.id.slice(2)} name={head.name} />
                    ) : head.kind === "supplier" && head.id.startsWith("s:") ? (
                      <PartyNameLink kind="supplier" id={head.id.slice(2)} name={head.name} />
                    ) : (
                      head.name
                    )}
                  </p>
                  <Badge variant="secondary" className="mt-1 text-[10px]">{t(KIND_LABEL[head.kind])}</Badge>
                </div>
                <Stat label={t("cylinders.delivered")} value={String(head.delivered)} />
                <Stat label={t("cylinders.received")} value={String(head.received)} />
                <Stat label={t("inventory.balance")} value={String(head.balance)} emphasize />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-card text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t("common.date")}</th>
                      <th className="px-3 py-2 font-medium">{t("common.product")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("cylinders.delivered")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("cylinders.received")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("inventory.balance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {head.lines.map((line) => (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(line.date)}</td>
                        <td className="px-3 py-2">
                          {line.productName === "Opening" ? t("statement.opening") : line.productName}
                          {line.serial && (
                            <span className="ml-2 font-mono text-[10px] text-muted-foreground">{line.serial}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{line.delivered || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{line.received || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{line.balance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={emphasize ? "font-display text-sm font-semibold" : "text-sm font-medium"}>{value}</p>
    </div>
  );
}
