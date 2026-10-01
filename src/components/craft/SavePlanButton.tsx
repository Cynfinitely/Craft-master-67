"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { CraftPlan } from "@/lib/craft/types";
import { ActionWithInfo } from "@/components/ui/ActionWithInfo";
import { Alert } from "@/components/ui/Alert";

type State = "idle" | "naming" | "saving" | "saved" | "error";

function defaultName(plan: CraftPlan): string {
  return `${plan.baseName} (${plan.desiredPrefixes.length}p/${plan.desiredSuffixes.length}s)`;
}

async function errorText(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const data = JSON.parse(raw) as { error?: unknown };
    if (typeof data.error === "string" && data.error) return data.error;
  } catch {
    // not JSON — fall through to the raw body
  }
  return raw || `Request failed (${res.status})`;
}

export function SavePlanButton({ plan }: { plan: CraftPlan }) {
  const [state, setState] = useState<State>("idle");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const reasonId = useId();

  useEffect(() => {
    if (state === "naming") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (state === "saved" || state === "error") {
      // The form unmounted; put focus back on the trigger so it isn't lost.
      triggerRef.current?.focus();
    }
  }, [state]);

  const open = () => {
    setName(defaultName(plan));
    setError(null);
    setState("naming");
  };

  const cancel = () => {
    setState("idle");
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, baseId: plan.baseId, plan }),
      });
      if (!res.ok) throw new Error(await errorText(res));
      setState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the plan.");
      setState("error");
    }
  };

  if (state === "naming" || state === "saving") {
    return (
      <form
        className="flex w-full flex-wrap items-end gap-2 sm:w-auto"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && state === "naming") {
            e.preventDefault();
            cancel();
          }
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:w-64 sm:flex-none">
          <label htmlFor={inputId} className="label">
            Plan name
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className="input"
            value={name}
            maxLength={120}
            required
            disabled={state === "saving"}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={state === "saving" || !name.trim()}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={cancel} disabled={state === "saving"}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <ActionWithInfo
        label="Save plan"
        summary="Stores the current plan locally for later."
        detail={[
          "Saved to the local database via the plans API.",
          "The Saved page re-prices it at today's currency prices.",
          "Asks for a name — includes base and mod counts by default.",
        ]}
      >
        <button
          ref={triggerRef}
          type="button"
          className="btn"
          onClick={open}
          disabled={!plan.feasible}
          aria-describedby={!plan.feasible ? reasonId : undefined}
        >
          {state === "saved" ? "Save again" : "Save plan"}
        </button>
      </ActionWithInfo>
      {!plan.feasible ? (
        <p id={reasonId} className="text-2xs text-forge-muted">
          Only reachable plans can be saved.
        </p>
      ) : null}
      {state === "saved" ? (
        <Alert tone="success">
          Plan saved.{" "}
          <Link href="/plans" className="font-medium underline underline-offset-2">
            View saved plans
          </Link>
        </Alert>
      ) : null}
      {state === "error" && error ? (
        <Alert tone="danger" title="Could not save the plan">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
