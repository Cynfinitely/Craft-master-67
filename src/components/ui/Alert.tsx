export type Tone = "info" | "success" | "warn" | "danger";

const TONES: Record<Tone, string> = {
  info: "border-info-border bg-info-bg text-info-fg",
  success: "border-success-border bg-success-bg text-success-fg",
  warn: "border-warn-border bg-warn-bg text-warn-fg",
  danger: "border-danger-border bg-danger-bg text-danger-fg",
};

/**
 * Inline message. Danger alerts are announced assertively; the rest politely.
 */
export function Alert({
  tone = "info",
  title,
  children,
  action,
  className = "",
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm ${TONES[tone]} ${className}`}
    >
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : ""}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
