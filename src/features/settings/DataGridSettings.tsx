import { SettingsSection, SettingSwitch } from "./SettingsSection";
import { useAppStore } from "../../store";
import { cn } from "../../lib/utils";
import {
  gridPageSizeValues,
  rowDensityValues,
  type GridPageSize,
  type RowDensity,
} from "./preferences";

const DENSITY_LABELS: Record<RowDensity, { label: string; rowClass: string }> = {
  compact: {
    label: "Compact",
    rowClass: "py-1",
  },
  comfortable: {
    label: "Comfortable",
    rowClass: "py-2.5",
  },
  spacious: {
    label: "Spacious",
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
  const { label, rowClass } = DENSITY_LABELS[density];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
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
            <span className="truncate font-mono text-[11px] text-secondary">
              {row}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-[13px] font-medium",
            active ? "text-accent" : "text-label",
          )}
        >
          {label}
        </span>
      </div>
    </button>
  );
}

export function DataGridSettings() {
  const { gridRowDensity, setGridRowDensity, gridPageSize, setGridPageSize, showTotalCount, setShowTotalCount } =
    useAppStore();

  return (
    <SettingsSection title="Data Grid">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-secondary">
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
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-secondary">
          Rows per page
        </div>
        <div className="flex w-fit gap-1 rounded-[var(--radius-control)] bg-control p-1 shadow-[var(--shadow-hairline)]">
          {gridPageSizeValues.map((size: GridPageSize) => (
            <button
              key={size}
              type="button"
              aria-pressed={gridPageSize === size}
              onClick={() => setGridPageSize(size)}
              className={cn(
                "h-7 min-w-[2.5rem] rounded-[var(--radius-control)] px-2 text-[13px]",
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
      </div>

      <div>
        <SettingSwitch label="Show total row count" checked={showTotalCount} onChange={setShowTotalCount} />
        <p className="text-[12px] text-tertiary">Counts can slow down large tables.</p>
      </div>
    </SettingsSection>
  );
}
