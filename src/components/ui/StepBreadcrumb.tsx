export function StepBreadcrumb({
  steps,
}: {
  steps: { label: string; active?: boolean; done?: boolean }[];
}) {
  return (
    <nav aria-label="Progress">
      <ol className="panel-inset flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        {steps.map((step, i) => (
          <li key={step.label} className="inline-flex items-center gap-2">
            {i > 0 ? (
              <span aria-hidden className="text-forge-muted">
                →
              </span>
            ) : null}
            <span
              aria-current={step.active ? "step" : undefined}
              className={
                step.active
                  ? "rounded bg-forge-panel px-1.5 py-0.5 font-semibold text-forge-goldbright ring-1 ring-forge-rust/50"
                  : "font-medium text-forge-muted"
              }
            >
              <span className="mr-1 num">{i + 1}.</span>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
