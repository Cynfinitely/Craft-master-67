import type { BaseDetail, BaseSummary } from "@/lib/data/types";
import { BasePickerList } from "./BasePickerList";
import { SelectedBaseCard } from "./SelectedBaseCard";
import { StepBreadcrumb } from "@/components/ui/StepBreadcrumb";
import { EmptyState } from "@/components/ui/EmptyState";

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
        <EmptyState title="Filter bases">{emptyHint}</EmptyState>
      ) : results.length === 0 ? (
        <EmptyState title="No bases match">
          {query?.trim() ? (
            <>
              Nothing matches &ldquo;{query.trim()}&rdquo;
              {itemClass ? ` in ${itemClass}` : ""}. Try a shorter name or a
              different item class.
            </>
          ) : (
            "Try a different item class or search for a base name."
          )}
        </EmptyState>
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
