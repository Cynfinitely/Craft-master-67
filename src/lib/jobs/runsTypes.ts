import type { StageView } from "@/lib/jobs/stages";

export interface RunEvent {
  at: number;
  stage: string;
  text: string;
}

/** One unit of a parent run (e.g. a single tablet). */
export interface RunUnit {
  id: string;
  label: string;
  status: string;
  message: string;
  runAt: number;
  current: number | null;
  total: number | null;
}

export interface RunCard {
  id: string;
  kind: string;
  status: string;
  message: string;
  runAt: number;
  current: number | null;
  total: number | null;
  updatedAt: number;
  league: string;
  lane: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  stages: StageView[];
  events: RunEvent[];
  /** Units of a parent run, when it fanned out. */
  units: RunUnit[];
  /** Estimated finish time of a parent run from its finished units' pace. */
  etaAt: number | null;
}

export interface ScheduleCard {
  id: string;
  kind: string;
  nextRunAt: number;
  intervalMs: number;
  enabled: boolean;
}

export interface BudgetWindow {
  rule: string;
  periodSec: number;
  max: number;
  allowed: number;
  used: number;
}

export interface BudgetPolicy {
  policy: string;
  windows: BudgetWindow[];
  blockedUntil: number;
  waitMs: number;
}

export interface WorkerCard {
  id: string;
  kind: string;
  seenAt: number;
  currentJob: string | null;
}

export interface RunsBoardData {
  now: number;
  /** Jobs a user is waiting on (pending or running). */
  interactive: RunCard[];
  running: RunCard[];
  waiting: RunCard[];
  past: RunCard[];
  upcoming: ScheduleCard[];
  rate: { nextAllowedAt: number; summary: string };
  budget: {
    policies: BudgetPolicy[];
    savedAt: number;
    observed: { search?: string; fetch?: string };
    /** Share of each window each lane may use. */
    headroom: { interactive: number; background: number };
  } | null;
  workers: WorkerCard[];
  /** Hosted database: nothing drains the queue unless a worker is online. */
  remote: boolean;
  collectorLeague: string;
  leagueOptions: string[];
}
