import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cylinderService } from "@/services/cylinder.service";
import { productService } from "@/services/product.service";
import { isCylinderProduct, parseSerials, suggestSerials } from "@/lib/cylinder-product";
import { getCylinderTrackingFn } from "@/lib/settings.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PurchaseOrder } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n";

export function ReceiveCylinderDialog({
  po,
  open,
  onOpenChange,
  onReceive,
  pending,
}: {
  po: PurchaseOrder;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onReceive: (payload: { serialsByItem?: string[][]; lotNumber?: string }) => void;
  pending?: boolean;
}) {
  const t = useT();
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: productService.list });
  const { data: cylinders = [] } = useQuery({ queryKey: ["cylinders"], queryFn: cylinderService.list });
  const { data: tracking = "serial" } = useQuery({ queryKey: ["cylinderTracking"], queryFn: () => getCylinderTrackingFn() });
  const [texts, setTexts] = useState<string[]>([]);
  const [lotNumber, setLotNumber] = useState("");

  const cylLines = useMemo(
    () => po.items.map((it, index) => ({ it, index, product: products.find((p) => p.id === it.productId) }))
      .filter((row) => isCylinderProduct(row.product)),
    [po.items, products],
  );

  useEffect(() => {
    if (!open) return;
    setTexts(po.items.map((it) => {
      const ids = it.cylinderIds || [];
      return cylinders.filter((c) => ids.includes(c.id)).map((c) => c.serialNumber).join("\n");
    }));
  }, [open, po, cylinders]);

  const ready = tracking === "lot"
    ? Boolean(lotNumber.trim())
    : cylLines.every(({ it, index }) => parseSerials(texts[index] || "").length === it.quantity);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("purchases.receiveCylinders")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {tracking === "lot" && (
            <div className="space-y-1.5">
              <Label>{t("inventory.lotNumber")}</Label>
              <Input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="LOT-2026-001" />
            </div>
          )}
          {tracking !== "lot" && cylLines.map(({ it, index, product }) => {
            const serials = parseSerials(texts[index] || "");
            return (
              <section key={index} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{it.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("deliveries.selectedCount", { selected: serials.length, qty: it.quantity })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const generated = suggestSerials(product?.code || it.productName, it.quantity);
                      setTexts((prev) => prev.map((row, i) => (i === index ? generated.join("\n") : row)));
                    }}
                  >
                    {t("purchases.generateSerials")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("purchases.serialHint", { qty: it.quantity })}</p>
                <Textarea
                  rows={Math.min(6, Math.max(3, it.quantity))}
                  value={texts[index] || ""}
                  onChange={(e) => setTexts((prev) => prev.map((row, i) => (i === index ? e.target.value : row)))}
                  placeholder="INS-001"
                />
              </section>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            disabled={!ready || pending}
            onClick={() => onReceive({
              serialsByItem: tracking === "serial" ? po.items.map((_, i) => parseSerials(texts[i] || "")) : undefined,
              lotNumber: lotNumber || undefined,
            })}
          >
            {t("purchases.receive")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
