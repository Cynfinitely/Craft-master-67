"use client";

import { useState } from "react";
import type { CraftPlan } from "@/lib/craft/types";
import { ActionWithInfo } from "@/components/ui/ActionWithInfo";

export function SavePlanButton({ plan }: { plan: CraftPlan }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  const save = async () => {
    const suggested = `${plan.baseName} (${plan.desiredPrefixes.length}p/${plan.desiredSuffixes.length}s)`;
    const name = window.prompt("Name this crafting plan:", suggested);
    if (!name) return;
    setState("saving");
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseId: plan.baseId, plan }),
      });
      if (!res.ok) throw new Error(await res.text());
      setState("saved");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  };

  return (
    <ActionWithInfo
      label="Save plan"
      summary="Stores the current plan locally for later."
      detail={[
        "Saved to the local database via the plans API.",
        "The Saved page re-prices it at today's currency prices.",
        "Prompts for a name — includes base and mod counts by default.",
      ]}
    >
      <button
        type="button"
        className="btn"
        onClick={save}
        disabled={state === "saving" || !plan.feasible}
      >
        {state === "saving"
          ? "Saving..."
          : state === "saved"
            ? "Saved"
            : state === "error"
              ? "Error"
              : "Save plan"}
      </button>
    </ActionWithInfo>
  );
}
