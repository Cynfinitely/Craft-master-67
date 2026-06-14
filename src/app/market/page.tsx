import { redirect } from "next/navigation";

export default function MarketRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) next.set(k, v);
  }
  next.set("tab", "market");
  redirect(`/profit?${next.toString()}`);
}
