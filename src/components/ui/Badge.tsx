import type { Tone } from "@/components/ui/Alert";

const TONES: Record<Tone | "neutral" | "accent", string> = {
  neutral: "border-forge-border bg-forge-panel2 text-forge-gold",
  accent: "border-forge-rust/50 bg-forge-rust/10 text-forge-rust-strong",
  info: "border-info-border bg-info-bg text-info-fg",
  success: "border-success-border bg-success-bg text-success-fg",
  warn: "border-warn-border bg-warn-bg text-warn-fg",
  danger: "border-danger-border bg-danger-bg text-danger-fg",
};

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = "neutral",
  className = "",
  title,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`badge ${TONES[tone]} ${className}`} title={title}>
      {children}
    </span>
  );
}

/** Prefix/suffix marker that does not rely on colour alone. */
export function AffixMark({ kind }: { kind: "prefix" | "suffix" }) {
  return (
    <abbr
      title={kind === "prefix" ? "Prefix" : "Suffix"}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-2xs font-bold no-underline ${
        kind === "prefix" ? "bg-affix-prefix/15 text-affix-prefix" : "bg-affix-suffix/15 text-affix-suffix"
      }`}
    >
      {kind === "prefix" ? "P" : "S"}
    </abbr>
  );
}
