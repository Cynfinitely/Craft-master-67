import { redirect } from "next/navigation";

export default function OpportunitiesRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) next.set(k, v);
  }
  const qs = next.toString();
  redirect(`/profit${qs ? `?${qs}` : ""}`);
}
