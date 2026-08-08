import type { MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

type Props = {
  kind: "customer" | "supplier";
  id: string;
  name: string;
  className?: string;
};

export function PartyNameLink({ kind, id, name, className }: Props) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  if (kind === "customer") {
    return (
      <Link
        to="/customers/$id/statement"
        params={{ id }}
        onClick={stop}
        className={cn("font-medium text-primary hover:underline underline-offset-2", className)}
      >
        {name}
      </Link>
    );
  }
  return (
    <Link
      to="/suppliers/$id/statement"
      params={{ id }}
      onClick={stop}
      className={cn("font-medium text-primary hover:underline underline-offset-2", className)}
    >
      {name}
    </Link>
  );
}
