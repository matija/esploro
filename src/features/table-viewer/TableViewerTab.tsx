import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronUp, ChevronDown, Loader2, Filter, Database, Table2, KeyRound, Link, AlertCircle, RotateCw, RefreshCw, ClipboardCopy, ClipboardCheck, Save, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ChevronDown as SelectChevron, Check } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { Tab } from "../../store";
import { useAppStore } from "../../store";
import { useToast } from "../../components/Toast";
import { tableApi } from "./api";
import { withSessionRetry } from "../../lib/sessionRetry";
import {
  type FilterOperator,
  type SortDirection,
  type ColumnFilter,
  type ResultColumn,
  type CellValue,
  type RowChange,
  type EditableKind,
  OP_LABELS,
  getTypeFamily,
  getOperatorsForFamily,
  typeFamilyBadgeClass,
  cellToString,
  detectEnumColumns,
  getEnumBadgeClass,
  editableKind,
} from "./types";
import { cn } from "../../lib/utils";

const COL_WIDTH = 180;
const HEADER_HEIGHT = 36;

const ROW_HEIGHT_BY_DENSITY = {
  compact: 33,
  comfortable: 44,
  spacious: 56,
} as const;

// ─── CellRenderer ────────────────────────────────────────────────────────────

function CellRenderer({ cell, isEnum = false }: { cell: CellValue; isEnum?: boolean }) {
  if (cell.t === "null") {
    return (
      <span className="inline-flex shrink-0 font-mono text-[9px] font-medium px-1.5 py-px rounded bg-control text-tertiary leading-none tracking-widest border border-separator/50">
        NULL
      </span>
    );
  }

  if (cell.t === "bool") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 font-mono text-[9px] font-semibold px-1.5 py-px rounded leading-none tracking-wide",
          cell.v
            ? "bg-success/10 text-success"
            : "bg-control text-tertiary border border-separator/50",
        )}
      >
        {cell.v ? "true" : "false"}
      </span>
    );
  }

  if (cell.t === "int" || cell.t === "float") {
    return (
      <span className="font-mono text-xs text-label tabular-nums truncate block text-right w-full">
        {String(cell.v)}
      </span>
    );
  }

  if (cell.t === "json") {
    const raw = JSON.stringify(cell.v);
    const preview = raw.length > 100 ? raw.slice(0, 100) + "…" : raw;
    return (
      <span className="font-mono text-[12px] text-data-json truncate block" title={raw}>
        {preview}
      </span>
    );
  }

  // text / other
  const raw = cell.v;
  if (raw === "") {
    return (
      <span className="inline-flex shrink-0 font-mono text-[9px] font-medium px-1.5 py-px rounded bg-control text-tertiary leading-none italic border border-separator/50">
        {"''"}
      </span>
    );
  }

  if (isEnum) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center text-[11px] font-medium px-2 py-0.5 rounded-full leading-none max-w-full",
          getEnumBadgeClass(raw),
        )}
        title={raw}
      >
        <span className="truncate">{raw}</span>
      </span>
    );
  }

  const display = raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
  return (
    <span
      className="text-xs text-label truncate block"
      title={raw.length > 300 ? raw : undefined}
    >
      {display}
    </span>
  );
}

// ─── SkeletonGrid ─────────────────────────────────────────────────────────────

const SKELETON_COL_WIDTHS = [140, 100, 80, 160, 120];
const SKELETON_ROW_WIDTHS = [
  [120, 80, 70, 140, 110],
  [100, 90, 60, 120, 100],
  [130, 70, 75, 150, 115],
  [110, 85, 65, 130, 105],
  [125, 75, 80, 145, 120],
  [95,  95, 70, 125,  90],
  [135, 80, 60, 155, 115],
  [115, 70, 75, 135, 100],
];

