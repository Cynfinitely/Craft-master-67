"use client";

import Link from "next/link";
import { ActionWithInfo } from "@/components/ui/ActionWithInfo";

export function PlanCraftLink({ href }: { href: string }) {
  return (
    <ActionWithInfo
      label="Plan a craft"
      summary="Opens the crafting planner with this base pre-selected."
      detail={[
        "Carries base id and item level into the planner.",
        "Modifier groups are empty until you pick targets.",
        "Use the Items page pool to see what can roll before planning.",
      ]}
      className="w-full sm:w-auto"
    >
      <Link href={href} className="btn btn-primary w-full sm:w-auto">
        Plan a craft
      </Link>
    </ActionWithInfo>
  );
}
