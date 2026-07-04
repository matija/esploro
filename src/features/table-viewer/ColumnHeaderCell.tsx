import { ChevronUp, ChevronDown, Filter, KeyRound, Link } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  type ResultColumn,
  getTypeFamily,
  typeFamilyBadgeClass,
} from "./types";
import { cn } from "../../lib/utils";
import { HEADER_HEIGHT } from "../data-grid/constants";

export function ColumnHeaderCell({
  col,
  width,
  sortDir,
  isFiltered,
  ariaColIndex,
  onClick,
  onFilterClick,
  onResizeStart,
  onContextMenu,
}: {
  col: ResultColumn;
  width: number;
  sortDir: "asc" | "desc" | null;
  isFiltered: boolean;
  ariaColIndex?: number;
  onClick: () => void;
  onFilterClick: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      role="columnheader"
      aria-colindex={ariaColIndex}
      aria-sort={
        sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : undefined
      }
      tabIndex={-1}
      className={cn(
        "relative flex items-center gap-1.5 px-2 select-none cursor-default hover:bg-hover group shrink-0 transition-colors",
        isFiltered && "bg-accent/5",
      )}
      style={{ width, minWidth: width, height: HEADER_HEIGHT }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onContextMenu={onContextMenu}
    >
      {col.isPrimaryKey && (
        <KeyRound size={10} className="text-schema-key shrink-0" aria-label="Primary key" />
      )}
      {col.isForeignKey && !col.isPrimaryKey && (
        <Link size={10} className="text-schema-foreign-key shrink-0" aria-label="Foreign key" />
      )}
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="text-xs font-semibold text-label truncate flex-1 min-w-0">
            {col.name}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            sideOffset={4}
            className="z-50 px-2 py-1 rounded-[var(--radius-control)] border border-separator bg-raised shadow-[var(--shadow-popover)] text-xs text-label font-mono"
          >
            {col.name}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      {col.isNullable && (
        <span className="text-[10px] font-mono text-tertiary shrink-0" title="Nullable">?</span>
      )}
      {/* Filter icon: accent when filtered, visible on hover when not */}
      <button
        type="button"
        onClick={onFilterClick}
        title={`Filter by ${col.name}`}
        className={cn(
          "shrink-0 p-1 rounded transition-colors",
          isFiltered
            ? "text-accent"
            : "text-tertiary opacity-0 group-hover:opacity-100 hover:text-accent",
        )}
      >
        <Filter size={11} />
      </button>
      <span
        className={cn(
          "text-[10px] font-mono px-1 py-px rounded shrink-0",
          typeFamilyBadgeClass(getTypeFamily(col.dataType)),
        )}
      >
        {col.dataType}
      </span>
      {sortDir === "asc" && (
        <ChevronUp size={12} className="text-accent shrink-0" />
      )}
      {sortDir === "desc" && (
        <ChevronDown size={12} className="text-accent shrink-0" />
      )}
      {/* Resize handle */}
      <div
        role="separator"
        aria-label="Resize column"
        tabIndex={-1}
        className="absolute right-0 top-1 bottom-1 w-1 rounded-full opacity-0 group-hover:opacity-100 bg-separator hover:bg-accent/60 cursor-col-resize transition-opacity"
        onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e); }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
          }
        }}
      />
    </div>
  );
}