function SkeletonGrid() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="shrink-0 flex border-b-2 border-separator bg-sidebar overflow-x-hidden">
        <div className="flex divide-x divide-separator" style={{ minWidth: "100%" }}>
          {SKELETON_COL_WIDTHS.map((w, i) => (
            <div
              key={i}
              className="flex items-center px-2 shrink-0"
              style={{ width: COL_WIDTH, minWidth: COL_WIDTH, height: HEADER_HEIGHT }}
            >
              <div
                className="h-2.5 rounded bg-control animate-pulse"
                style={{ width: w }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {SKELETON_ROW_WIDTHS.map((widths, ri) => (
          <div
            key={ri}
            className={cn(
              "flex divide-x divide-separator/50 border-b border-separator/50",
              ri % 2 === 1 && "bg-subtle/30",
            )}
            style={{ height: ROW_HEIGHT_BY_DENSITY.compact }}
          >
            {SKELETON_COL_WIDTHS.map((_, ci) => (
              <div
                key={ci}
                className="flex items-center px-2 shrink-0"
                style={{ width: COL_WIDTH, minWidth: COL_WIDTH }}
              >
                <div
                  className="h-2 rounded bg-control animate-pulse"
                  style={{
                    width: widths[ci] ?? 80,
                    animationDelay: `${(ri * SKELETON_COL_WIDTHS.length + ci) * 30}ms`,
                  }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function RefreshButton({
  dataUpdatedAt,
  isFetching,
  isLoading,
  onRefresh,
}: {
  dataUpdatedAt: number;
  isFetching: boolean;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (dataUpdatedAt <= 0 || isFetching) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [dataUpdatedAt, isFetching]);

  const ageMs = dataUpdatedAt > 0 ? now - dataUpdatedAt : null;
  const isStale = ageMs !== null && ageMs > 30_000;
  const ageLabel = ageMs === null || isFetching
    ? null
    : ageMs < 60_000
      ? `${Math.floor(ageMs / 1000)}s ago`
      : `${Math.floor(ageMs / 60_000)}m ago`;

  return (
    <button
      onClick={onRefresh}
      disabled={isLoading || isFetching}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors shrink-0",
        isStale
          ? "text-label bg-control hover:bg-subtle active:bg-subtle"
          : "text-secondary hover:bg-control hover:text-label active:bg-subtle",
        "disabled:opacity-40 disabled:cursor-not-allowed",
      )}
      title="Refresh table data (⌘R)"
    >
      <RefreshCw
        size={12}
        className={cn(isFetching && !isLoading && "animate-spin")}
      />
      {ageLabel ? <span>{ageLabel}</span> : <span>Refresh</span>}
    </button>
  );
}

// ─── ColumnHeaderCell ─────────────────────────────────────────────────────────

function ColumnHeaderCell({
  col,
  width,
  sortDir,
  isFiltered,
  onClick,
  onFilterClick,
  onResizeStart,
  onContextMenu,
}: {
  col: ResultColumn;
  width: number;
  sortDir: "asc" | "desc" | null;
  isFiltered: boolean;
  onClick: () => void;
  onFilterClick: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-1.5 px-2 select-none cursor-default hover:bg-hover group shrink-0 transition-colors",
        isFiltered && "bg-accent/5",
      )}
      style={{ width, minWidth: width, height: HEADER_HEIGHT }}
      onClick={onClick}
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
        <span className="text-[8px] font-mono text-tertiary shrink-0 group-hover:hidden" title="Nullable">?</span>
      )}
      {/* Filter icon: accent when filtered, visible on hover when not */}
      <button
        onClick={onFilterClick}
        title={`Filter by ${col.name}`}
        className={cn(
          "shrink-0 p-0.5 rounded transition-colors",
          isFiltered
            ? "text-accent"
            : "text-tertiary opacity-0 group-hover:opacity-100 hover:text-accent",
        )}
      >
        <Filter size={9} />
      </button>
      <span
        className={cn(
          "text-[9px] font-mono px-1 py-px rounded shrink-0",
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
        className="absolute right-0 top-1 bottom-1 w-1 rounded-full opacity-0 group-hover:opacity-100 bg-separator hover:bg-accent/60 cursor-col-resize transition-opacity"
        onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e); }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── FilterEntry ─────────────────────────────────────────────────────────────

interface FilterEntry {
  operator: FilterOperator;
  value: string;
}

// ─── ColumnFilterPopover ─────────────────────────────────────────────────────

function ColumnFilterPopover({
  col,
  anchorEl,
  open,
  onOpenChange,
  entry,
  onApply,
}: {
  col: ResultColumn;
  anchorEl: Element | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: FilterEntry | undefined;
  onApply: (entry: FilterEntry | null) => void;
}) {
  const family = getTypeFamily(col.dataType);
  const ops = getOperatorsForFamily(family);
  const [draft, setDraft] = useState<FilterEntry>(
    entry ?? { operator: ops[0], value: "" },
  );

  // Sync draft when popover opens
  useEffect(() => {
    if (open) {
      setDraft(entry ?? { operator: ops[0], value: "" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Build a stable virtual ref wrapping the live anchor element
  const virtualRef = useRef({ getBoundingClientRect: () => anchorEl?.getBoundingClientRect() ?? new DOMRect() });
  useEffect(() => {
    virtualRef.current = { getBoundingClientRect: () => anchorEl?.getBoundingClientRect() ?? new DOMRect() };
  }, [anchorEl]);

  const noValue = draft.operator === "IsNull" || draft.operator === "IsNotNull";
  const hasExisting = !!entry;

  const apply = () => {
    onApply(draft);
    onOpenChange(false);
  };

  const clear = () => {
    onApply(null);
    onOpenChange(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor virtualRef={virtualRef} />
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          onEscapeKeyDown={() => onOpenChange(false)}
          onInteractOutside={() => onOpenChange(false)}
          className="z-50 w-64 rounded-[var(--radius-popover)] border border-separator bg-raised shadow-[var(--shadow-popover)] p-3 flex flex-col gap-2.5"
        >
          {/* Column name + type badge */}
          <div className="flex items-center gap-2 pb-1 border-b border-separator">
            <span className="text-xs font-semibold text-label truncate flex-1">{col.name}</span>
            <span className={cn("text-[9px] font-mono px-1 py-px rounded shrink-0", typeFamilyBadgeClass(family))}>
              {col.dataType}
            </span>
          </div>

          {/* Operator selector */}
          <Select.Root
            value={draft.operator}
            onValueChange={(v) => setDraft((d) => ({ ...d, operator: v as FilterOperator }))}
          >
            <Select.Trigger className="flex items-center justify-between w-full px-2 py-1.5 rounded-[var(--radius-control)] bg-control border border-separator text-xs text-label hover:bg-hover transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
              <Select.Value />
              <Select.Icon>
                <SelectChevron size={12} className="text-secondary" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content
                position="popper"
                sideOffset={4}
                className="z-[60] min-w-[var(--radix-select-trigger-width)] rounded-[var(--radius-popover)] border border-separator bg-raised shadow-[var(--shadow-popover)] py-1 text-xs"
              >
                <Select.Viewport>
                  {ops.map((op) => (
                    <Select.Item
                      key={op}
                      value={op}
                      className="flex items-center justify-between px-3 py-1.5 text-label hover:bg-hover cursor-default outline-none data-[highlighted]:bg-hover"
                    >
                      <Select.ItemText>{OP_LABELS[op]}</Select.ItemText>
                      <Select.ItemIndicator>
                        <Check size={10} className="text-accent" />
                      </Select.ItemIndicator>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>

          {/* Value input */}
          {!noValue && (
            <input
              type="text"
              value={draft.value}
              onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              placeholder="value…"
              autoFocus
              className="w-full px-2 py-1.5 rounded-[var(--radius-control)] bg-control border border-separator text-xs text-label placeholder:text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            />
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-0.5">
            <button
              onClick={apply}
              className="flex-1 px-2 py-1.5 rounded-[var(--radius-control)] bg-accent text-inverse text-xs font-medium hover:bg-accent-hover transition-colors"
            >
              Apply
            </button>
            {hasExisting && (
              <button
                onClick={clear}
                className="px-2 py-1.5 rounded-[var(--radius-control)] bg-control text-secondary text-xs hover:bg-hover hover:text-destructive transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── JsonArrayEditor ─────────────────────────────────────────────────────────

function JsonArrayEditor({
  kind,
  anchorEl,
  initialValue,
  onCommit,
  onCancel,
}: {
  kind: "json" | "array";
  anchorEl: Element | null;
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  const virtualRef = useRef({ getBoundingClientRect: () => anchorEl?.getBoundingClientRect() ?? new DOMRect() });
  useEffect(() => {
    virtualRef.current = { getBoundingClientRect: () => anchorEl?.getBoundingClientRect() ?? new DOMRect() };
  }, [anchorEl]);

  const validation = useMemo((): { ok: boolean; msg: string } => {
    if (draft.toLowerCase() === "null") return { ok: true, msg: "" };
    try {
      const parsed = JSON.parse(draft);
      if (kind === "array" && !Array.isArray(parsed)) {
        return { ok: false, msg: "Expected a JSON array" };
      }
      const count = kind === "array" && Array.isArray(parsed) ? ` — ${parsed.length} elements` : "";
      return { ok: true, msg: count };
    } catch (e) {
      return { ok: false, msg: e instanceof SyntaxError ? e.message : String(e) };
    }
  }, [draft, kind]);

  const format = () => {
    if (validation.ok && draft.toLowerCase() !== "null") {
      try {
        setDraft(JSON.stringify(JSON.parse(draft), null, 2));
      } catch { /* ignore */ }
    }
  };

  const commit = () => {
    if (!validation.ok) return;
    onCommit(draft);
  };

  return (
    <Popover.Root open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <Popover.Anchor virtualRef={virtualRef} />
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={2}
          onEscapeKeyDown={onCancel}
          onInteractOutside={commit}
          className="z-50 w-80 rounded-[var(--radius-popover)] border-2 border-[var(--ds-warning)] bg-raised shadow-[var(--shadow-popover)] flex flex-col gap-2 p-2"
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onCancel(); }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); commit(); }
            }}
            className="w-full font-mono text-xs text-label bg-control rounded-[var(--radius-control)] border border-separator p-2 resize-none outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            style={{ minHeight: 80, maxHeight: 240 }}
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex-1 text-[10px] font-mono truncate",
                validation.ok ? "text-success" : "text-query-failed",
              )}
            >
              {validation.ok ? `Valid${validation.msg}` : `Invalid: ${validation.msg}`}
            </span>
            <button
              onClick={format}
              disabled={!validation.ok || draft.toLowerCase() === "null"}
              className="px-2 py-0.5 rounded text-[10px] text-secondary hover:text-label hover:bg-control disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Format
            </button>
            <button
              onClick={commit}
              disabled={!validation.ok}
              className="px-2 py-0.5 rounded text-[10px] bg-accent text-inverse disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
            >
              OK
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── CellContextMenu ──────────────────────────────────────────────────────────

function CellContextMenu({
  rowData,
  columns,
  colIdx,
  x,
  y,
  onClose,
  onFilterByValue,
}: {
  rowData: CellValue[];
  columns: ResultColumn[];
  colIdx: number;
  x: number;
  y: number;
  onClose: () => void;
  onFilterByValue: (colName: string, value: string | null) => void;
}) {
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

  return createPortal(
    <div
      className="fixed z-50 min-w-[200px] rounded-[var(--radius-popover)] border border-separator bg-raised shadow-[var(--shadow-popover)] py-1"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={copyValue}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
      >
        <span className="font-medium">Copy Value</span>
        {cellValue === null && (
          <span className="ml-auto font-mono text-[9px] text-tertiary bg-control px-1 rounded border border-separator/50">
            NULL
          </span>
        )}
      </button>
      <button
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
        onClick={copyJson}
        className="flex w-full items-center px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
      >
        Copy Row as JSON
      </button>
      <button
        onClick={copyCsv}
        className="flex w-full items-center px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
      >
        Copy Row as CSV
      </button>
      <div className="my-1 border-t border-separator" />
      {cellValue !== null ? (
        <button
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
          onClick={filterByValue}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
        >
          <Filter size={10} className="text-secondary shrink-0" />
          Filter: IS NULL
        </button>
      )}
    </div>,
    document.body,
  );
}

// ─── TableViewerTab ───────────────────────────────────────────────────────────

export function TableViewerTab({ tab }: { tab: Tab }) {
  const { sessionId } = tab;
  const ctx = tab.tableContext;
  const {
    setTabLoading,
    setTabError,
    setTabDirty,
    gridPageSize,
    gridRowDensity,
    showTotalCount,
    setLastAction,
    profiles,
    activeSessions,
  } = useAppStore(
    useShallow((state) => ({
      setTabLoading: state.setTabLoading,
      setTabError: state.setTabError,
      setTabDirty: state.setTabDirty,
      gridPageSize: state.gridPageSize,
      gridRowDensity: state.gridRowDensity,
      showTotalCount: state.showTotalCount,
      setLastAction: state.setLastAction,
      profiles: state.profiles,
      activeSessions: state.activeSessions,
    })),
  );
  const { toast } = useToast();
  const rowHeight = ROW_HEIGHT_BY_DENSITY[gridRowDensity];
  const isView = ctx?.isView ?? false;

  // ── Inline editing state ───────────────────────────────────────────────────

  // rowIndex → colIndex → new value (null = SQL NULL)
  const [pendingEdits, setPendingEdits] = useState<Map<number, Map<number, string | null>>>(new Map());
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");
  const [jsonEditorCell, setJsonEditorCell] = useState<{ row: number; col: number } | null>(null);
  const jsonEditorAnchorRef = useRef<Element | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const hasPendingEdits = pendingEdits.size > 0;

  const totalPendingChanges = useMemo(() => {
    let count = 0;
    pendingEdits.forEach((colMap) => { count += colMap.size; });
    return count;
  }, [pendingEdits]);

  // Keep tab dirty flag in sync
  useEffect(() => {
    setTabDirty(tab.id, hasPendingEdits);
  }, [hasPendingEdits, tab.id, setTabDirty]);

  // Guard helper — returns true if safe to proceed, false if user cancelled
  const guardNavigation = useCallback((): boolean => {
    if (!hasPendingEdits) return true;
    return window.confirm("You have unsaved changes. Discard and continue?");
  }, [hasPendingEdits]);

  const discardEdits = useCallback(() => {
    setPendingEdits(new Map());
    setEditingCell(null);
    setJsonEditorCell(null);
  }, []);

  const commitEditDraft = useCallback((rowIdx: number, colIdx: number, draft: string, originalCell: CellValue) => {
    const normalised = draft.toLowerCase() === "null" ? null : draft;
    const originalStr = cellToString(originalCell);
    setPendingEdits((prev) => {
      const next = new Map(prev);
      const colMap = new Map(next.get(rowIdx) ?? []);
      if (normalised === originalStr) {
        // Reverting to original — drop the pending edit
        colMap.delete(colIdx);
        if (colMap.size === 0) {
          next.delete(rowIdx);
        } else {
          next.set(rowIdx, colMap);
        }
      } else {
        colMap.set(colIdx, normalised);
        next.set(rowIdx, colMap);
      }
      return next;
    });
  }, []);

  // Returns the pending edit value for a cell, if any. The outer null is "no pending edit";
  // an inner null is "pending edit = SQL NULL".
  const getPendingValue = useCallback(
    (rowIdx: number, colIdx: number): { has: false } | { has: true; value: string | null } => {
      const colMap = pendingEdits.get(rowIdx);
      if (!colMap || !colMap.has(colIdx)) return { has: false };
      return { has: true, value: colMap.get(colIdx) ?? null };
    },
    [pendingEdits],
  );

  const connectionLabel = useMemo(() => {
    if (!sessionId) return null;
    const connId = Object.entries(activeSessions).find(([, s]) => s === sessionId)?.[0];
    return profiles.find((p) => p.id === connId)?.displayName ?? null;
  }, [sessionId, activeSessions, profiles]);

  const driver = useMemo(() => {
    return profiles.find((p) => p.id === ctx?.connectionId)?.driver ?? "postgres";
  }, [profiles, ctx?.connectionId]);

  const [page, setPage] = useState(0);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("Asc");

  // Filter state: draft (immediate) → active (debounced, sent to API)
  const [filterDraft, setFilterDraft] = useState<Record<string, FilterEntry>>(
    {},
  );
  const [activeFilters, setActiveFilters] = useState<
    Record<string, FilterEntry>
  >({});

  useEffect(() => {
    const id = setTimeout(() => {
      setActiveFilters(filterDraft);
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [filterDraft]);

  const apiFilters = useMemo((): ColumnFilter[] => {
    return Object.entries(activeFilters)
      .filter(
        ([, f]) =>
          f.operator === "IsNull" ||
          f.operator === "IsNotNull" ||
          f.value.trim() !== "",
      )
      .map(([column, f]) => ({
        column,
        operator: f.operator,
        value:
          f.operator === "IsNull" || f.operator === "IsNotNull"
            ? undefined
            : f.value,
      }));
  }, [activeFilters]);

  const enabled = !!sessionId && !!ctx;

  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: [
      "table-viewer",
      sessionId,
      ctx?.database,
      ctx?.schema,
      ctx?.table,
      apiFilters,
      sortColumn,
      sortDirection,
      page,
    ],
    queryFn: () =>
      withSessionRetry(ctx!.connectionId, (sid) =>
        tableApi.queryTableData(sid, {
          database: ctx!.database,
          schema: ctx!.schema,
          table: ctx!.table,
          filters: apiFilters,
          sortColumn: sortColumn ?? undefined,
          sortDirection: sortColumn ? sortDirection : undefined,
          page,
          pageSize: gridPageSize,
        }),
        toast,
      ),
    enabled,
    placeholderData: (prev) => prev,
  });

  const countRequest = useMemo(() => ({
    database: ctx?.database ?? "",
    schema: ctx?.schema ?? "",
    table: ctx?.table ?? "",
    filters: apiFilters,
    page: 0,
    pageSize: gridPageSize,
  }), [ctx?.database, ctx?.schema, ctx?.table, apiFilters, gridPageSize]);

  const { data: countData } = useQuery({
    queryKey: [
      "table-viewer-count",
      sessionId,
      ctx?.database,
      ctx?.schema,
      ctx?.table,
      apiFilters,
    ],
    queryFn: () => withSessionRetry(ctx!.connectionId, (sid) => tableApi.queryTableCount(sid, countRequest), toast),
    enabled: enabled && showTotalCount,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  // Sync loading state into tab strip
  useEffect(() => {
    setTabLoading(tab.id, isLoading || isFetching);
  }, [isLoading, isFetching, tab.id, setTabLoading]);

  // Sync error state into tab strip
  useEffect(() => {
    setTabError(tab.id, !!error && !isLoading && !isFetching);
  }, [error, isLoading, isFetching, tab.id, setTabError]);

  // Report last action to status bar
  useEffect(() => {
    if (!data || isLoading) return;
    setLastAction({
      label: ctx?.table ? `${ctx.table}` : "Table loaded",
      durationMs: data.executionMs,
      rowCount: countData?.count,
      timestamp: Date.now(),
    });
  }, [data, isLoading, countData?.count, ctx?.table, setLastAction]);

  useEffect(() => () => {
    setTabLoading(tab.id, false);
    setTabError(tab.id, false);
  }, [tab.id, setTabLoading, setTabError]);

  // ── Sorting ────────────────────────────────────────────────────────────────

  const handleSort = useCallback(
    (colName: string) => {
      if (!guardNavigation()) return;
      discardEdits();
      if (sortColumn === colName) {
        if (sortDirection === "Asc") {
          setSortDirection("Desc");
        } else {
          setSortColumn(null);
          setSortDirection("Asc");
        }
      } else {
        setSortColumn(colName);
        setSortDirection("Asc");
      }
      setPage(0);
    },
    [sortColumn, sortDirection, guardNavigation, discardEdits],
  );

  // ── Virtualizer ────────────────────────────────────────────────────────────

  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const columns = useMemo(() => data?.columns ?? [], [data?.columns]);
  const ctids = useMemo(() => data?.ctids ?? [], [data?.ctids]);
  const enumCols = useMemo(() => detectEnumColumns(columns, rows), [columns, rows]);

  // MySQL requires a PK to edit any row. If none exists, nothing is editable.
  const hasTablePk = useMemo(() => columns.some((c) => c.isPrimaryKey), [columns]);

  const getColKind = useCallback(
    (dataType: string): EditableKind => {
      if (isView) return "none";
      if (driver === "mysql" && !hasTablePk) return "none";
      return editableKind(dataType, driver);
    },
    [isView, driver, hasTablePk],
  );

  const isColEditable = useCallback(
    (dataType: string): boolean => getColKind(dataType) !== "none",
    [getColKind],
  );

  // ── Edit lifecycle ─────────────────────────────────────────────────────────

  const startEdit = useCallback((rowIdx: number, colIdx: number, anchorEl?: Element | null) => {
    const col = columns[colIdx];
    if (!col) return;
    const kind = getColKind(col.dataType);
    if (kind === "none") return;
    const row = rows[rowIdx];
    if (!row) return;
    const pending = pendingEdits.get(rowIdx)?.get(colIdx);
    let initial: string;
    if (pending !== undefined) {
      initial = pending === null ? "NULL" : pending;
    } else {
      const cellStr = cellToString(row[colIdx] ?? { t: "null" });
      initial = cellStr ?? "NULL";
    }
    setSelectedCell({ row: rowIdx, col: colIdx });
    if (kind === "json" || kind === "array") {
      jsonEditorAnchorRef.current = anchorEl ?? null;
      setJsonEditorCell({ row: rowIdx, col: colIdx });
      setEditDraft(initial);
    } else {
      setEditDraft(initial);
      setEditingCell({ row: rowIdx, col: colIdx });
    }
  }, [columns, rows, getColKind, pendingEdits]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditDraft("");
    setJsonEditorCell(null);
  }, []);

  // Set to true by Tab/Shift+Tab handlers so the input's blur (fired when the
  // input unmounts as we move to a new cell) doesn't re-commit and clobber the
  // next-cell state.
  const skipNextBlurRef = useRef(false);

  // Focus the input when entering edit mode
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  const findNextEditableCol = useCallback(
    (fromCol: number, dir: 1 | -1): number | null => {
      let idx = fromCol + dir;
      while (idx >= 0 && idx < columns.length) {
        if (isColEditable(columns[idx].dataType)) return idx;
        idx += dir;
      }
      return null;
    },
    [columns, isColEditable],
  );

  // Commit the current draft and optionally move to a different cell.
  const commitAndAdvance = useCallback(
    (advance: "next" | "prev" | "none") => {
      if (!editingCell) return;
      const { row: rowIdx, col: colIdx } = editingCell;
      const original = rows[rowIdx]?.[colIdx] ?? { t: "null" as const };
      commitEditDraft(rowIdx, colIdx, editDraft, original);
      if (advance === "none") {
        setEditingCell(null);
        setEditDraft("");
        return;
      }
      const next = findNextEditableCol(colIdx, advance === "next" ? 1 : -1);
      if (next === null) {
        setEditingCell(null);
        setEditDraft("");
        return;
      }
      // The unmount of the current input fires a blur with a stale closure that
      // would otherwise call commitAndAdvance("none") and clear editingCell.
      skipNextBlurRef.current = true;
      // Prefill the next cell's draft synchronously so React batches the updates.
      const nextRow = rows[rowIdx];
      const pending = pendingEdits.get(rowIdx)?.get(next);
      const initial: string =
        pending !== undefined
          ? pending === null
            ? "NULL"
            : pending
          : (cellToString(nextRow?.[next] ?? { t: "null" }) ?? "NULL");
      setEditDraft(initial);
      setEditingCell({ row: rowIdx, col: next });
      setSelectedCell({ row: rowIdx, col: next });
    },
    [editingCell, editDraft, rows, commitEditDraft, findNextEditableCol, pendingEdits],
  );

  // ── Save handler ───────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!data || !ctx || pendingEdits.size === 0) return;
    setIsSaving(true);
    try {
      const pkCols = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
      const colIndexByName = new Map(columns.map((c, i) => [c.name, i]));
      const changes: RowChange[] = [];

      for (const [rowIdx, colMap] of pendingEdits.entries()) {
        const row = data.rows[rowIdx];
        if (!row) continue;

        const columnChanges = Array.from(colMap.entries()).map(([colIdx, value]) => ({
          column: columns[colIdx].name,
          value,
        }));
        if (columnChanges.length === 0) continue;

        if (pkCols.length > 0) {
          const pkConditions = pkCols.map((pkName) => {
            const pkColIdx = colIndexByName.get(pkName)!;
            // Use the original (un-edited) cell value for the WHERE clause.
            const cellStr = cellToString(row[pkColIdx] ?? { t: "null" });
            return { column: pkName, value: cellStr ?? "" };
          });
          changes.push({ pkConditions, columnChanges });
        } else {
          const ctid = ctids[rowIdx];
          if (!ctid) {
            throw new Error(
              `Row ${rowIdx + 1} has no primary key and no ctid — cannot update.`,
            );
          }
          changes.push({ pkConditions: [], ctid, columnChanges });
        }
      }

      await withSessionRetry(ctx.connectionId, (sid) =>
        tableApi.updateRows(sid, {
          schema: ctx.schema,
          table: ctx.table,
          changes,
        }),
        toast,
      );

      const n = totalPendingChanges;
      setPendingEdits(new Map());
      setEditingCell(null);
      setEditDraft("");
      toast(`Saved ${n} change${n === 1 ? "" : "s"}`, "success");
      await refetch();
    } catch (e) {
      toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setIsSaving(false);
    }
  }, [data, ctx, pendingEdits, columns, ctids, totalPendingChanges, toast, refetch]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const syncHeader = useCallback(() => {
    if (headerRef.current && bodyRef.current) {
      headerRef.current.scrollLeft = bodyRef.current.scrollLeft;
    }
  }, []);

  // ── Selected cell + keyboard copy ─────────────────────────────────────────

  const [selectedCell, setSelectedCell] = useState<{
    row: number;
    col: number;
  } | null>(null);

  const [copiedCell, setCopiedCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyCell = useCallback((row: number, col: number, rows: CellValue[][]) => {
    const cell = rows[row]?.[col];
    navigator.clipboard.writeText(cell ? (cellToString(cell) ?? "") : "");
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setCopiedCell({ row, col });
    copiedTimerRef.current = setTimeout(() => setCopiedCell(null), 1500);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't hijack copy while the user is editing an input/textarea/contenteditable.
      const target = e.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isTyping) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "c" && selectedCell && data) {
        e.preventDefault();
        copyCell(selectedCell.row, selectedCell.col, data.rows);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedCell, data, copyCell]);

  // ── Cell context menu ──────────────────────────────────────────────────────

  const [cellMenu, setCellMenu] = useState<{
    rowData: CellValue[];
    colIdx: number;
    x: number;
    y: number;
  } | null>(null);

  // ── Column widths ──────────────────────────────────────────────────────────

  const colWidthsKey = ctx
    ? `esploro-col-widths:${ctx.connectionId}:${ctx.database}:${ctx.schema}:${ctx.table}`
    : null;

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (!ctx) return {};
    const key = `esploro-col-widths:${ctx.connectionId}:${ctx.database}:${ctx.schema}:${ctx.table}`;
    try {
      const stored = localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (!colWidthsKey || Object.keys(colWidths).length === 0) return;
    try { localStorage.setItem(colWidthsKey, JSON.stringify(colWidths)); } catch { /* ignore */ }
  }, [colWidths, colWidthsKey]);

  const dragRef = useRef<{ colName: string; startX: number; startWidth: number } | null>(null);

  const handleResizeMouseDown = useCallback((colName: string, e: React.MouseEvent) => {
    e.preventDefault();
    const startWidth = colWidths[colName] ?? COL_WIDTH;
    dragRef.current = { colName, startX: e.clientX, startWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const newWidth = Math.max(60, dragRef.current.startWidth + delta);
      setColWidths((prev) => ({ ...prev, [dragRef.current!.colName]: newWidth }));
    };

    const onMouseUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [colWidths]);

  // ── Header context menu ────────────────────────────────────────────────────

  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!headerMenu) return;
    const close = () => setHeaderMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [headerMenu]);

  const resetColWidths = useCallback(() => {
    setColWidths({});
    if (colWidthsKey) {
      try { localStorage.removeItem(colWidthsKey); } catch { /* ignore */ }
    }
    setHeaderMenu(null);
  }, [colWidthsKey]);

  // ── Pagination helpers ─────────────────────────────────────────────────────

  const totalCount = showTotalCount
    ? (countData?.count ?? null)
    : (ctx?.estimatedRows ?? null);
  const isEstimate = showTotalCount ? (countData?.isEstimate ?? false) : true;
  const pageSize = data?.pageSize ?? 200;
  const currentPage = data?.page ?? page;
  const start = currentPage * pageSize + 1;
  const end = currentPage * pageSize + (data?.rows.length ?? 0);
  const hasPrev = currentPage > 0;
  const hasNext = totalCount !== null ? end < totalCount : (data?.rows.length ?? 0) >= pageSize;

  // ── Filter chip helpers ────────────────────────────────────────────────────

  const activeChips = apiFilters;
  const activeFilterCols = useMemo(
    () => new Set(apiFilters.map((f) => f.column)),
    [apiFilters],
  );

  const removeFilter = (col: string) => {
    if (!guardNavigation()) return;
    discardEdits();
    setFilterDraft((prev) => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
  };

  const clearAllFilters = () => {
    if (!guardNavigation()) return;
    discardEdits();
    setFilterDraft({});
  };

  // ── Filter popover state ───────────────────────────────────────────────────

  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const filterAnchorEl = useRef<Element | null>(null);

  const applyFilterEntry = useCallback(
    (colName: string, entry: FilterEntry | null) => {
      if (!guardNavigation()) return;
      discardEdits();
      setFilterDraft((prev) => {
        const next = { ...prev };
        if (entry === null) {
          delete next[colName];
        } else {
          next[colName] = entry;
        }
        return next;
      });
    },
    [guardNavigation, discardEdits],
  );

  const handleFilterByValue = useCallback(
    (colName: string, value: string | null) => {
      if (!guardNavigation()) return;
      discardEdits();
      setFilterDraft((prev) => ({
        ...prev,
        [colName]: {
          operator: value === null ? "IsNull" : "Eq",
          value: value ?? "",
        },
      }));
    },
    [guardNavigation, discardEdits],
  );

  // ⌘F: open filter popover for sorted column or first column
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && columns.length > 0) {
        e.preventDefault();
        const target = sortColumn ?? columns[0].name;
        setOpenFilterCol(target);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [columns, sortColumn]);

  const totalWidth = useMemo(
    () => columns.reduce((sum, col) => sum + (colWidths[col.name] ?? COL_WIDTH), 0),
    [columns, colWidths],
  );

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!ctx || !sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-secondary text-sm">
        No table context
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden text-label">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 h-9 bg-sidebar border-b border-separator shrink-0">
        {/* Object icon + schema-qualified name */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="shrink-0 text-schema-table">
            <Table2 size={13} />
          </span>
          <span className="text-xs truncate">
            {ctx.schema && (
              <span className="text-secondary">{ctx.schema}<span className="mx-0.5 text-tertiary">.</span></span>
            )}
            <span className="text-label font-medium">{ctx.table}</span>
          </span>
          {ctx.database && (
            <span className="text-[12px] text-tertiary shrink-0 pl-1 border-l border-separator">
              {ctx.database}
            </span>
          )}
        </div>

        {/* Connection badge */}
        {connectionLabel && (
          <div className="flex items-center gap-1.5 text-xs text-secondary bg-control px-2 py-1 rounded shrink-0 max-w-[220px]">
            <span
              className="rounded-full shrink-0"
              style={{
                width: 9,
                height: 9,
                backgroundColor:
                  error instanceof Error && error.message.includes("Could not reconnect")
                    ? 'var(--ds-warning)'
                    : sessionId ? 'var(--ds-success)' : 'var(--border-default)',
              }}
            />
            <span className="truncate">{connectionLabel}</span>
            <span className="shrink-0 text-tertiary text-[11px]">
              {error instanceof Error && error.message.includes("Could not reconnect") ? "Disconnected" : "Connected"}
            </span>
          </div>
        )}

        <RefreshButton
          dataUpdatedAt={dataUpdatedAt}
          isFetching={isFetching}
          isLoading={isLoading}
          onRefresh={() => {
            if (!guardNavigation()) return;
            discardEdits();
            void refetch();
          }}
        />
      </div>

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-1 px-2 py-1 border-b border-separator bg-accent/5">
          {activeChips.map((f) => (
            <button
              key={f.column}
              onClick={(e) => {
                filterAnchorEl.current = e.currentTarget;
                setOpenFilterCol(f.column);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors"
            >
              <span className="font-medium">{f.column}</span>
              <span>{OP_LABELS[f.operator]}</span>
              {f.value !== undefined && (
                <span className="font-mono">'{f.value}'</span>
              )}
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); removeFilter(f.column); }}
                className="hover:text-destructive transition-colors ml-0.5 cursor-default"
              >
                ×
              </span>
            </button>
          ))}
          <button
            onClick={clearAllFilters}
            className="text-xs text-secondary hover:text-destructive transition-colors ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Grid area */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden relative">
        {/* Refetch indicator */}
        {isFetching && !isLoading && (
          <div className="absolute top-0 right-0 z-20 p-1">
            <Loader2 size={12} className="text-accent animate-spin" />
          </div>
        )}

        {/* Skeleton while loading */}
        {isLoading && <SkeletonGrid />}

        {/* Error */}
        {!isLoading && error && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 py-12">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-query-failed/10">
              <AlertCircle size={20} className="text-query-failed" />
            </div>
            <div className="text-center space-y-1 max-w-md">
              <p className="text-sm font-medium text-label">
                Failed to load table data
              </p>
              <p className="text-xs text-secondary leading-relaxed">
                {error instanceof Error ? error.message : String(error)}
              </p>
            </div>
            <button
              onClick={() => void refetch()}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-control)] text-xs",
                "bg-control text-secondary shadow-[var(--shadow-hairline)]",
                "hover:bg-subtle hover:text-label active:bg-active transition-colors duration-[var(--motion-fast)]",
              )}
            >
              <RotateCw size={12} />
              {error instanceof Error && error.message.includes("Could not reconnect") ? "Reconnect" : "Retry"}
            </button>
          </div>
        )}

        {/* Grid */}
        {!isLoading && !error && data && (
          <>
            {/* Header */}
            <div
              ref={headerRef}
              className="shrink-0 flex border-b-2 border-separator bg-sidebar overflow-x-hidden"
              style={{ minWidth: "100%" }}
            >
              <div
                className="flex divide-x divide-separator"
                style={{ width: Math.max(totalWidth, 1), minWidth: "100%" }}
              >
                {columns.map((col) => (
                  <ColumnHeaderCell
                    key={col.name}
                    col={col}
                    width={colWidths[col.name] ?? COL_WIDTH}
                    sortDir={
                      sortColumn === col.name
                        ? sortDirection === "Asc"
                          ? "asc"
                          : "desc"
                        : null
                    }
                    isFiltered={activeFilterCols.has(col.name)}
                    onClick={() => handleSort(col.name)}
                    onFilterClick={(e) => {
                      e.stopPropagation();
                      filterAnchorEl.current = e.currentTarget;
                      setOpenFilterCol((prev) =>
                        prev === col.name ? null : col.name,
                      );
                    }}
                    onResizeStart={(e) => handleResizeMouseDown(col.name, e)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setHeaderMenu({ x: e.clientX, y: e.clientY });
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Body */}
            <div
              ref={bodyRef}
              className="flex-1 overflow-auto"
              onScroll={syncHeader}
            >
              {rows.length === 0 ? (
                apiFilters.length > 0 ? (
                  /* Filtered-empty state */
                  <div className="flex flex-col items-center justify-center h-full gap-2 py-12">
                    <Filter size={24} className="text-tertiary mb-1" />
                    <p className="text-sm font-medium text-label">
                      No rows match these filters
                    </p>
                    <p className="text-xs text-secondary">
                      {apiFilters.length === 1
                        ? "1 active filter"
                        : `${apiFilters.length} active filters`}
                    </p>
                    <button
                      onClick={clearAllFilters}
                      className="mt-1 text-xs text-accent hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  /* Empty table state */
                  <div className="flex flex-col items-center justify-center h-full gap-2 py-12">
                    <Database size={24} className="text-tertiary mb-1" />
                    <p className="text-sm font-medium text-label">
                      This table is empty
                    </p>
                    <p className="text-xs text-secondary">
                      No rows have been inserted yet
                    </p>
                  </div>
                )
              ) : (
                <div
                  style={{
                    height: rowVirtualizer.getTotalSize(),
                    width: Math.max(totalWidth, 1),
                    minWidth: "100%",
                    position: "relative",
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((vr) => {
                    const rowData = rows[vr.index];
                    const rowHasEdits = pendingEdits.has(vr.index);
                    return (
                      <div
                        key={vr.key}
                        className={cn(
                          "flex divide-x divide-separator/50 border-b border-separator/50 hover:bg-subtle/60 transition-colors",
                          vr.index % 2 === 1 && "bg-subtle/30",
                          rowHasEdits &&
                            "bg-[color-mix(in_srgb,var(--ds-warning)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--ds-warning)_12%,transparent)] border-l-4 border-l-[var(--ds-warning)]",
                        )}
                        style={{
                          position: "absolute",
                          top: vr.start,
                          height: rowHeight,
                          width: "100%",
                        }}
                      >
                        {columns.map((col, ci) => {
                          const isSelected =
                            selectedCell?.row === vr.index &&
                            selectedCell?.col === ci;
                          const isEditing =
                            editingCell?.row === vr.index &&
                            editingCell?.col === ci;
                          const pending = getPendingValue(vr.index, ci);
                          const isEdited = pending.has;
                          const editable = isColEditable(col.dataType);
                          // Cell to render: pending edit overrides original
                          const displayCell: CellValue = isEdited
                            ? pending.value === null
                              ? { t: "null" }
                              : { t: "text", v: pending.value }
                            : rowData[ci] ?? { t: "null" };
                          return (
                            <div
                              key={col.name}
                              className={cn(
                                "relative flex items-center px-2 overflow-hidden shrink-0 cursor-default",
                                isSelected &&
                                  !isEdited &&
                                  "ring-2 ring-inset ring-accent/50 bg-accent/5",
                                isEdited &&
                                  "ring-2 ring-inset ring-[var(--ds-warning)] bg-[color-mix(in_srgb,var(--ds-warning)_15%,transparent)]",
                                !editable && "cursor-not-allowed",
                              )}
                              style={{
                                width: colWidths[col.name] ?? COL_WIDTH,
                                minWidth: colWidths[col.name] ?? COL_WIDTH,
                                height: rowHeight,
                              }}
                              onClick={() =>
                                setSelectedCell({ row: vr.index, col: ci })
                              }
                              onDoubleClick={(e) => {
                                if (editable) startEdit(vr.index, ci, e.currentTarget);
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedCell({ row: vr.index, col: ci });
                                setCellMenu({
                                  rowData,
                                  colIdx: ci,
                                  x: e.clientX,
                                  y: e.clientY,
                                });
                              }}
                            >
                              {isEditing ? (
                                <input
                                  ref={editInputRef}
                                  type="text"
                                  value={editDraft}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelEdit();
                                    } else if (e.key === "Enter") {
                                      e.preventDefault();
                                      commitAndAdvance("none");
                                    } else if (e.key === "Tab") {
                                      e.preventDefault();
                                      commitAndAdvance(e.shiftKey ? "prev" : "next");
                                    }
                                  }}
                                  onBlur={() => {
                                    // Tab handoff: the just-unmounting input fires blur, but
                                    // the next-cell edit is already set up — don't clobber it.
                                    if (skipNextBlurRef.current) {
                                      skipNextBlurRef.current = false;
                                      return;
                                    }
                                    // Otherwise, commit on blur so clicking another cell
                                    // or button persists what the user typed.
                                    commitAndAdvance("none");
                                  }}
                                  className="w-full bg-transparent text-xs text-label outline-none font-mono"
                                />
                              ) : (
                                <CellRenderer
                                  cell={displayCell}
                                  isEnum={!isEdited && enumCols.has(ci)}
                                />
                              )}
                              {isSelected && !isEditing && (
                                <button
                                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-secondary hover:text-primary transition-colors cursor-default"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyCell(vr.index, ci, data!.rows);
                                  }}
                                  tabIndex={-1}
                                >
                                  {copiedCell?.row === vr.index && copiedCell?.col === ci
                                    ? <ClipboardCheck size={12} className="text-accent" />
                                    : <ClipboardCopy size={12} />}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Save / Discard bar — visible only when there are pending edits */}
      {hasPendingEdits && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-t border-[var(--ds-warning)]/40 bg-[color-mix(in_srgb,var(--ds-warning)_10%,transparent)] text-xs">
          <span className="text-label font-medium">
            {totalPendingChanges} unsaved change{totalPendingChanges === 1 ? "" : "s"}
            {pendingEdits.size > 1 && (
              <span className="text-secondary"> in {pendingEdits.size} rows</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={discardEdits}
              disabled={isSaving}
              className="px-3 py-1 rounded-[var(--radius-control)] text-secondary hover:text-label hover:bg-control transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="inline-flex items-center gap-1.5"><X size={12} /> Discard</span>
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="px-3 py-1 rounded-[var(--radius-control)] bg-accent text-inverse font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="inline-flex items-center gap-1.5">
                {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {isSaving ? "Saving…" : "Save"}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-separator bg-sidebar/50 text-xs text-secondary">
        <span>
          {data
            ? totalCount === 0
              ? "No rows"
              : totalCount === null
                ? `Showing ${start.toLocaleString()}–${end.toLocaleString()} rows`
                : isEstimate
                  ? `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ~${totalCount.toLocaleString()} rows`
                  : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${totalCount.toLocaleString()} rows`
            : ""}
          {data && data.executionMs > 0 && (
            <span className="ml-2 text-secondary/60">{data.executionMs} ms</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (!guardNavigation()) return;
              discardEdits();
              setPage((p) => Math.max(0, p - 1));
            }}
            disabled={!hasPrev}
            className="px-2 py-0.5 rounded hover:bg-control disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <button
            onClick={() => {
              if (!guardNavigation()) return;
              discardEdits();
              setPage((p) => p + 1);
            }}
            disabled={!hasNext}
            className="px-2 py-0.5 rounded hover:bg-control disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Column filter popover (single shared instance) */}
      {openFilterCol !== null && (() => {
        const filterCol = columns.find((c) => c.name === openFilterCol);
        if (!filterCol) return null;
        return (
          <ColumnFilterPopover
            col={filterCol}
            anchorEl={filterAnchorEl.current}
            open={true}
            onOpenChange={(o) => { if (!o) setOpenFilterCol(null); }}
            entry={filterDraft[openFilterCol]}
            onApply={(entry) => applyFilterEntry(openFilterCol, entry)}
          />
        );
      })()}

      {/* JSON / Array inline editor popover */}
      {jsonEditorCell !== null && (() => {
        const col = columns[jsonEditorCell.col];
        if (!col) return null;
        const kind = getColKind(col.dataType);
        if (kind !== "json" && kind !== "array") return null;
        return (
          <JsonArrayEditor
            kind={kind}
            anchorEl={jsonEditorAnchorRef.current}
            initialValue={editDraft}
            onCommit={(value) => {
              const original = rows[jsonEditorCell.row]?.[jsonEditorCell.col] ?? { t: "null" as const };
              commitEditDraft(jsonEditorCell.row, jsonEditorCell.col, value, original);
              setJsonEditorCell(null);
              setEditDraft("");
            }}
            onCancel={() => {
              setJsonEditorCell(null);
              setEditDraft("");
            }}
          />
        );
      })()}

      {/* Cell context menu */}
      {cellMenu && (
        <CellContextMenu
          rowData={cellMenu.rowData}
          columns={columns}
          colIdx={cellMenu.colIdx}
          x={cellMenu.x}
          y={cellMenu.y}
          onClose={() => setCellMenu(null)}
          onFilterByValue={handleFilterByValue}
        />
      )}

      {/* Header context menu */}
      {headerMenu && createPortal(
        <div
          className="fixed z-50 min-w-[180px] rounded-[var(--radius-popover)] border border-separator bg-raised shadow-[var(--shadow-popover)] py-1"
          style={{ left: headerMenu.x, top: headerMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={resetColWidths}
            className="flex w-full items-center px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors text-left"
          >
            Reset column widths
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
