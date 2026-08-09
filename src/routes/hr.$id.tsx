import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Trash2 } from "lucide-react";
import { hrService } from "@/services/hr.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DetailOrOutlet } from "@/components/common/DetailOrOutlet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { useT } from "@/i18n";

export const Route = createFileRoute("/hr/$id")({
  head: () => ({ meta: [{ title: "Employee · Insaf Gas Corp" }] }),
  component: EmployeeDetail,
});

function EmployeeDetail() {
  return (
    <DetailOrOutlet>
      <EmployeeDetailBody />
    </DetailOrOutlet>
  );
}

function EmployeeDetailBody() {
  const t = useT();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: e, isLoading, isFetched } = useQuery({
    queryKey: ["employees", id],
    queryFn: () => hrService.getEmployee(id),
  });

  const remove = useMutation({
    mutationFn: () => hrService.removeEmployee(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(t("hr.deleted"));
      navigate({ to: "/hr" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !e) return <div className="p-6 text-sm text-destructive">{t("hr.notFound")}</div>;
  if (!e) return null;

  return (
    <div>
      <PageHeader
        title={e.name}
        description={`${e.employeeNo} · ${e.designation}`}
        backTo="/hr"
        backLabel={t("hr.title")}
        actions={
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/hr/$id/statement" params={{ id }}>
                <FileText className="mr-1 h-4 w-4" /> {t("hr.statement")}
              </Link>
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(t("hr.deleteConfirm"))) remove.mutate();
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> {t("common.delete")}
            </Button>
          </div>
        }
      />
      <Card>
        <CardContent className="grid gap-4 pt-6 text-sm md:grid-cols-2">
          <Info label={t("hr.employeeId")} value={e.employeeNo} />
          <Info label={t("common.phone")} value={e.phone} />
          <Info label={t("hr.designation")} value={e.designation} />
          <Info label={t("hr.department")} value={e.department} />
          <Info label={t("hr.joiningDate")} value={formatDate(e.joiningDate)} />
          <Info label={t("hr.basicSalary")} value={formatCurrency(e.salary)} />
          <div>
            <p className="text-xs uppercase text-muted-foreground">{t("common.status")}</p>
            <Badge variant={e.status === "active" ? "default" : "secondary"} className="mt-1">
              {e.status === "active" ? t("common.active") : t("common.inactive")}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
