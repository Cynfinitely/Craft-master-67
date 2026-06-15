import { InfoTip } from "@/components/InfoTip";

export function ActionWithInfo({
  label,
  summary,
  detail,
  children,
  className = "",
}: {
  label: string;
  summary: string;
  detail: string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 ${className}`}
    >
      {children}
      <InfoTip label={label} summary={summary} detail={detail} />
    </div>
  );
}
