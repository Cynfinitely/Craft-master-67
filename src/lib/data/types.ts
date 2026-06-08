export type GenerationType =
  | "prefix"
  | "suffix"
  | "unique"
  | "corrupted"
  | string;

export interface ModStat {
  id: string;
  min: number;
  max: number;
}

export interface BaseSummary {
  id: string;
  name: string;
  itemClass: string;
  dropLevel: number;
  tags: string[];
}

export interface BaseDetail extends BaseSummary {
  domain: string | null;
  releaseState: string | null;
  invWidth: number | null;
  invHeight: number | null;
  requirements: Record<string, number> | null;
  properties: Record<string, unknown> | null;
  implicits: string[];
  visualDds: string | null;
}

export interface EligibleMod {
  id: string;
  name: string | null;
  type: string | null;
  generationType: GenerationType;
  requiredLevel: number;
  isEssenceOnly: boolean;
  text: string | null;
  groups: string[];
  stats: ModStat[];
  /** Descriptive tags (minion, attack, caster, fire, life, etc.). */
  implicitTags: string[];
  /** Effective spawn weight for the target base (first-match semantics). */
  weight: number;
}

export interface ModPool {
  base: BaseDetail;
  itemLevel: number;
  prefixes: EligibleMod[];
  suffixes: EligibleMod[];
  prefixTotalWeight: number;
  suffixTotalWeight: number;
}

export interface ItemClassInfo {
  name: string;
  category: string | null;
  categoryId: string | null;
}
