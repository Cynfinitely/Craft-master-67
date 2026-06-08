import { z } from "zod";

/**
 * Zod schemas for the subset of the repoe-fork PoE2 export that we ingest.
 * The export contains many more fields; we keep `.passthrough()` so unknown
 * fields don't break parsing when the upstream format evolves.
 */

export const minMax = z.object({
  min: z.number(),
  max: z.number(),
});

export const baseItemSchema = z
  .object({
    name: z.string(),
    item_class: z.string(),
    domain: z.string().optional(),
    drop_level: z.number().optional(),
    release_state: z.string().optional(),
    inventory_width: z.number().optional(),
    inventory_height: z.number().optional(),
    requirements: z.record(z.number()).nullable().optional(),
    properties: z.record(z.any()).nullable().optional(),
    implicits: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    visual_identity: z
      .object({ dds_file: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export const modStatSchema = z
  .object({
    id: z.string(),
    min: z.number(),
    max: z.number(),
  })
  .passthrough();

export const spawnWeightSchema = z.object({
  tag: z.string(),
  weight: z.number(),
});

export const modSchema = z
  .object({
    name: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    domain: z.string(),
    generation_type: z.string(),
    required_level: z.number().optional(),
    is_essence_only: z.boolean().optional(),
    text: z.string().nullable().optional(),
    groups: z.array(z.string()).optional(),
    stats: z.array(modStatSchema).optional(),
    adds_tags: z.array(z.string()).optional(),
    implicit_tags: z.array(z.string()).optional(),
    spawn_weights: z.array(spawnWeightSchema).optional(),
  })
  .passthrough();

export const itemClassSchema = z
  .object({
    name: z.string(),
    category: z.string().nullable().optional(),
    category_id: z.string().nullable().optional(),
  })
  .passthrough();

export const baseItemsFile = z.record(baseItemSchema);
export const modsFile = z.record(modSchema);
export const itemClassesFile = z.record(itemClassSchema);
export const tagsFile = z.array(z.string());

export type RawBaseItem = z.infer<typeof baseItemSchema>;
export type RawMod = z.infer<typeof modSchema>;
export type RawItemClass = z.infer<typeof itemClassSchema>;
