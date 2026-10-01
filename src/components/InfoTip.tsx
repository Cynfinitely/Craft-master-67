"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Popover } from "@/components/ui/Popover";

export function InfoTip({
  label,
  summary,
  detail,
}: {
  label: string;
  summary: string;
  detail: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => {
    // Return focus to the trigger only if it was inside the panel (Escape),
    // not when the user clicked somewhere else on the page.
    if (document.getElementById(panelId)?.contains(document.activeElement)) ref.current?.focus();
    setOpen(false);
  }, [panelId]);

  // Move focus into the panel so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => document.getElementById(panelId)?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, panelId]);

  return (
    <span className="relative inline-flex">
      <button
        ref={ref}
        type="button"
        className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-forge-border/80 bg-forge-panel2 text-2xs font-bold text-forge-muted transition-colors after:absolute after:-inset-3 after:content-[''] hover:border-forge-gold/50 hover:text-forge-goldbright max-md:h-7 max-md:w-7 max-md:text-xs max-md:after:-inset-2"
        aria-label={`Info: ${label}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      <Popover open={open} onClose={close} anchorRef={ref} id={panelId} role="dialog" ariaLabel={label} className="p-3 outline-none">
        <p className="text-xs font-semibold text-forge-goldbright">{label}</p>
        <p className="mt-1 text-2xs text-forge-muted max-md:text-xs">{summary}</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-2xs text-forge-muted max-md:text-xs">
          {detail.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </Popover>
    </span>
  );
}
