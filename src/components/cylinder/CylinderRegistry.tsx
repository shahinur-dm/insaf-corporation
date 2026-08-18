import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Printer } from "lucide-react";
import { toast } from "sonner";
import { cylinderService } from "@/services/cylinder.service";
import { productService } from "@/services/product.service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { CylinderLedger } from "@/components/cylinder/CylinderLedger";
import { Card, CardContent } from "@/components/ui/card";
import { cylinderStatusCounts } from "@/lib/cylinder-product";
import { formatDateTime } from "@/utils/formatters";
import type { Cylinder, CylinderStatus } from "@/types";
import { EMPTY_DATE_RANGE, type DateRange } from "@/lib/date-range";
import { useT } from "@/i18n";

const statusVariant: Record<CylinderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  in_stock: "default", at_customer: "secondary", in_transit: "outline",
  refilling: "outline", damaged: "destructive", lost: "destructive",
};

export function CylinderRegistry() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"registry" | "tracking">("tracking");
  const [range, setRange] = useState<DateRange>(EMPTY_DATE_RANGE);
  const { data = [] } = useQuery({ queryKey: ["cylinders"], queryFn: cylinderService.list });
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: productService.list });
  const counts = cylinderStatusCounts(data);
  const gasCategoryOf = (c: Cylinder) =>
    c.gasCategory || products.find((p) => p.id === c.productId)?.category || "—";

  const remove = useMutation({
    mutationFn: (id: string) => cylinderService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      toast.success(t("cylinders.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title={t("cylinders.title")}
        description={t("cylinders.desc")}
        actions={
          <div className="flex flex-wrap gap-2">
            {tab === "tracking" && (
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="mr-1 h-4 w-4" />
                {t("common.print")}
              </Button>
            )}
            <Button asChild>
              <Link to="/cylinders/new"><Plus className="mr-1 h-4 w-4" /> {t("cylinders.new")}</Link>
            </Button>
          </div>
        }
      />
        <div className="no-print mb-4 flex flex-wrap gap-2">
          <Button size="sm" variant={tab === "tracking" ? "default" : "outline"} onClick={() => setTab("tracking")}>
            {t("cylinders.trackingTab")}
          </Button>
          <Button size="sm" variant={tab === "registry" ? "default" : "outline"} onClick={() => setTab("registry")}>
            {t("cylinders.registryTab")}
          </Button>
        </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ["cylinders.total", counts.total],
          ["cylinders.filled", counts.filled],
          ["cylinders.empty", counts.empty],
          ["cylinders.refillPending", counts.refillPending],
        ] as const).map(([key, value]) => (
          <Card key={key}>
            <CardContent className="pt-4 pb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t(key)}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {tab === "tracking" && (
        <div className="space-y-4">
          <div className="no-print rounded-xl border bg-card/60 p-3">
            <DateRangeFilter value={range} onChange={setRange} />
          </div>
          <div className="print-sheet">
            <PrintDocHeader title={t("reports.cylinder")} className="mb-4 !hidden print:!flex" />
            <CylinderLedger range={range} />
          </div>
        </div>
      )}
      {tab === "registry" && (
      <DataTable<Cylinder>
        rows={data}
        searchKeys={["serialNumber", "location"]}
        dateKey="lastMovementAt"
        onRowClick={(r) => navigate({ to: "/cylinders/$id", params: { id: r.id } })}
        columns={[
          { key: "sn", header: t("cylinders.serial"), sortable: true, sortValue: (r) => r.serialNumber, render: (r) => <span className="font-mono">{r.serialNumber}</span> },
          { key: "cat", header: t("cylinders.gasCategory"), sortable: true, sortValue: (r) => gasCategoryOf(r), render: (r) => gasCategoryOf(r) },
          { key: "cap", header: t("cylinders.capacity"), sortable: true, sortValue: (r) => r.capacity, render: (r) => `${r.capacity}` },
          { key: "st", header: t("common.status"), sortable: true, sortValue: (r) => r.status, render: (r) => <Badge variant={statusVariant[r.status]}>{t(`status.${r.status}` as any)}</Badge> },
          { key: "loc", header: t("cylinders.location"), sortable: true, sortValue: (r) => r.location, render: (r) => r.location },
          { key: "mv", header: t("cylinders.lastMovement"), sortable: true, sortValue: (r) => r.lastMovementAt, render: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.lastMovementAt)}</span> },
          {
            key: "actions",
            header: t("common.actions"),
            className: actionsColumnClass,
            render: (r) => (
              <RowActions
                onView={() => navigate({ to: "/cylinders/$id", params: { id: r.id } })}
                onEdit={() => navigate({ to: "/cylinders/$id/edit", params: { id: r.id } })}
                onDelete={() => {
                  if (confirm(t("cylinders.deleteConfirm"))) remove.mutate(r.id);
                }}
                deleteDisabled={remove.isPending}
              />
            ),
          },
        ]}
      />
      )}
    </div>
  );
}
