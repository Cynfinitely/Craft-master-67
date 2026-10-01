"use client";

import { useState } from "react";

export function FavoriteButton({
  baseId,
  baseName,
  initial,
}: {
  baseId: string;
  /** Included in the accessible name so the button isn't just "Favorite". */
  baseName?: string;
  initial: boolean;
}) {
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const prev = fav;
    // Optimistic: flip immediately, roll back if the server disagrees.
    setFav(!prev);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { favorited?: unknown };
      setFav(Boolean(data.favorited));
    } catch {
      setFav(prev);
      setError("Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={fav}
        className={`btn shrink-0 ${fav ? "border-forge-gold text-forge-goldbright" : ""}`}
      >
        <span aria-hidden>{fav ? "★" : "☆"}</span>
        {fav ? "Favorited" : "Favorite"}
        {baseName ? <span className="sr-only"> {baseName}</span> : null}
      </button>
      <span role="status" className="text-2xs font-medium text-danger-fg empty:hidden">
        {error}
      </span>
    </div>
  );
}
