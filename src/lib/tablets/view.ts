import type { TabletComboResultRow } from "@/db/schema";

export interface TabletComboView {
  id: string;
  tablet: string;
  status: string;
  floorPriceExalted: number | null;
  medianPriceExalted: number | null;
  listingCount: number | null;
  tradeUrl: string | null;
  errorMessage: string | null;
  prefixes: { label: string; text: string }[];
  suffixes: { label: string; text: string }[];
}

function parseMods(raw: string): {
  prefixes: { label: string; text: string }[];
  suffixes: { label: string; text: string }[];
} {
  try {
    const parsed = JSON.parse(raw) as {
      prefixes?: { label?: string; text?: string }[];
      suffixes?: { label?: string; text?: string }[];
    };
    const side = (rows: { label?: string; text?: string }[] | undefined) =>
      (rows ?? []).map((m) => ({
        label: m.label ?? "",
        text: m.text || m.label || "",
      }));
    return {
      prefixes: side(parsed.prefixes),
      suffixes: side(parsed.suffixes),
    };
  } catch {
    return { prefixes: [], suffixes: [] };
  }
}

export function toComboView(row: TabletComboResultRow): TabletComboView {
  const mods = parseMods(row.mods);
  return {
    id: row.id,
    tablet: row.tablet,
    status: row.status,
    floorPriceExalted: row.floorPriceExalted,
    medianPriceExalted: row.medianPriceExalted,
    listingCount: row.listingCount,
    tradeUrl: row.tradeUrl,
    errorMessage: row.errorMessage,
    prefixes: mods.prefixes,
    suffixes: mods.suffixes,
  };
}
