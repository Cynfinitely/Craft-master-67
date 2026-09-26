import "server-only";
import { getPrices } from "@/lib/pricing/poe2scout";
import { makePriceBook, type PriceBook } from "../engine/prices";

const MEMO_MS = 60_000;
let memo: { at: number; book: Promise<PriceBook> } | null = null;

async function load(): Promise<PriceBook> {
  try {
    const data = await getPrices();
    return makePriceBook({
      live: new Map(data.items.map((i) => [i.apiId, i.priceExalted])),
      names: new Map(data.items.map((i) => [i.apiId, i.name])),
      divinePriceExalted: data.divinePrice,
      fetchedAt: data.fetchedAt,
      league: data.league,
    });
  } catch {
    return makePriceBook({ live: new Map() });
  }
}

/** Current currency prices (poe2scout cache, fallback table when offline). */
export function loadPriceBook(): Promise<PriceBook> {
  const now = Date.now();
  if (memo && now - memo.at < MEMO_MS) return memo.book;
  memo = { at: now, book: load() };
  return memo.book;
}
