import { alchChaos } from "./alchChaos";
import { alchSpam } from "./alchSpam";
import { alloyExalt } from "./alloyExalt";
import { desecrateExalt } from "./desecrateExalt";
import { essenceDesecrateExalt } from "./essenceDesecrateExalt";
import { essenceExalt } from "./essenceExalt";
import { finishDesecrate, finishEssence, finishSlam } from "./finish";
import { fractureExalt } from "./fractureExalt";
import { magicSeedEssence } from "./magicSeedEssence";
import { omenExalt } from "./omenExalt";
import { perfectSeed } from "./perfectSeed";
import { transmuteRegalExalt } from "./transmuteRegalExalt";
import type { AnyTechnique, CraftMode } from "./types";

/**
 * Every technique the brain may consider. To add one, write a file exporting
 * a `defineTechnique(...)` and list it here; the brain tunes its choices and
 * ranks it against the others automatically.
 */
export const TECHNIQUES: AnyTechnique[] = [
  alchSpam,
  alchChaos,
  transmuteRegalExalt,
  perfectSeed,
  omenExalt,
  essenceExalt,
  essenceDesecrateExalt,
  alloyExalt,
  magicSeedEssence,
  desecrateExalt,
  fractureExalt,
  finishSlam,
  finishDesecrate,
  finishEssence,
];

export function techniquesFor(mode: CraftMode): AnyTechnique[] {
  return TECHNIQUES.filter((t) => t.modes.includes(mode));
}

export function getTechnique(id: string): AnyTechnique | undefined {
  return TECHNIQUES.find((t) => t.id === id);
}

export type { AnyTechnique, CraftContext, CraftMode, Technique } from "./types";
