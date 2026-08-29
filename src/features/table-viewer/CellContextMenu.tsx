import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Copy, Filter, Trash2 } from "lucide-react";
import type { CellValue, ResultColumn } from "./types";
import { cellToString } from "./types";
import { useClampedMenuPosition } from "./useClampedMenuPosition";

export function CellContextMenu({
  rowData,
  columns,
  colIdx,
  x,
  y,
  rowIdx,
  onClose,
  onFilterByValue,
  onDeleteRow,
  onDuplicateRow,
  canDelete,
}: {
  rowData: CellValue[];
  columns: ResultColumn[];
  colIdx: number;
  x: number;
  y: number;
  rowIdx: number;
  onClose: () => void;
  onFilterByValue: (colName: string, value: string | null) => void;
  onDeleteRow: () => void;
  onDuplicateRow: (rowIdx: number) => void;
  canDelete: boolean;
}) {
  const { ref: menuRef, pos } = useClampedMenuPosition(x, y);

  useEffect(() => {
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const rawCell = rowData[colIdx] ?? { t: "null" as const };
  const cellValue = cellToString(rawCell);
  const colName = columns[colIdx]?.name ?? "";

  const copyValue = () => {
    navigator.clipboard.writeText(cellValue ?? "");
    onClose();
  };

  const copyColName = () => {
    navigator.clipboard.writeText(colName);
    onClose();
  };

  const copyJson = () => {
    const obj: Record<string, string | null> = {};
    columns.forEach((c, i) => {
      obj[c.name] = cellToString(rowData[i] ?? { t: "null" });
    });
    navigator.clipboard.writeText(JSON.stringify(obj));
    onClose();
  };

  const copyCsv = () => {
    const csv = rowData
      .map((cell) => {
        const v = cellToString(cell);
        if (v === null) return "";
        if (v.includes(",") || v.includes('"') || v.includes("\n")) {
          return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      })
      .join(",");
    navigator.clipboard.writeText(csv);
    onClose();
  };

  const filterByValue = () => {
    onFilterByValue(colName, cellValue);
    onClose();
  };

  const deleteRow = () => {
    if (!canDelete) return;
    onDeleteRow();
    onClose();
  };

  const duplicateRow = () => {
    onDuplicateRow(rowIdx);
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] rounded-[var(--radius-popover)] border border-separator bg-raised shadow-[var(--shadow-popover)] py-1"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={copyValue}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
      >
        <span className="font-medium">Copy Value</span>
        {cellValue === null && (
          <span className="ml-auto font-mono text-[10px] text-tertiary bg-control px-1 rounded border border-separator/50">
            NULL
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={copyColName}
        className="flex w-full items-center px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
      >
        Copy Column Name
        <span className="ml-auto font-mono text-tertiary text-[11px] pl-2 truncate max-w-[100px]">
          {colName}
        </span>
      </button>
      <div className="my-1 border-t border-separator" />
      <button
        type="button"
        onClick={copyJson}
        className="flex w-full items-center px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
      >
        Copy Row as JSON
      </button>
      <button
        type="button"
        onClick={copyCsv}
        className="flex w-full items-center px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
      >
        Copy Row as CSV
      </button>
      <div className="my-1 border-t border-separator" />
      {cellValue !== null ? (
        <button
          type="button"
          onClick={filterByValue}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
        >
          <Filter size={10} className="text-secondary shrink-0" />
          <span>Filter by this value</span>
          <span className="ml-auto font-mono text-tertiary text-[11px] truncate max-w-[80px]">
            {cellValue.length > 20 ? cellValue.slice(0, 20) + "…" : cellValue}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={filterByValue}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
        >
          <Filter size={10} className="text-secondary shrink-0" />
          Filter: IS NULL
        </button>
      )}
      <div className="my-1 border-t border-separator" />
      <button
        type="button"
        onClick={duplicateRow}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
      >
        <Copy size={10} className="text-secondary shrink-0" />
        <span>Duplicate row</span>
      </button>
      <button
        type="button"
        onClick={deleteRow}
        disabled={!canDelete}
        title={canDelete ? undefined : "Cannot delete: no primary key or ctid"}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-query-failed hover:bg-hover transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <Trash2 size={10} className="shrink-0" />
        <span>Delete row…</span>
      </button>
    </div>,
    document.body,
  );
}
