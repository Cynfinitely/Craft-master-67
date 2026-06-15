import type { BaseDetail, BaseSummary } from "@/lib/data/types";
import { BasePickerList } from "./BasePickerList";
import { SelectedBaseCard } from "./SelectedBaseCard";
import { StepBreadcrumb } from "@/components/ui/StepBreadcrumb";

export function BasePickerPanel({
  filterActive,
  results,
  selectedBase,
  selectedBaseId,
  itemClass,
  query,
  itemLevel,
  buildBaseHref,
  buildClearBaseHref,
  maxHeight = "70vh",
  steps,
  emptyHint = "Choose an item class or search for a base name (min. 2 characters).",
}: {
  filterActive: boolean;
  results: BaseSummary[];
  selectedBase?: Pick<BaseDetail, "id" | "name" | "itemClass"> | null;
  selectedBaseId?: string;
  itemClass?: string;
  query?: string;
  itemLevel?: number;
  buildBaseHref: (baseId: string) => string;
  buildClearBaseHref: () => string;
  maxHeight?: string;
  steps?: { label: string; active?: boolean }[];
  emptyHint?: string;
}) {
  if (selectedBase && selectedBaseId) {
    return (
      <div className="space-y-3">
        {steps ? <StepBreadcrumb steps={steps} /> : null}
        <SelectedBaseCard
          name={selectedBase.name}
          itemClass={selectedBase.itemClass}
          itemLevel={itemLevel}
          changeHref={buildClearBaseHref()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {steps ? <StepBreadcrumb steps={steps} /> : null}
      {!filterActive ? (
        <div className="panel p-6 text-center text-sm text-forge-gold/50">
          <p className="font-medium text-forge-gold/70">Step 1: Filter bases</p>
          <p className="mt-2">{emptyHint}</p>
        </div>
      ) : results.length === 0 ? (
        <div className="panel p-4 text-sm text-forge-gold/50">
          No bases match your search.
        </div>
      ) : (
        <BasePickerList
          results={results}
          selectedBaseId={selectedBaseId}
          itemClass={itemClass}
          query={query}
          buildBaseHref={buildBaseHref}
          maxHeight={maxHeight}
        />
      )}
    </div>
  );
}
