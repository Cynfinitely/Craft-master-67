"use client";

import { useState } from "react";

export function FavoriteButton({
  baseId,
  initial,
}: {
  baseId: string;
  initial: boolean;
}) {
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseId }),
      });
      const data = await res.json();
      setFav(Boolean(data.favorited));
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`btn shrink-0 ${fav ? "border-forge-gold/60 text-forge-goldbright" : ""}`}
      title={fav ? "Remove from favorites" : "Add to favorites"}
    >
      {fav ? "★ Favorited" : "☆ Favorite"}
    </button>
  );
}
