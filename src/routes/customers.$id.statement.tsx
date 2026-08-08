import { createFileRoute } from "@tanstack/react-router";
import { PartyStatement } from "@/components/statement/PartyStatement";

export const Route = createFileRoute("/customers/$id/statement")({
  head: () => ({ meta: [{ title: "Customer Statement · Insaf Gas Corp" }] }),
  component: CustomerStatementPage,
});

function CustomerStatementPage() {
  const { id } = Route.useParams();
  return <PartyStatement kind="customer" id={id} />;
}
