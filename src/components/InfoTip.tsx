"use client";

import { useEffect, useRef, useState } from "react";

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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const hoverTitle = [summary, ...detail].join(" — ");

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-forge-border/80 bg-forge-panel2 text-[10px] font-bold text-forge-gold/60 transition-colors hover:border-forge-gold/50 hover:text-forge-goldbright"
        title={hoverTitle}
        aria-label={`Info: ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-forge-border bg-forge-panel p-3 shadow-lg">
          <p className="text-xs font-semibold text-forge-goldbright">{label}</p>
          <p className="mt-1 text-[11px] text-forge-gold/75">{summary}</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] text-forge-gold/60">
            {detail.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
