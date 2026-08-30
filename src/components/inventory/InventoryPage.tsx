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
import { supplierService } from "@/services/supplier.service";
import { customerService } from "@/services/customer.service";
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
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: supplierService.list });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: customerService.list });

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
  const [type, setType] = useState<
    "in" | "out" | "adjust" | "refill" | "send_supplier" | "receive_supplier"
    | "return_empty" | "loan" | "mark_lost" | "mark_damaged" | "repair" | "scrap" | "writeoff" | "sell_cylinder"
  >("in");
  const [notes, setNotes] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [partyKind, setPartyKind] = useState<"customer" | "supplier">("customer");
  const [sendDate, setSendDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedReturn, setExpectedReturn] = useState("");
  const [condition, setCondition] = useState<"full" | "empty" | "damaged">("full");
  const [reason, setReason] = useState("");
  const [penalty, setPenalty] = useState("0");
  const [treatment, setTreatment] = useState<"charge" | "writeoff" | "none">("none");
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
    qc.invalidateQueries({ queryKey: ["cylinderMovements"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  };

  const adjust = useMutation({
    mutationFn: async () => {
      if (type === "refill") return inventoryService.completeRefill(productId, Number(qty), notes || "Warehouse");
      if (type === "send_supplier") {
        return inventoryService.sendToSupplier({
          supplierId, productId, quantity: Number(qty), date: sendDate, expectedReturnDate: expectedReturn || undefined, notes,
        });
      }
      if (type === "receive_supplier") {
        return inventoryService.receiveFromSupplier({
          supplierId, productId, quantity: Number(qty), condition, notes,
        });
      }
      if (type === "return_empty") return inventoryService.returnEmpty({ customerId, productId, quantity: Number(qty), notes });
      if (type === "loan") {
        return inventoryService.loanToCustomer({
          customerId, productId, quantity: Number(qty), issueDate: sendDate, expectedReturnDate: expectedReturn || undefined, notes,
        });
      }
      if (type === "mark_lost") {
        return inventoryService.markLost({
          partyKind,
          partyId: partyKind === "customer" ? customerId : supplierId,
          productId,
          quantity: Number(qty),
          lostDate: sendDate,
          reason,
          penaltyAmount: Number(penalty) || 0,
          accountingTreatment: treatment,
        });
      }
      if (type === "mark_damaged") return inventoryService.markDamaged(productId, Number(qty), notes);
      if (type === "repair" || type === "scrap" || type === "writeoff") {
        return inventoryService.resolveDamage(productId, Number(qty), type, notes);
      }
      if (type === "sell_cylinder") return inventoryService.sellCylinders({ customerId, productId, quantity: Number(qty), notes });
      return inventoryService.adjust(productId, Number(qty), type, notes);
    },
    onSuccess: () => {
      invalidate();
      toast.success(
        type === "refill" ? t("inventory.refilled")
          : type === "send_supplier" ? t("inventory.sentSupplier")
            : type === "receive_supplier" ? t("inventory.receivedSupplier")
              : t("inventory.updated"),
      );
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
              <Select value={productId || undefined} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder={t("common.select")} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {products.filter((p) => p.id).map((p) => {
                    const row = rows.find((r) => r.productId === p.id);
                    const current = row?.full ?? p.stock ?? 0;
                    return (
                      <SelectItem key={p.id} value={p.id}>{p.name} · {current}</SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {productId && (
                <p className="text-xs text-muted-foreground">
                  {t("inventory.fullAvail")}: {rows.find((r) => r.productId === productId)?.full ?? products.find((p) => p.id === productId)?.stock ?? 0}
                </p>
              )}
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
                  <SelectItem value="send_supplier">{t("inventory.sendSupplier")}</SelectItem>
                  <SelectItem value="receive_supplier">{t("inventory.receiveSupplier")}</SelectItem>
                  <SelectItem value="return_empty">{t("inventory.returnEmpty")}</SelectItem>
                  <SelectItem value="loan">{t("inventory.loan")}</SelectItem>
                  <SelectItem value="sell_cylinder">{t("inventory.sellCylinder")}</SelectItem>
                  <SelectItem value="mark_lost">{t("inventory.markLost")}</SelectItem>
                  <SelectItem value="mark_damaged">{t("inventory.markDamaged")}</SelectItem>
                  <SelectItem value="repair">{t("inventory.repair")}</SelectItem>
                  <SelectItem value="scrap">{t("inventory.scrap")}</SelectItem>
                  <SelectItem value="writeoff">{t("inventory.writeoff")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(type === "send_supplier" || type === "receive_supplier" || (type === "mark_lost" && partyKind === "supplier")) && (
              <div className="space-y-1.5">
                <Label>{t("common.supplier")}</Label>
                <Select value={supplierId || undefined} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder={t("common.select")} /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {type === "mark_lost" && (
              <div className="space-y-1.5">
                <Label>{t("inventory.partyKind")}</Label>
                <Select value={partyKind} onValueChange={(v) => setPartyKind(v as typeof partyKind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">{t("common.customer")}</SelectItem>
                    <SelectItem value="supplier">{t("common.supplier")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {(type === "return_empty" || type === "loan" || type === "sell_cylinder" || (type === "mark_lost" && partyKind === "customer")) && (
              <div className="space-y-1.5">
                <Label>{t("common.customer")}</Label>
                <Select value={customerId || undefined} onValueChange={setCustomerId}>
                  <SelectTrigger><SelectValue placeholder={t("common.select")} /></SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(type === "send_supplier" || type === "loan" || type === "mark_lost") && (
              <>
                <div className="space-y-1.5">
                  <Label>{t("common.date")}</Label>
                  <Input type="date" value={sendDate} onChange={(e) => setSendDate(e.target.value)} />
                </div>
                {(type === "send_supplier" || type === "loan") && (
                  <div className="space-y-1.5">
                    <Label>{t("inventory.expectedReturn")}</Label>
                    <Input type="date" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
                  </div>
                )}
              </>
            )}
            {type === "mark_lost" && (
              <>
                <div className="space-y-1.5">
                  <Label>{t("inventory.reason")}</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("inventory.penalty")}</Label>
                  <Input type="number" min={0} value={penalty} onChange={(e) => setPenalty(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("inventory.accounting")}</Label>
                  <Select value={treatment} onValueChange={(v) => setTreatment(v as typeof treatment)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("inventory.acct.none")}</SelectItem>
                      <SelectItem value="charge">{t("inventory.acct.charge")}</SelectItem>
                      <SelectItem value="writeoff">{t("inventory.acct.writeoff")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {type === "receive_supplier" && (
              <div className="space-y-1.5">
                <Label>{t("inventory.condition")}</Label>
                <Select value={condition} onValueChange={(v) => setCondition(v as typeof condition)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">{t("inventory.condition.full")}</SelectItem>
                    <SelectItem value="empty">{t("inventory.condition.empty")}</SelectItem>
                    <SelectItem value="damaged">{t("inventory.condition.damaged")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("common.quantity")}</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{type === "refill" ? t("inventory.receivedBy") : t("common.notes")}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button className="w-full" disabled={!productId || adjust.isPending || Number(qty) < 0 || ((type === "send_supplier" || type === "receive_supplier" || (type === "mark_lost" && partyKind === "supplier")) && !supplierId) || ((type === "return_empty" || type === "loan" || type === "sell_cylinder" || (type === "mark_lost" && partyKind === "customer")) && !customerId)} onClick={() => { if (adjust.isPending) return; adjust.mutate(); }}>
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
              { key: "withCust", header: t("inventory.withCustomer"), sortable: true, sortValue: (r) => r.withCustomer, render: (r) => r.withCustomer, className: "text-right tabular-nums" },
              { key: "withSupp", header: t("inventory.withSupplier"), sortable: true, sortValue: (r) => r.withSupplier, render: (r) => r.withSupplier, className: "text-right tabular-nums" },
              { key: "dmg", header: t("inventory.damaged"), sortable: true, sortValue: (r) => r.damaged, render: (r) => r.damaged, className: "text-right tabular-nums" },
              { key: "lost", header: t("inventory.lost"), sortable: true, sortValue: (r) => r.lost, render: (r) => r.lost, className: "text-right tabular-nums" },
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
