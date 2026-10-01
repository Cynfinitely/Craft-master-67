"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Alert } from "@/components/ui/Alert";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl space-y-4 py-8">
      <h1 className="text-2xl font-bold text-forge-goldbright">Something went wrong</h1>
      <Alert tone="danger" title="This page couldn't be loaded.">
        The data or price lookup failed. Your saved plans are not affected. Try again, or go
        back and adjust your selection.
        {error.digest ? <span className="mt-1 block text-2xs opacity-80">Ref: {error.digest}</span> : null}
      </Alert>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn">
          Go home
        </Link>
      </div>
    </div>
  );
}
