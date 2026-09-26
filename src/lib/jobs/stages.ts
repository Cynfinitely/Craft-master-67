export interface StageDef {
  id: string;
  label: string;
}

export type StageVisual = "done" | "current" | "waiting" | "upcoming";

export interface StageView {
  id: string;
  label: string;
  status: StageVisual;
  at: number | null;
  detail: string | null;
}

export const STAGE_PLANS: Record<string, StageDef[]> = {
  "refresh:prices": [
    { id: "league", label: "Resolve league" },
    { id: "fetch", label: "Fetch poe2scout categories" },
    { id: "cache", label: "Write price cache" },
    { id: "wait", label: "Wait until the next schedule" },
  ],
  "scan:gems": [
    { id: "catalog", label: "Load gem catalog" },
    { id: "price", label: "Price 21/20 batches" },
    { id: "rate_limit", label: "Wait out a rate limit" },
    { id: "done", label: "Mark the pass done" },
    { id: "wait", label: "Wait for the next 12-hour pass" },
  ],
  "scan:tablets": [
    { id: "fanout", label: "Queue one unit per tablet" },
    { id: "units", label: "Scan each tablet" },
    { id: "done", label: "Mark the pass done" },
    { id: "wait", label: "Wait for the next pass" },
  ],
  "scan:tablet": [
    { id: "sample", label: "Sample rare listings" },
    { id: "combos", label: "Build combinations" },
    { id: "floor", label: "Confirm floor prices" },
    { id: "rate_limit", label: "Wait on rate limit or budget" },
    { id: "done", label: "Mark the tablet done" },
  ],
  "scan:class": [
    { id: "sample", label: "Sample listings" },
    { id: "probe", label: "Probe combos" },
    { id: "solve", label: "Solve opportunities" },
    { id: "save", label: "Save scan results" },
    { id: "wait", label: "Wait until this class rotates back" },
  ],
  "scan:quick": [
    { id: "sample", label: "Quick sample" },
    { id: "probe", label: "Probe a few combos" },
    { id: "done", label: "Mark the pass done" },
    { id: "wait", label: "Wait for the next request" },
  ],
  "sample:class": [
    { id: "sample", label: "Sample listings" },
    { id: "done", label: "Mark the pass done" },
    { id: "wait", label: "Wait for the next request" },
  ],
  "probe:class": [
    { id: "probe", label: "Probe combos" },
    { id: "done", label: "Mark the pass done" },
    { id: "wait", label: "Wait for the next request" },
  ],
};

export interface RailEvent {
  at: number;
  stage: string;
  text: string;
}

export interface RailJob {
  kind: string;
  status: string;
  message: string;
  runAt: number;
  current: number | null;
  total: number | null;
}

/** Pick a stage id from a progress line when the caller did not set one. */
export function inferStage(kind: string, text: string): string {
  const m = text.toLowerCase();
  // Parent runs quote their units' messages, so unit wording must not move them.
  if (kind === "scan:tablets") {
    if (m.startsWith("done")) return "done";
    if (m.startsWith("queued")) return "fanout";
    return "units";
  }
  if (
    m.includes("rate limit") ||
    m.includes("trade limit") ||
    m.includes("retry") ||
    m.includes("continuing in") ||
    m.includes("budget")
  ) {
    return "rate_limit";
  }
  if (kind === "refresh:prices") {
    if (m.includes("league")) return "league";
    if (m.includes("cache") || m.includes("wrote")) return "cache";
    return "fetch";
  }
  if (kind === "scan:gems") {
    if (m.includes("discover") || m.includes("catalog")) return "catalog";
    if (m.includes("done")) return "done";
    return "price";
  }
  if (kind === "scan:tablet") {
    if (m.includes("combination") || m.includes("combo")) return "combos";
    if (m.includes("reading") || m.includes("sample") || m.includes("listing"))
      return "sample";
    if (m.includes("done")) return "done";
    return "floor";
  }
  if (kind === "scan:class" || kind === "scan:quick") {
    if (m.includes("sample")) return "sample";
    if (m.includes("probe")) return "probe";
    if (m.includes("solv") || m.includes("opportunit")) return "solve";
    if (m.includes("saved") || m.includes("done")) return kind === "scan:class" ? "save" : "done";
    return "sample";
  }
  if (kind === "probe:class") return m.includes("done") ? "done" : "probe";
  if (m.includes("done")) return "done";
  return "sample";
}

export function buildStageRail(
  job: RailJob,
  events: RailEvent[],
  nextRunAt: number | null,
  now: number,
): StageView[] {
  const plan = STAGE_PLANS[job.kind] ?? [
    { id: "run", label: job.kind },
    { id: "wait", label: "Wait for the next run" },
  ];
  const latestByStage = new Map<string, RailEvent>();
  for (const event of events) {
    if (event.stage) latestByStage.set(event.stage, event);
  }
  const latest = events.length ? events[events.length - 1] : null;
  const activeId = latest?.stage || plan[0]?.id || "run";
  const activeIndex = Math.max(
    0,
    plan.findIndex((s) => s.id === activeId),
  );
  const finished = job.status === "done" || job.status === "error" || job.status === "cancelled";
  const waitingOnSelf = job.status === "pending" && job.runAt > now;

  return plan.map((stage, index) => {
    const seen = latestByStage.get(stage.id) ?? null;
    let status: StageVisual = "upcoming";
    if (stage.id === "wait") {
      if (finished || job.status === "pending") status = "waiting";
    } else if (finished && stage.id !== "rate_limit") {
      status = seen || index < plan.findIndex((s) => s.id === "wait") ? "done" : "upcoming";
      if (job.status === "error" && stage.id === activeId) status = "current";
    } else if (stage.id === "rate_limit") {
      status = waitingOnSelf ? "waiting" : seen ? "done" : "upcoming";
    } else if (index < activeIndex || (seen && index < activeIndex)) {
      status = "done";
    } else if (index === activeIndex) {
      status = waitingOnSelf ? "waiting" : job.status === "running" || seen ? "current" : "upcoming";
      if (seen && job.status === "running") status = "current";
      if (index < activeIndex) status = "done";
    }
    if (seen && index < activeIndex) status = "done";

    const at =
      stage.id === "wait"
        ? finished
          ? nextRunAt
          : waitingOnSelf
            ? job.runAt
            : null
        : (seen?.at ?? null);
    const detail =
      status === "current"
        ? job.message
        : status === "waiting"
          ? stage.id === "wait" || waitingOnSelf
            ? job.message
            : seen?.text ?? null
          : seen?.text ?? null;
    return { id: stage.id, label: stage.label, status, at, detail };
  });
}
