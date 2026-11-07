import { ChevronUp, ChevronDown, Filter } from "lucide-react";
import type { ResultColumn } from "./types";
import { ColumnLabel } from "../data-grid/ColumnLabel";
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
        "relative flex items-center gap-1 px-2 overflow-hidden select-none cursor-default hover:bg-hover group shrink-0 transition-colors",
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
      <ColumnLabel col={col}>
        {sortDir === "asc" && <ChevronUp size={12} className="shrink-0 text-accent" />}
        {sortDir === "desc" && <ChevronDown size={12} className="shrink-0 text-accent" />}
      </ColumnLabel>
      {/* Filter icon: accent when filtered, visible on hover when not */}
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onFilterClick(event); }}
        title={`Filter by ${col.name}`}
        className={cn(
          "shrink-0 p-1 rounded transition-colors",
          isFiltered
            ? "text-accent"
            : "text-tertiary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-accent",
        )}
      >
        <Filter size={11} />
      </button>
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
