export function StepBreadcrumb({
  steps,
}: {
  steps: { label: string; active?: boolean }[];
}) {
  return (
    <div className="panel-inset flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-forge-gold/55">
      {steps.map((step, i) => (
        <span key={step.label} className="inline-flex items-center gap-2">
          {i > 0 ? <span className="text-forge-gold/30">→</span> : null}
          <span
            className={
              step.active
                ? "font-semibold text-forge-goldbright"
                : "font-semibold text-forge-gold/75"
            }
          >
            {step.label}
          </span>
        </span>
      ))}
    </div>
  );
}
