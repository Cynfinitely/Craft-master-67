import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-8">
      <EmptyState
        title="Page not found"
        action={
          <>
            <Link href="/craft" className="btn btn-primary">
              Plan a craft
            </Link>
            <Link href="/" className="btn">
              Go home
            </Link>
          </>
        }
      >
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </EmptyState>
    </div>
  );
}
