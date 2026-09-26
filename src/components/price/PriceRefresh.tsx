"use client";

import { useState } from "react";

export function PriceRefresh({ league }: { league: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/jobs/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "refresh:prices",
          payload: { league },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not queue a refresh");
      setMessage("Price refresh queued. Watch it on Runs.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not queue a refresh");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-primary" disabled={busy || !league} onClick={refresh}>
        {busy ? "Queuing…" : "Refresh prices"}
      </button>
      {message ? <p className="text-xs text-forge-gold">{message}</p> : null}
    </div>
  );
}
