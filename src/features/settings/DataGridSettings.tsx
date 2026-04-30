import { AlignJustify, Table2 } from "lucide-react";
import { useAppStore } from "../../store";
import { cn } from "../../lib/utils";
import {
  gridPageSizeValues,
  rowDensityValues,
  type GridPageSize,
  type RowDensity,
} from "./preferences";

const DENSITY_LABELS: Record<RowDensity, { label: string; description: string; rowClass: string }> = {
  compact: {
    label: "Compact",
    description: "33 px",
    rowClass: "py-1",
  },
  comfortable: {
    label: "Comfortable",
    description: "44 px",
    rowClass: "py-2.5",
  },
  spacious: {
    label: "Spacious",
    description: "56 px",
    rowClass: "py-[18px]",
  },
};

const PREVIEW_ROWS = ["2026-04-30", "true", "public.users"] as const;

function DensityCard({
  density,
  active,
  onClick,
}: {
  density: RowDensity;
  active: boolean;
  onClick: () => void;
}) {
  const { label, description, rowClass } = DENSITY_LABELS[density];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-[var(--radius-control)] border p-2.5 text-left",
        "transition-colors duration-[var(--motion-fast)]",
        active
          ? "border-accent bg-accent/8 shadow-[0_0_0_1px_var(--ds-accent)]"
          : "border-separator bg-content hover:bg-subtle",
      )}
    >
      <div className="mb-2 flex flex-col gap-0.5 overflow-hidden rounded border border-separator/60 bg-sidebar">
        {PREVIEW_ROWS.map((row) => (
          <div
            key={row}
            className={cn(
              "flex items-center gap-2 border-b border-separator/40 px-2 last:border-0",
              rowClass,
            )}
          >
            <span className="truncate font-mono text-[10px] text-secondary">
              {row}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-[12px] font-medium",
            active ? "text-accent" : "text-label",
          )}
        >
          {label}
        </span>
        <span className="text-[11px] text-tertiary">{description}</span>
      </div>
    </button>
  );
}

export function DataGridSettings() {
  const { gridRowDensity, setGridRowDensity, gridPageSize, setGridPageSize } =
    useAppStore();

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h3 className="text-[11px] font-medium text-secondary uppercase mb-1">
          Data Grid
        </h3>
        <p className="text-[12px] text-tertiary">
          Display settings for table and query result views.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-secondary">
          <span className="text-accent">
            <AlignJustify size={13} />
          </span>
          Row density
        </div>
        <div className="flex gap-2">
          {rowDensityValues.map((density) => (
            <DensityCard
              key={density}
              density={density}
              active={gridRowDensity === density}
              onClick={() => setGridRowDensity(density)}
            />
          ))}
        </div>
        <p className="text-[11px] text-tertiary">
          Takes effect when a table is next opened or queried.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-secondary">
          <span className="text-accent">
            <Table2 size={13} />
          </span>
          Rows per page
        </div>
        <div className="flex w-fit gap-1 rounded-[var(--radius-control)] bg-control p-1 shadow-[var(--shadow-hairline)]">
          {gridPageSizeValues.map((size: GridPageSize) => (
            <button
              key={size}
              type="button"
              onClick={() => setGridPageSize(size)}
              className={cn(
                "h-7 min-w-[2.5rem] rounded-[var(--radius-control)] px-2 text-[12px]",
                "transition-colors duration-[var(--motion-fast)]",
                gridPageSize === size
                  ? "bg-content text-label shadow-sm font-medium"
                  : "text-secondary hover:bg-subtle hover:text-label active:bg-active",
              )}
            >
              {size}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-tertiary">
          Number of rows fetched and displayed per page.
        </p>
      </div>
    </section>
  );
}
