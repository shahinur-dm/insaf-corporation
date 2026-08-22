import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Cylinder, Package, RefreshCw, ShoppingCart, Truck, Warehouse } from "lucide-react";
import { productService } from "@/services/product.service";
import { inventoryService } from "@/services/inventory.service";
import { cylinderService } from "@/services/cylinder.service";
import { salesService } from "@/services/sales.service";
import { deliveryService } from "@/services/delivery.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { StatCard } from "@/components/dashboard/widgets/StatCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/utils/formatters";
import { buildProductInventory, sumInventory, type ProductInventoryRow } from "@/lib/cylinder-inventory";
import type { StockMovement } from "@/types";
import { useT, type MessageKey } from "@/i18n";

type ActivityRow = StockMovement & {
  txn: string;
  fullIn: number;
  fullOut: number;
  emptyIn: number;
  refill: number;
  party: string;
};

function activityFromMovement(m: StockMovement): ActivityRow {
  const isRefill = m.refType === "refill" || /refill/i.test(m.notes || "");
  const isEmpty = /empty/i.test(m.notes || "");
  const txn = isRefill
    ? "refill"
    : isEmpty
      ? "empty_return"
      : m.refType === "purchase"
        ? "purchase"
        : m.refType === "sales"
          ? "sales"
          : m.refType === "delivery"
            ? "delivery"
            : "adjustment";
  const qty = Number(m.quantity) || 0;
  const inbound = m.type === "in" || m.type === "return";
  return {
    ...m,
    txn,
    fullIn: inbound && !isEmpty && !isRefill ? qty : 0,
    fullOut: m.type === "out" ? qty : 0,
    emptyIn: inbound && isEmpty ? qty : 0,
    refill: isRefill ? qty : 0,
    party: m.notes?.split("·")[0] || "—",
  };
}

