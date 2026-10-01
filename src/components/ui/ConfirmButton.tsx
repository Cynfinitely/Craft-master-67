"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Two-step inline confirmation for destructive actions: the first press arms
 * the button ("Confirm delete?"), the second runs `onConfirm`. It disarms
 * itself after a few seconds, on Escape, or when focus leaves.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Confirm?",
  ariaLabel,
  className = "",
  disabled,
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  confirmLabel?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const arm = () => {
    setArmed(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), 4000);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={armed ? `${confirmLabel} ${ariaLabel ?? ""}`.trim() : ariaLabel}
      className={`btn tap ${armed ? "btn-danger" : ""} ${className}`}
      onClick={() => {
        if (armed) {
          clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        } else arm();
      }}
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setArmed(false);
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
