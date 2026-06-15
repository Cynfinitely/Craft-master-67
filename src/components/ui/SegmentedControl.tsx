"use client";

import { useEffect, useState } from "react";

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  shortLabels,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  /** Shorter labels shown below md breakpoint when provided. */
  shortLabels?: Partial<Record<T, string>>;
}) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const labelFor = (opt: { value: T; label: string }) =>
    compact && shortLabels?.[opt.value] ? shortLabels[opt.value]! : opt.label;

  return (
    <div className="overflow-x-auto md:overflow-visible">
      <div
        className="flex min-w-max gap-1 rounded-md border border-forge-border bg-forge-panel2 p-1 md:min-w-0 md:w-full"
        role="tablist"
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={`shrink-0 rounded px-3 py-1.5 text-sm transition-colors md:flex-1 md:shrink ${
              value === opt.value
                ? "bg-forge-rust/30 text-forge-goldbright"
                : "text-forge-gold/70 hover:text-forge-goldbright"
            }`}
          >
            {labelFor(opt)}
          </button>
        ))}
      </div>
    </div>
  );
}
