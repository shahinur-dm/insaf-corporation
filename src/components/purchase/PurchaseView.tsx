import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { purchaseService } from "@/services/purchase.service";
import { productService } from "@/services/product.service";
import { cylinderService } from "@/services/cylinder.service";
import { isCylinderProduct } from "@/lib/cylinder-product";
import { ReceiveCylinderDialog } from "@/components/purchase/ReceiveCylinderDialog";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/common/PageHeader";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import type { PaymentMethod } from "@/types";
import { useT } from "@/i18n";
import { Printer, Trash2 } from "lucide-react";

export function PurchaseView({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: po, isLoading, isFetched } = useQuery({
    queryKey: ["purchases", id],
    queryFn: () => purchaseService.get(id),
  });
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("bank");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: productService.list });
  const { data: cylinders = [] } = useQuery({ queryKey: ["cylinders"], queryFn: cylinderService.list });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["purchases", id] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stockMovements"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["cylinders"] });
    qc.invalidateQueries({ queryKey: ["cylinderMovements"] });
    qc.invalidateQueries({ queryKey: ["ledger"] });
  };

  const receive = useMutation({
    mutationFn: (serialsByItem?: string[][]) => purchaseService.receive(id, serialsByItem ? { serialsByItem } : undefined),
    onSuccess: () => { setReceiveOpen(false); invalidate(); toast.success(t("purchases.received")); },
    onError: (e: Error) => toast.error(e.message),
  });

  const pay = useMutation({
    mutationFn: (n: number) => purchaseService.recordPayment(id, n, method),
    onSuccess: () => { invalidate(); toast.success(t("purchases.paymentRecorded")); setAmount(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: () => purchaseService.setStatus(id, "cancelled"),
    onSuccess: () => { invalidate(); toast.success(t("purchases.cancelled")); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => purchaseService.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success(t("purchases.deleted"));
      navigate({ to: "/purchases" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !po) return <div className="p-6 text-sm text-destructive">{t("purchases.notFound")}</div>;
  if (!po) return null;

  const due = po.total - po.paid;
  const busy = receive.isPending || pay.isPending || cancel.isPending || remove.isPending;
  const canDelete = po.status === "draft" || po.status === "cancelled";
  const needsCylinders = po.items.some((it) => isCylinderProduct(products.find((p) => p.id === it.productId)));
  const startReceive = () => {
    if (needsCylinders) setReceiveOpen(true);
    else receive.mutate(undefined);
  };
  const serialsOf = (ids?: string[]) =>
    (ids || []).map((cid) => cylinders.find((c) => c.id === cid)?.serialNumber || cid).join(", ") || "—";

  return (
    <div>
      <PageHeader
        title={`${t("purchases.title")} ${po.orderNo}`}
        description={`${po.supplierName} · ${formatDate(po.date)}`}
        backTo="/purchases"
        backLabel={t("purchases.title")}
        actions={
          <div className="flex items-center gap-2">
            {(po.status === "draft" || po.status === "ordered") && (
              <Button variant="outline" asChild>
                <Link to="/purchases/$id/edit" params={{ id: po.id }}>{t("common.edit")}</Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/suppliers/$id/statement" params={{ id: po.supplierId }}>{t("suppliers.statement")}</Link>
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" />
              {t("common.print")}
            </Button>
            {canDelete && (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  if (confirm(t("purchases.deleteConfirm"))) remove.mutate();
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {t("common.delete")}
              </Button>
            )}
            <Badge>{t(`status.${po.status}` as any)}</Badge>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="print-sheet lg:col-span-2"><CardContent className="space-y-4 pt-6">
          <PrintDocHeader
            title={t("purchases.title")}
            subtitle={`${po.orderNo}${po.grnNo ? ` · GRN ${po.grnNo}` : ""} · ${formatDate(po.date)}`}
            right={<Badge className="no-print">{t(`status.${po.status}` as any)}</Badge>}
          />
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("common.supplier")}</p>
              <p className="font-medium">
                <PartyNameLink kind="supplier" id={po.supplierId} name={po.supplierName} />
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("purchases.poNo")}</p>
              <p className="font-mono">{po.orderNo}</p>
              {po.grnNo && <p className="mt-1 font-mono text-xs text-muted-foreground">GRN: {po.grnNo}</p>}
            </div>
          </div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("sales.item")}</TableHead>
              <TableHead>{t("cylinders.serial")}</TableHead>
              <TableHead className="text-right">{t("common.quantity")}</TableHead>
              <TableHead className="text-right">{t("purchases.cost")}</TableHead><TableHead className="text-right">{t("common.total")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {po.items.map((it, i) => (
                <TableRow key={i}>
                  <TableCell>{it.productName}</TableCell>
                  <TableCell className="font-mono text-xs">{serialsOf(it.cylinderIds)}</TableCell>
                  <TableCell className="text-right">{it.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(it.price)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(it.price * it.quantity * (1 + it.taxRate / 100))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end text-sm">
            <div className="w-56 space-y-1">
              <div className="flex justify-between"><span>{t("common.subtotal")}</span><span>{formatCurrency(po.subtotal)}</span></div>
              <div className="flex justify-between"><span>{t("common.tax")}</span><span>{formatCurrency(po.tax)}</span></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><span>{t("common.total")}</span><span>{formatCurrency(po.total)}</span></div>
              <div className="flex justify-between"><span>{t("common.paid")}</span><span>{formatCurrency(po.paid)}</span></div>
              <div className="flex justify-between font-semibold"><span>{t("common.due")}</span><span>{formatCurrency(due)}</span></div>
            </div>
          </div>
        </CardContent></Card>

        <div className="space-y-4 no-print">
          <Card><CardContent className="pt-6 space-y-3">
            <h3 className="font-semibold">{t("sales.workflow")}</h3>
            {(po.status === "ordered" || po.status === "draft") && (
              <Button className="w-full" disabled={busy} onClick={startReceive}>{t("purchases.receive")}</Button>
            )}
            {(po.status === "ordered" || po.status === "draft") && (
              <Button className="w-full" variant="destructive" disabled={busy} onClick={() => cancel.mutate()}>{t("purchases.cancel")}</Button>
            )}
            <p className="text-xs text-muted-foreground">{t("purchases.receiveHint")}</p>
          </CardContent></Card>

          <Card><CardContent className="pt-6 space-y-3">
            <h3 className="font-semibold">{t("purchases.supplierPayment")}</h3>
            <div className="space-y-1.5">
              <Label>{t("common.amount")}</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={due <= 0 || po.status === "cancelled"} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("purchases.paidFrom")}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)} disabled={due <= 0}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t("common.cash")}</SelectItem>
                  <SelectItem value="bank">{t("common.bank")}</SelectItem>
                  <SelectItem value="cheque">{t("common.cheque")}</SelectItem>
                  <SelectItem value="mobile">{t("common.mobileBanking")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={!amount || Number(amount) <= 0 || due <= 0 || pay.isPending || po.status === "cancelled"}
              onClick={() => pay.mutate(Number(amount))}
            >
              {due <= 0 ? t("sales.fullyPaid") : t("sales.recordPayment")}
            </Button>
          </CardContent></Card>
        </div>
      </div>
      <ReceiveCylinderDialog
        po={po}
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        pending={receive.isPending}
        onReceive={(serialsByItem) => receive.mutate(serialsByItem)}
      />
    </div>
  );
}
