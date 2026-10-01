"use client";

import { cloneElement, isValidElement, useId } from "react";

/**
 * Label + control + optional hint/error, wired together with ids. The single
 * child control receives `id`, `aria-describedby` and `aria-invalid`.
 */
export function Field({
  label,
  hint,
  error,
  srOnlyLabel = false,
  inline = false,
  className = "",
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  srOnlyLabel?: boolean;
  /** Label beside the control instead of above it. */
  inline?: boolean;
  className?: string;
  children: React.ReactElement;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const ownId = isValidElement<{ id?: string }>(children) ? children.props.id : undefined;
  const controlId = ownId ?? id;
  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : children;

  return (
    <div className={`${inline ? "flex items-center gap-2" : "flex flex-col gap-1"} min-w-0 ${className}`}>
      <label htmlFor={controlId} className={srOnlyLabel ? "sr-only" : "label shrink-0"}>
        {label}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className="text-2xs text-forge-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-2xs font-medium text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
