"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Single-choice switcher. Behaves as a radio group: one tab stop, arrow keys
 * (and Home/End) move and select, matching native radio behaviour.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  shortLabels,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  /** Shorter labels shown below md breakpoint when provided. */
  shortLabels?: Partial<Record<T, string>>;
  /** Accessible name for the group. */
  label: string;
}) {
  const [compact, setCompact] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const labelFor = (opt: { value: T; label: string }) =>
    compact && shortLabels?.[opt.value] ? shortLabels[opt.value]! : opt.label;

  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = current === last ? 0 : current + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = current === 0 ? last : current - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  return (
    <div className="overflow-x-auto md:overflow-visible">
      <div
        className="flex min-w-max gap-1 rounded-md border border-forge-border bg-forge-panel2 p-1 md:w-full md:min-w-0"
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {options.map((opt, i) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(opt.value)}
              className={`tap shrink-0 rounded px-3 py-1.5 text-sm transition-colors md:flex-1 md:shrink ${
                selected
                  ? "bg-forge-panel font-semibold text-forge-goldbright shadow-sm ring-1 ring-forge-rust/50"
                  : "text-forge-muted hover:bg-forge-panel/60 hover:text-forge-goldbright"
              }`}
            >
              {labelFor(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
