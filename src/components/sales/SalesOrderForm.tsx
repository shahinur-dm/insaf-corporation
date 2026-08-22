import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { customerService } from "@/services/customer.service";
import { productService } from "@/services/product.service";
import { salesService } from "@/services/sales.service";
import { computeTotals, genOrderNo, lineAmount, paymentStatus } from "@/utils/helpers";
import { formatCurrency } from "@/utils/formatters";
import { salesOrderSchema } from "@/utils/validators";
import type { LineItem } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useT } from "@/i18n";
import { hrService } from "@/services/hr.service";
import { isDeliveryStaff } from "@/lib/hr-staff";
import { cylinderService } from "@/services/cylinder.service";
import { deliveryService } from "@/services/delivery.service";
import { inventoryService } from "@/services/inventory.service";
import { buildProductInventory } from "@/lib/cylinder-inventory";

export function SalesOrderForm({
  mode = "order",
  id,
}: {
  mode?: "order" | "quotation";
  id?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editing = Boolean(id);
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: customerService.list });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: productService.list });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: hrService.listEmployees });
  const deliveryStaff = employees.filter(isDeliveryStaff);
  const { data: existing, isLoading } = useQuery({
    queryKey: ["sales", id],
    queryFn: () => salesService.get(id!),
    enabled: editing,
  });

  const { data: cylinders = [] } = useQuery({ queryKey: ["cylinders"], queryFn: cylinderService.list });
  const { data: deliveries = [] } = useQuery({ queryKey: ["deliveries"], queryFn: deliveryService.list });
  const { data: sales = [] } = useQuery({ queryKey: ["sales"], queryFn: salesService.list });
  const { data: movements = [] } = useQuery({ queryKey: ["stockMovements"], queryFn: inventoryService.listMovements });
  const stockRows = buildProductInventory(products, cylinders, sales, deliveries, movements);

  const [customerId, setCustomerId] = useState<string>("");
  const [driverName, setDriverName] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [hydrated, setHydrated] = useState(!editing);

  useEffect(() => {
    if (!existing) return;
    setCustomerId(existing.customerId);
    setDriverName(existing.driverName ?? "");
    setReceiverName(existing.receiverName ?? "");
    setNotes(existing.notes ?? "");
    setItems(existing.items);
    setHydrated(true);
  }, [existing]);

  useEffect(() => {
    if (editing || items.length > 0 || !products[0]) return;
    const p = products[0];
    setItems([{ productId: p.id, productName: p.name, quantity: 1, price: p.price, taxRate: 0 }]);
  }, [editing, items.length, products]);

  const update = (idx: number, patch: Partial<LineItem>) => {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const totals = computeTotals(items);

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = salesOrderSchema.safeParse({
        customerId, notes, items, driverName: driverName || undefined, receiverName: receiverName || undefined,
      });
      if (!parsed.success) throw new Error(parsed.error.errors[0]?.message || "Invalid form");
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) throw new Error(t("common.select"));
      for (const it of items) {
        const row = stockRows.find((r) => r.productId === it.productId);
        if (row && it.quantity > row.available) {
          throw new Error(t("sales.stockWarn", { qty: row.available }));
        }
      }

      if (editing && existing) {
        if (existing.status === "cancelled") {
          throw new Error(t("sales.cannotEdit"));
        }
        const nextItems = items.map((it) => ({ ...it, taxRate: 0 }));
        return salesService.update(id!, {
          customerId,
          customerName: customer.name,
          items: nextItems,
          subtotal: totals.subtotal,
          tax: 0,
          total: totals.total,
          notes,
          driverName: driverName || undefined,
          receiverName: receiverName.trim() || undefined,
        });
      }

      return salesService.create({
        orderNo: genOrderNo(mode === "quotation" ? "QT" : "SO"),
        customerId, customerName: customer.name,
        date: new Date().toISOString(),
        items: items.map((it) => ({ ...it, taxRate: 0 })),
        subtotal: totals.subtotal, tax: 0, total: totals.total,
        paid: 0, status: mode === "quotation" ? "draft" : "confirmed", notes,
        driverName: driverName || undefined,
        receiverName: receiverName.trim() || undefined,
      });
    },
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["stockMovements"] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      toast.success(editing ? t("sales.updated") : mode === "quotation" ? t("sales.quotationSaved") : t("sales.created"));
      navigate({ to: "/sales/$id", params: { id: order.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing && isLoading) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (editing && !existing) return <div className="p-6 text-sm text-destructive">{t("sales.notFound")}</div>;
  if (editing && existing && existing.status === "cancelled") {
    return <div className="p-6 text-sm text-destructive">{t("sales.cannotEdit")}</div>;
  }
  if (!hydrated) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div>
      <PageHeader title={editing ? t("sales.edit") : mode === "quotation" ? t("sales.newQuotation") : t("sales.newOrder")} backTo={editing ? { to: "/sales/$id", params: { id: id! } } : "/sales"} />
      <Card><CardContent className="pt-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("common.customer")}</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder={t("common.select")} /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {customers.find((c) => c.id === customerId)?.phone && (
              <p className="text-xs text-muted-foreground">{customers.find((c) => c.id === customerId)?.phone} · {customers.find((c) => c.id === customerId)?.address}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{t("sales.receiver")}</Label>
            <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("deliveries.deliveryman")}</Label>
            {deliveryStaff.length > 0 ? (
              <Select value={driverName || "__none"} onValueChange={(v) => setDriverName(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder={t("common.select")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {deliveryStaff.map((e) => (
                    <SelectItem key={e.id} value={e.name}>{e.name} · {e.designation}</SelectItem>
                  ))}
                  {driverName && !deliveryStaff.some((e) => e.name === driverName) && (
                    <SelectItem value={driverName}>{driverName}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            ) : (
              <Input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder={t("common.select")} />
            )}
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>{t("common.notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("common.optionalNotes")} />
          </div>
        </div>

        <div>
          <div className="mb-2">
            <h3 className="text-sm font-semibold">{t("sales.item")}</h3>
          </div>
          <div className="overflow-hidden rounded-md border">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("common.product")}</TableHead><TableHead className="w-24 text-right">{t("common.quantity")}</TableHead>
                <TableHead className="w-32 text-right">{t("common.price")}</TableHead>
                <TableHead className="w-32 text-right">{t("common.lineTotal")}</TableHead><TableHead className="w-10" />
              </TableRow></TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">{t("common.noItems")}</TableCell></TableRow>
                )}
                {items.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Select value={it.productId} onValueChange={(v) => {
                        const p = products.find((x) => x.id === v);
                        if (p) update(idx, { productId: p.id, productName: p.name, price: p.price, taxRate: 0 });
                      }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="number" min={1} value={it.quantity} onChange={(e) => update(idx, { quantity: Number(e.target.value) })} className="text-right" />
                      {(() => {
                        const row = stockRows.find((r) => r.productId === it.productId);
                        if (row && it.quantity > row.available) {
                          return <p className="mt-1 text-[10px] text-destructive">{t("sales.stockWarn", { qty: row.available })}</p>;
                        }
                        return null;
                      })()}
                    </TableCell>
                    <TableCell><Input type="number" step="0.01" value={it.price} onChange={(e) => update(idx, { price: Number(e.target.value) })} className="text-right" /></TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(lineAmount(it))}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span>{t("common.subtotal")}</span><span>{formatCurrency(totals.subtotal)}</span></div>
            <div className="flex justify-between border-t pt-1 text-base font-semibold">
              <span>{t("common.total")}</span><span>{formatCurrency(totals.total)}</span>
            </div>
            {editing && existing && (
              <>
                <div className="flex justify-between"><span>{t("common.paid")}</span><span>{formatCurrency(existing.paid)}</span></div>
                <div className="flex justify-between font-semibold">
                  <span>{t("common.due")}</span>
                  <span>{formatCurrency(Math.max(0, totals.total - existing.paid))}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("sales.paymentStatus")}</span>
                  <span>{t(`sales.${paymentStatus(totals.total, existing.paid)}`)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate({ to: editing ? "/sales/$id" : "/sales", params: editing ? { id: id! } : undefined })}>{t("common.cancel")}</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {editing ? t("common.save") : mode === "quotation" ? t("sales.quotation") : t("sales.new")}
          </Button>
        </div>
      </CardContent></Card>
    </div>
  );
}
