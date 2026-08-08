import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { deliveryService } from "@/services/delivery.service";
import { productService } from "@/services/product.service";
import { cylinderService } from "@/services/cylinder.service";
import { isCylinderProduct } from "@/lib/cylinder-product";
import { DeliveryCylinderDialog } from "@/components/delivery/DeliveryCylinderDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { BrandLogo } from "@/components/common/BrandLogo";
import { formatDateTime } from "@/utils/formatters";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useT } from "@/i18n";

export function DeliveryChallan({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const { data: d, isLoading, isFetched } = useQuery({
    queryKey: ["deliveries", id],
    queryFn: () => deliveryService.get(id),
  });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: productService.list });
  const { data: cylinders = [] } = useQuery({ queryKey: ["cylinders"], queryFn: cylinderService.list });
  const confirm = useMutation({
    mutationFn: (payload?: { issuedIdsByItem?: string[][]; returnedIds?: string[] }) =>
      deliveryService.confirm(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      qc.invalidateQueries({ queryKey: ["deliveries", id] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      qc.invalidateQueries({ queryKey: ["cylinderMovements"] });
      setAssignOpen(false);
      toast.success(t("deliveries.confirm"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const needsCylinders = (d?.items || []).some((it) =>
    isCylinderProduct(products.find((p) => p.id === it.productId)),
  );
  const canConfirm = d && (d.status === "pending" || d.status === "in_transit");
  const startConfirm = () => {
    if (needsCylinders) setAssignOpen(true);
    else confirm.mutate(undefined);
  };
  const serialsOf = (ids?: string[]) =>
    (ids || []).map((cid) => cylinders.find((c) => c.id === cid)?.serialNumber || cid).join(", ") || "—";

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !d) return <div className="p-6 text-sm text-destructive">{t("deliveries.notFound")}</div>;
  if (!d) return null;

  return (
    <div>
      <PageHeader
        title={`${t("deliveries.challanNo")} ${d.challanNo}`}
        description={`${t("common.customer")}: ${d.customerName}`}
        backTo="/deliveries"
        backLabel={t("deliveries.title")}
        actions={
          <div className="flex items-center gap-2">
            {d.status === "pending" && (
              <Button variant="outline" asChild>
                <Link to="/deliveries/$id/edit" params={{ id: d.id }}>{t("common.edit")}</Link>
              </Button>
            )}
            {canConfirm && (
              <Button disabled={confirm.isPending} onClick={startConfirm}>{t("deliveries.confirm")}</Button>
            )}
            <Badge>{t(`status.${d.status}` as any)}</Badge>
          </div>
        }
      />
      <Card><CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-3 border-b pb-4">
          <BrandLogo size="md" />
          <div>
            <p className="font-display text-sm font-semibold">{t("brand.name")}</p>
            <p className="text-[11px] text-muted-foreground">{t("brand.tagline")}</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-4 text-sm">
          <Info label={t("deliveries.driver")} value={d.driverName} />
          <Info label={t("deliveries.vehicle")} value={d.vehicleNo} />
          <Info
            label={t("sales.orderNo")}
            value={d.salesOrderId ? (
              <Link className="font-medium text-primary underline-offset-2 hover:underline" to="/sales/$id" params={{ id: d.salesOrderId }}>
                {d.salesOrderId}
              </Link>
            ) : "—"}
          />
          <Info label={t("common.date")} value={d.confirmedAt ? formatDateTime(d.confirmedAt) : "—"} />
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("sales.item")}</TableHead>
            <TableHead>{t("cylinders.serial")}</TableHead>
            <TableHead className="text-right">{t("common.quantity")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {d.items.map((it, i) => (
              <TableRow key={i}>
                <TableCell>{it.productName}</TableCell>
                <TableCell className="font-mono text-xs">{serialsOf(it.cylinderIds)}</TableCell>
                <TableCell className="text-right">{it.quantity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-end">
          <Button onClick={startConfirm} disabled={!canConfirm || confirm.isPending}>
            {canConfirm ? t("deliveries.confirm") : t(`status.${d.status}` as any)}
          </Button>
        </div>
      </CardContent></Card>
      {d && (
        <DeliveryCylinderDialog
          delivery={d}
          open={assignOpen}
          onOpenChange={setAssignOpen}
          pending={confirm.isPending}
          onConfirm={(payload) => confirm.mutate(payload)}
        />
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <div className="font-medium">{value}</div>
    </div>
  );
}
