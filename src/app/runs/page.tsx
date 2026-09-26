import { RunsBoard } from "@/components/runs/RunsBoard";
import { loadRunsBoard } from "@/lib/jobs/runsQuery";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  let board;
  let error: string | null = null;
  try {
    board = await loadRunsBoard();
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not load runs.";
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">Runs</h1>
        <p className="mt-1 text-sm text-forge-gold/80">
          Every collector pass: what is running, which stage it is in, what
          already happened, and when the next pass starts.
        </p>
      </div>
      {error || !board ? (
        <div className="panel p-4 text-center text-xs text-forge-rust">{error}</div>
      ) : (
        <RunsBoard initial={board} />
      )}
    </div>
  );
}