export function InventoryPage() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: productService.list });
  const { data: movements = [] } = useQuery({ queryKey: ["stockMovements"], queryFn: inventoryService.listMovements });
  const { data: cylinders = [] } = useQuery({ queryKey: ["cylinders"], queryFn: cylinderService.list });
  const { data: sales = [] } = useQuery({ queryKey: ["sales"], queryFn: salesService.list });
  const { data: deliveries = [] } = useQuery({ queryKey: ["deliveries"], queryFn: deliveryService.list });

  const rows = useMemo(
    () => buildProductInventory(products, cylinders, sales, deliveries, movements),
    [products, cylinders, sales, deliveries, movements],
  );
  const totals = useMemo(() => sumInventory(rows), [rows]);
  const activity = useMemo(
    () => movements.map(activityFromMovement).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 40),
    [movements],
  );

  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [type, setType] = useState<"in" | "out" | "adjust" | "refill">("in");
  const [notes, setNotes] = useState("");
  const [focus, setFocus] = useState<"all" | "full" | "empty" | "refill" | "reserved" | "available">("all");

  const filteredRows = useMemo(() => {
    if (focus === "empty") return rows.filter((r) => r.empty > 0);
    if (focus === "refill") return rows.filter((r) => r.refillPending > 0);
    if (focus === "reserved") return rows.filter((r) => r.reserved > 0);
    if (focus === "available") return rows.filter((r) => r.available > 0);
    if (focus === "full") return rows.filter((r) => r.full > 0);
    return rows;
  }, [rows, focus]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stockMovements"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["cylinders"] });
  };

  const adjust = useMutation({
    mutationFn: async () => {
      if (type === "refill") return inventoryService.completeRefill(productId, Number(qty), notes || "Warehouse");
      return inventoryService.adjust(productId, Number(qty), type, notes);
    },
    onSuccess: () => {
      invalidate();
      toast.success(type === "refill" ? t("inventory.refilled") : t("inventory.updated"));
      setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusBadge = (s: ProductInventoryRow["status"]) => {
    if (s === "out") return <Badge variant="destructive">{t("inventory.status.out")}</Badge>;
    if (s === "low") return <Badge variant="outline" className="border-amber-500 text-amber-700">{t("inventory.status.low")}</Badge>;
    return <Badge variant="secondary">{t("inventory.status.normal")}</Badge>;
  };

  const openActivity = (row: ActivityRow) => {
    if (row.refType === "sales" && row.refId) navigate({ to: "/sales/$id", params: { id: row.refId } });
    else if (row.refType === "delivery" && row.refId) navigate({ to: "/deliveries/$id", params: { id: row.refId } });
    else if (row.refType === "purchase" && row.refId) navigate({ to: "/purchases/$id", params: { id: row.refId } });
    else setFocus("all");
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t("inventory.title")} description={t("inventory.desc")} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <button type="button" className="text-left" onClick={() => setFocus("all")}>
          <StatCard title={t("inventory.totalCyl")} value={String(totals.total)} icon={Warehouse} />
        </button>
        <button type="button" className="text-left" onClick={() => setFocus("full")}>
          <StatCard title={t("inventory.fullAvail")} value={String(totals.full)} icon={Cylinder} tone="positive" />
        </button>
        <button type="button" className="text-left" onClick={() => setFocus("empty")}>
          <StatCard title={t("inventory.emptyCyl")} value={String(totals.empty)} icon={Package} tone="info" />
        </button>
        <button type="button" className="text-left" onClick={() => setFocus("refill")}>
          <StatCard title={t("inventory.refillPending")} value={String(totals.refillPending)} icon={RefreshCw} tone="warning" />
        </button>
        <button type="button" className="text-left" onClick={() => setFocus("reserved")}>
          <StatCard title={t("inventory.reserved")} value={String(totals.reserved)} icon={Truck} />
        </button>
        <button type="button" className="text-left" onClick={() => setFocus("available")}>
          <StatCard title={t("inventory.available")} value={String(totals.available)} icon={ShoppingCart} tone="positive" />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="space-y-3 pt-6">
            <h3 className="font-semibold">{t("inventory.adjust")}</h3>
            <div className="space-y-1.5">
              <Label>{t("common.product")}</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder={t("common.select")} /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("common.type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">{t("inventory.stockIn")}</SelectItem>
                  <SelectItem value="out">{t("inventory.stockOut")}</SelectItem>
                  <SelectItem value="adjust">{t("inventory.setAbsolute")}</SelectItem>
                  <SelectItem value="refill">{t("inventory.refillComplete")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("common.quantity")}</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{type === "refill" ? t("inventory.receivedBy") : t("common.notes")}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button className="w-full" disabled={!productId || adjust.isPending} onClick={() => adjust.mutate()}>
              {t("inventory.apply")}
            </Button>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <DataTable<ProductInventoryRow>
            rows={filteredRows}
            searchKeys={["name", "category"]}
            columns={[
              { key: "sl", header: t("inventory.sl"), render: (r) => String(r.sl).padStart(2, "0"), className: "w-12" },
              {
                key: "name",
                header: t("inventory.productCyl"),
                sortable: true,
                sortValue: (r) => r.name,
                render: (r) => (
                  <div>
                    <p className="font-medium">{r.name}</p>
                    {r.category && <p className="text-xs text-muted-foreground">{r.category}</p>}
                  </div>
                ),
              },
              { key: "total", header: t("inventory.totalCyl"), sortable: true, sortValue: (r) => r.total, render: (r) => r.total, className: "text-right tabular-nums" },
              {
                key: "full",
                header: t("inventory.fullAvail"),
                sortable: true,
                sortValue: (r) => r.full,
                render: (r) => <span className="font-semibold text-emerald-700 dark:text-emerald-400">{r.full}</span>,
                className: "text-right tabular-nums",
              },
              { key: "res", header: t("inventory.reserved"), sortable: true, sortValue: (r) => r.reserved, render: (r) => r.reserved, className: "text-right tabular-nums" },
              { key: "del", header: t("inventory.delivered"), sortable: true, sortValue: (r) => r.delivered, render: (r) => r.delivered, className: "text-right tabular-nums" },
              {
                key: "empty",
                header: t("inventory.emptyCyl"),
                sortable: true,
                sortValue: (r) => r.empty,
                render: (r) => <span className="text-sky-700 dark:text-sky-400">{r.empty}</span>,
                className: "text-right tabular-nums",
              },
              {
                key: "refill",
                header: t("inventory.refillPending"),
                sortable: true,
                sortValue: (r) => r.refillPending,
                render: (r) => (
                  <span className={r.refillPending > 0 ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{r.refillPending}</span>
                ),
                className: "text-right tabular-nums",
              },
              {
                key: "avail",
                header: t("inventory.available"),
                sortable: true,
                sortValue: (r) => r.available,
                render: (r) => <span className="text-base font-semibold">{r.available}</span>,
                className: "text-right tabular-nums",
              },
              { key: "st", header: t("common.status"), render: (r) => statusBadge(r.status) },
            ]}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("inventory.recent")}</h3>
        <DataTable<ActivityRow>
          rows={activity}
          searchKeys={["productName", "notes", "by"]}
          dateKey="date"
          onRowClick={openActivity}
          columns={[
            { key: "date", header: t("inventory.when"), sortable: true, sortValue: (r) => r.date, render: (r) => formatDateTime(r.date) },
            { key: "ref", header: t("inventory.ref"), render: (r) => <span className="font-mono text-xs">{r.refId || r.id}</span> },
            {
              key: "txn",
              header: t("inventory.txn"),
              render: (r) => <Badge variant="outline">{t(`inventory.txn.${r.txn}` as MessageKey)}</Badge>,
            },
            { key: "product", header: t("common.product"), sortable: true, sortValue: (r) => r.productName, render: (r) => r.productName },
            { key: "fin", header: t("inventory.fullIn"), render: (r) => r.fullIn || "—", className: "text-right tabular-nums" },
            { key: "fout", header: t("inventory.fullOut"), render: (r) => r.fullOut || "—", className: "text-right tabular-nums" },
            { key: "ein", header: t("inventory.emptyIn"), render: (r) => r.emptyIn || "—", className: "text-right tabular-nums" },
            { key: "refill", header: t("inventory.refill"), render: (r) => r.refill || "—", className: "text-right tabular-nums" },
            { key: "by", header: t("inventory.receivedBy"), render: (r) => r.by || "—" },
            { key: "st", header: t("common.status"), render: (r) => <Badge variant="secondary">{r.type}</Badge> },
          ]}
        />
      </div>
    </div>
  );
}
