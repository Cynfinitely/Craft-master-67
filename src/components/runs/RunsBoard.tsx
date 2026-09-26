"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type {
  BudgetPolicy,
  RunCard,
  RunUnit,
  RunsBoardData,
  ScheduleCard,
  WorkerCard,
} from "@/lib/jobs/runsTypes";
import type { StageView } from "@/lib/jobs/stages";

function when(ts: number | null): string {
  if (!ts) return "—";
  const delta = ts - Date.now();
  if (delta > 60_000) {
    const min = Math.round(delta / 60000);
    return min < 90 ? `in ${min}m` : new Date(ts).toLocaleString();
  }
  if (delta > 0) return `in ${Math.max(1, Math.round(delta / 1000))}s`;
  return new Date(ts).toLocaleString();
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

const RATE_WORDS = /rate limit|trade limit|budget|retry|penalty|paused/i;

function waitReason(run: { status: string; runAt: number; message: string }): string | null {
  if (run.status !== "pending" || run.runAt <= Date.now()) return null;
  return RATE_WORDS.test(run.message)
    ? `Waiting on the trade rate limit until ${clock(run.runAt)} (${when(run.runAt)}).`
    : `Starts at ${clock(run.runAt)} (${when(run.runAt)}).`;
}

function statusTone(status: string): string {
  if (status === "running") return "text-forge-rust";
  if (status === "done") return "text-emerald-700";
  if (status === "error") return "text-red-700";
  return "text-forge-gold/80";
}

function StageRail({ stages }: { stages: StageView[] }) {
  return (
    <ol className="mt-3 space-y-1">
      {stages.map((stage) => (
        <li key={stage.id} className="flex flex-wrap gap-x-2 text-xs">
          <span
            className={
              stage.status === "current"
                ? "text-forge-rust"
                : stage.status === "done"
                  ? "text-emerald-800"
                  : "text-forge-gold/80"
            }
          >
            {stage.status}
          </span>
          <span className="text-forge-goldbright">{stage.label}</span>
          {stage.at ? <span className="text-forge-gold/80">{when(stage.at)}</span> : null}
          {stage.status === "current" && stage.detail ? (
            <span className="text-forge-gold">{stage.detail}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function UnitList({ units }: { units: RunUnit[] }) {
  return (
    <ul className="mt-3 divide-y divide-forge-border/60 rounded-md border border-forge-border/60">
      {units.map((unit) => {
        const wait = waitReason(unit);
        return (
          <li key={unit.id} className="flex flex-col gap-0.5 px-3 py-2 text-xs sm:flex-row sm:items-baseline sm:gap-3">
            <span className="font-medium text-forge-goldbright sm:w-40 sm:shrink-0">{unit.label}</span>
            <span className={`sm:w-20 sm:shrink-0 ${statusTone(unit.status)}`}>
              {unit.status}
              {unit.total && unit.current != null ? ` ${unit.current}/${unit.total}` : ""}
            </span>
            <span className="min-w-0 break-words text-forge-gold/80">{wait ?? unit.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

function RunRow({
  run,
  onAction,
}: {
  run: RunCard;
  onAction: (action: "cancel" | "retry", id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(run.status === "running" || run.units.length > 0);
  const [busy, setBusy] = useState(false);
  const active = run.status === "pending" || run.status === "running";
  const unitsDone = run.units.filter((u) => u.status === "done").length;
  const progress = run.units.length
    ? `${unitsDone}/${run.units.length} units`
    : run.total && run.current != null
      ? `${run.current}/${run.total}`
      : null;
  const wait = waitReason(run);

  const act = async (action: "cancel" | "retry") => {
    setBusy(true);
    try {
      await onAction(action, run.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="panel p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          className="tap min-w-0 flex-1 text-left"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <h3 className="text-sm font-semibold text-forge-goldbright">
            {run.kind}
            {run.league ? ` · ${run.league}` : ""}
          </h3>
          <p className="mt-0.5 text-xs text-forge-gold/80">
            <span className={statusTone(run.status)}>{run.status}</span>
            {progress ? ` · ${progress}` : ""}
            {` · ${run.lane}`}
            {run.priority ? ` · priority ${run.priority}` : ""}
            {run.attempts > 0 ? ` · attempt ${run.attempts}/${run.maxAttempts}` : ""}
            {active ? "" : ` · ${when(run.updatedAt)}`}
          </p>
          <p className="mt-1 break-words text-xs text-forge-gold">{run.message}</p>
          {wait ? <p className="mt-1 text-xs text-amber-800">{wait}</p> : null}
          {run.etaAt && active ? (
            <p className="mt-1 text-xs text-forge-gold/80">
              Estimated finish {clock(run.etaAt)} ({when(run.etaAt)}), based on finished units.
            </p>
          ) : null}
        </button>
        <div className="flex shrink-0 gap-2">
          {active ? (
            <button type="button" className="btn tap text-xs" disabled={busy} onClick={() => void act("cancel")}>
              Cancel
            </button>
          ) : (
            <button type="button" className="btn tap text-xs" disabled={busy} onClick={() => void act("retry")}>
              Run again
            </button>
          )}
        </div>
      </div>
      {open ? (
        <>
          {run.units.length ? <UnitList units={run.units} /> : null}
          <StageRail stages={run.stages} />
          {run.events.length ? (
            <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto break-words text-[11px] text-forge-gold/80">
              {run.events.map((event, i) => (
                <li key={`${event.at}-${i}`}>
                  {clock(event.at)} · {event.stage || "log"} · {event.text}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

function Lane({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/80">{title}</h2>
        {hint ? <p className="text-xs text-forge-gold/70">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="panel p-4 text-xs text-forge-gold/80">{children}</p>;
}

function WorkerStatus({ workers, remote }: { workers: WorkerCard[]; remote: boolean }) {
  const worker = workers.find((w) => w.kind === "worker");
  const pump = workers.find((w) => w.kind === "pump");
  if (worker) {
    return (
      <p className="text-xs text-emerald-700">
        Market worker online (last seen {clock(worker.seenAt)})
        {worker.currentJob ? `, working on ${worker.currentJob.slice(0, 8)}` : ", idle"}.
      </p>
    );
  }
  if (remote) {
    return (
      <p className="text-xs text-amber-800">
        No market worker is online. Queued jobs wait until <code>npm run market:worker</code> runs on
        the worker host.
      </p>
    );
  }
  return (
    <p className="text-xs text-forge-gold/80">
      {pump
        ? "No separate worker; the site's built-in queue pump is draining jobs."
        : "No worker online. The site drains the queue itself while it has queued jobs."}
    </p>
  );
}

function BudgetMeters({ budget }: { budget: NonNullable<RunsBoardData["budget"]> }) {
  const now = Date.now();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {budget.policies.map((policy: BudgetPolicy) => (
        <div key={policy.policy} className="space-y-2">
          <p className="text-xs font-semibold text-forge-goldbright">
            {policy.policy === "search" ? "Searches" : "Item fetches"}
            {policy.blockedUntil > now ? (
              <span className="ml-2 font-normal text-red-700">paused until {clock(policy.blockedUntil)}</span>
            ) : policy.waitMs > 0 ? (
              <span className="ml-2 font-normal text-amber-800">next background slot {when(now + policy.waitMs)}</span>
            ) : (
              <span className="ml-2 font-normal text-emerald-700">ready</span>
            )}
          </p>
          {policy.windows.map((w) => {
            const pct = w.max > 0 ? Math.min(100, (w.used / w.max) * 100) : 0;
            return (
              <div key={`${w.rule}-${w.periodSec}`} className="text-[11px] text-forge-gold/80">
                <div className="flex justify-between">
                  <span>
                    {w.rule} · per {w.periodSec >= 60 ? `${w.periodSec / 60}m` : `${w.periodSec}s`}
                  </span>
                  <span>
                    {w.used}/{w.max}
                  </span>
                </div>
                <div className="relative mt-0.5 h-1.5 rounded-full bg-forge-panel2">
                  <div
                    className={`h-full rounded-full ${pct >= budget.headroom.interactive * 100 ? "bg-red-500/80" : pct >= budget.headroom.background * 100 ? "bg-amber-400/80" : "bg-emerald-600/80"}`}
                    style={{ width: `${pct}%` }}
                  />
                  <span
                    className="absolute top-[-2px] h-2.5 w-px bg-forge-gold/60"
                    style={{ left: `${budget.headroom.background * 100}%` }}
                    title="Background share"
                  />
                  <span
                    className="absolute top-[-2px] h-2.5 w-px bg-forge-goldbright"
                    style={{ left: `${budget.headroom.interactive * 100}%` }}
                    title="Interactive share"
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <p className="text-[11px] text-forge-gold/70 sm:col-span-2">
        Ticks mark how much of each window background scans ({Math.round(budget.headroom.background * 100)}%) and
        on-demand jobs ({Math.round(budget.headroom.interactive * 100)}%) may use. The rest stays free so GGG never
        applies a penalty. Snapshot from {clock(budget.savedAt)}.
      </p>
    </div>
  );
}

function LeaguePicker({ league, options }: { league: string; options: string[] }) {
  const [value, setValue] = useState(league);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(league);
  }, [league]);

  const save = async (next: string) => {
    setValue(next);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/runs/league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not change the league");
      setMessage(`Runs will use ${next}. Waiting jobs were moved to that league.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not change the league");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
      <label className="text-sm font-semibold text-forge-goldbright" htmlFor="run-league">
        Run league
      </label>
      <select
        id="run-league"
        className="input sm:max-w-xs"
        value={value}
        disabled={busy}
        onChange={(e) => void save(e.target.value)}
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {message ? <p className="text-xs text-forge-gold">{message}</p> : null}
    </div>
  );
}

function Upcoming({ rows }: { rows: ScheduleCard[] }) {
  if (rows.length === 0) return <Empty>Every schedule has a job in flight.</Empty>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((row) => (
        <article key={row.id} className="panel p-4 text-sm">
          <p className="font-semibold text-forge-goldbright">{row.kind}</p>
          <p className="text-xs text-forge-gold/80">Next pass {when(row.nextRunAt)}</p>
        </article>
      ))}
    </div>
  );
}

export function RunsBoard({ initial }: { initial: RunsBoardData }) {
  const [board, setBoard] = useState(initial);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/runs", { cache: "no-store" });
      const data = (await res.json()) as RunsBoardData;
      if (data.running) setBoard(data);
    } catch {
      /* keep the last board */
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const onAction = useCallback(
    async (action: "cancel" | "retry", id: string) => {
      setActionError(null);
      try {
        const res = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Could not ${action} the job`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : `Could not ${action} the job`);
      }
      await refresh();
    },
    [refresh],
  );

  const row = (run: RunCard) => <RunRow key={run.id} run={run} onAction={onAction} />;

  return (
    <div className="space-y-6">
      <LeaguePicker league={board.collectorLeague} options={board.leagueOptions} />
      <section className="panel space-y-3 p-4">
        <WorkerStatus workers={board.workers} remote={board.remote} />
        <p className="text-xs text-forge-gold">
          {board.rate.summary}
          {board.rate.nextAllowedAt > Date.now() ? ` Next trade request ${when(board.rate.nextAllowedAt)}.` : ""}
        </p>
        {board.budget ? <BudgetMeters budget={board.budget} /> : null}
      </section>
      {actionError ? <p className="panel p-3 text-xs text-red-700">{actionError}</p> : null}
      <Lane title="On demand" hint="Jobs someone is waiting on in the app. They run before background scans.">
        {board.interactive.length === 0 ? <Empty>No on-demand jobs.</Empty> : board.interactive.map(row)}
      </Lane>
      <Lane title="Running now" hint="Background scans that hold the worker.">
        {board.running.length === 0 ? <Empty>No background scan is running.</Empty> : board.running.map(row)}
      </Lane>
      <Lane title="Queued" hint="Background scans waiting for their turn or for the rate limit.">
        {board.waiting.length === 0 ? <Empty>Nothing is queued.</Empty> : board.waiting.map(row)}
      </Lane>
      <Lane title="Upcoming">
        <Upcoming rows={board.upcoming} />
      </Lane>
      <Lane title="Past">
        {board.past.length === 0 ? <Empty>No finished runs yet.</Empty> : board.past.map(row)}
      </Lane>
    </div>
  );
}
