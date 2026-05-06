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
import { ChevronUp, ChevronDown, Loader2, Filter, Database, Table2, KeyRound, Link, AlertCircle, RotateCw, RefreshCw } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import { ChevronDown as SelectChevron, Check } from "lucide-react";
import type { Tab } from "../../store";
import { useAppStore } from "../../store";
import { tableApi } from "./api";
import {
  type FilterOperator,
  type SortDirection,
  type ColumnFilter,
  type ResultColumn,
  type TypeFamily,
  OP_LABELS,
  getTypeFamily,
  getOperatorsForFamily,
  typeFamilyBadgeClass,
} from "./types";
import { cn } from "../../lib/utils";

const COL_WIDTH = 180;
const HEADER_HEIGHT = 36;

const ROW_HEIGHT_BY_DENSITY = {
  compact: 33,
  comfortable: 44,
  spacious: 56,
} as const;

// ─── CellValue ────────────────────────────────────────────────────────────────

function CellValue({
  value,
  family,
}: {
  value: string | null;
  family: TypeFamily;
}) {
  if (value === null) {
    return (
      <span className="inline-flex shrink-0 font-mono text-[9px] font-medium px-1.5 py-px rounded bg-control text-tertiary leading-none tracking-widest border border-separator/50">
        NULL
      </span>
    );
  }

  if (value === "") {
    return (
      <span className="inline-flex shrink-0 font-mono text-[9px] font-medium px-1.5 py-px rounded bg-control text-tertiary leading-none italic border border-separator/50">
        {'\'\''}
      </span>
    );
  }

  if (family === "boolean") {
    const isTrue =
      value === "t" || value.toLowerCase() === "true" || value === "1";
    return (
      <span
        className={cn(
          "inline-flex shrink-0 font-mono text-[9px] font-semibold px-1.5 py-px rounded leading-none tracking-wide",
          isTrue
            ? "bg-success/10 text-success"
            : "bg-control text-tertiary border border-separator/50",
        )}
      >
        {isTrue ? "true" : "false"}
      </span>
    );
  }

  if (family === "json") {
    const preview = value.length > 100 ? value.slice(0, 100) + "…" : value;
    return (
      <span className="font-mono text-[11px] text-data-json truncate block" title={value}>
        {preview}
      </span>
    );
  }

  if (family === "date") {
    return (
      <span className="font-mono text-xs text-label tabular-nums truncate block">
        {value}
      </span>
    );
  }

  if (family === "numeric") {
    return (
      <span className="font-mono text-xs text-label tabular-nums truncate block text-right w-full">
        {value}
      </span>
    );
  }

  // text / other — truncate very long values
  const display = value.length > 300 ? value.slice(0, 300) + "…" : value;
  return (
    <span
      className="text-xs text-label truncate block"
      title={value.length > 300 ? value : undefined}
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

// ─── ColumnHeaderCell ─────────────────────────────────────────────────────────

function ColumnHeaderCell({
  col,
  sortDir,
  isFiltered,
  onClick,
  onFilterClick,
}: {
  col: ResultColumn;
  sortDir: "asc" | "desc" | null;
  isFiltered: boolean;
  onClick: () => void;
  onFilterClick: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 select-none cursor-pointer hover:bg-hover group shrink-0 transition-colors",
        isFiltered && "bg-accent/5",
      )}
      style={{ width: COL_WIDTH, minWidth: COL_WIDTH, height: HEADER_HEIGHT }}
      onClick={onClick}
    >
      {col.isPrimaryKey && (
        <KeyRound size={10} className="text-schema-key shrink-0" aria-label="Primary key" />
      )}
      {col.isForeignKey && !col.isPrimaryKey && (
        <Link size={10} className="text-schema-foreign-key shrink-0" aria-label="Foreign key" />
      )}
      <span className="text-xs font-semibold text-label truncate flex-1 min-w-0">
        {col.name}
      </span>
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
  rowData: (string | null)[];
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

  const cellValue = rowData[colIdx] ?? null;
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
      obj[c.name] = rowData[i] ?? null;
    });
    navigator.clipboard.writeText(JSON.stringify(obj));
    onClose();
  };

  const copyCsv = () => {
    const csv = rowData
      .map((v) => {
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
        <span className="ml-auto font-mono text-tertiary text-[10px] pl-2 truncate max-w-[100px]">
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
          <span className="ml-auto font-mono text-tertiary text-[10px] truncate max-w-[80px]">
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
  const { setTabLoading, setTabError, gridPageSize, gridRowDensity, setLastAction, profiles, activeSessions } = useAppStore();
  const rowHeight = ROW_HEIGHT_BY_DENSITY[gridRowDensity];

  const connectionLabel = useMemo(() => {
    if (!sessionId) return null;
    const connId = Object.entries(activeSessions).find(([, s]) => s === sessionId)?.[0];
    return profiles.find((p) => p.id === connId)?.displayName ?? null;
  }, [sessionId, activeSessions, profiles]);

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

  const { data, isLoading, isFetching, error, refetch } = useQuery({
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
      tableApi.queryTable(sessionId!, {
        database: ctx!.database,
        schema: ctx!.schema,
        table: ctx!.table,
        filters: apiFilters,
        sortColumn: sortColumn ?? undefined,
        sortDirection: sortColumn ? sortDirection : undefined,
        page,
        pageSize: gridPageSize,
      }),
    enabled,
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
      rowCount: data.totalCount,
      timestamp: Date.now(),
    });
  }, [data, isLoading, ctx?.table, setLastAction]);

  useEffect(() => () => {
    setTabLoading(tab.id, false);
    setTabError(tab.id, false);
  }, [tab.id, setTabLoading, setTabError]);

  // ── Sorting ────────────────────────────────────────────────────────────────

  const handleSort = useCallback(
    (colName: string) => {
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
    [sortColumn, sortDirection],
  );

  // ── Virtualizer ────────────────────────────────────────────────────────────

  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const rows = data?.rows ?? [];
  const columns = useMemo(() => data?.columns ?? [], [data?.columns]);

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "c" && selectedCell && data) {
        e.preventDefault();
        const value = data.rows[selectedCell.row]?.[selectedCell.col];
        navigator.clipboard.writeText(value ?? "");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedCell, data]);

  // ── Cell context menu ──────────────────────────────────────────────────────

  const [cellMenu, setCellMenu] = useState<{
    rowData: (string | null)[];
    colIdx: number;
    x: number;
    y: number;
  } | null>(null);

  // ── Pagination helpers ─────────────────────────────────────────────────────

  const totalCount = data?.totalCount ?? 0;
  const pageSize = data?.pageSize ?? 200;
  const currentPage = data?.page ?? page;
  const start = currentPage * pageSize + 1;
  const end = Math.min(
    currentPage * pageSize + (data?.rows.length ?? 0),
    totalCount,
  );
  const hasPrev = currentPage > 0;
  const hasNext = end < totalCount;

  // ── Filter chip helpers ────────────────────────────────────────────────────

  const activeChips = apiFilters;
  const activeFilterCols = useMemo(
    () => new Set(apiFilters.map((f) => f.column)),
    [apiFilters],
  );

  const removeFilter = (col: string) => {
    setFilterDraft((prev) => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
  };

  const clearAllFilters = () => {
    setFilterDraft({});
  };

  // ── Filter popover state ───────────────────────────────────────────────────

  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const filterAnchorEl = useRef<Element | null>(null);

  const applyFilterEntry = useCallback(
    (colName: string, entry: FilterEntry | null) => {
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
    [],
  );

  const handleFilterByValue = useCallback(
    (colName: string, value: string | null) => {
      setFilterDraft((prev) => ({
        ...prev,
        [colName]: {
          operator: value === null ? "IsNull" : "Eq",
          value: value ?? "",
        },
      }));
    },
    [],
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

  const totalWidth = columns.length * COL_WIDTH;

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
            <span className="text-[11px] text-tertiary shrink-0 pl-1 border-l border-separator">
              {ctx.database}
            </span>
          )}
        </div>

        {/* Connection badge */}
        {connectionLabel && (
          <div className="flex items-center gap-1.5 text-xs text-secondary bg-control px-2 py-1 rounded shrink-0 max-w-[160px]">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                sessionId ? "bg-query-succeeded" : "bg-secondary opacity-40",
              )}
            />
            <span className="truncate">{connectionLabel}</span>
          </div>
        )}

        {/* Refresh button */}
        <button
          onClick={() => void refetch()}
          disabled={isLoading || isFetching}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors shrink-0",
            "text-secondary hover:bg-control hover:text-label active:bg-subtle",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
          title="Refresh table data (⌘R)"
        >
          <RefreshCw
            size={12}
            className={cn(isFetching && !isLoading && "animate-spin")}
          />
          <span>Refresh</span>
        </button>
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
                className="hover:text-destructive transition-colors ml-0.5 cursor-pointer"
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
              Retry
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
                    return (
                      <div
                        key={vr.key}
                        className={cn(
                          "flex divide-x divide-separator/50 border-b border-separator/50 hover:bg-subtle/60 transition-colors",
                          vr.index % 2 === 1 && "bg-subtle/30",
                        )}
                        style={{
                          position: "absolute",
                          top: vr.start,
                          height: rowHeight,
                          width: "100%",
                        }}
                      >
                        {columns.map((col, ci) => {
                          const family = getTypeFamily(col.dataType);
                          const isSelected =
                            selectedCell?.row === vr.index &&
                            selectedCell?.col === ci;
                          return (
                            <div
                              key={col.name}
                              className={cn(
                                "flex items-center px-2 overflow-hidden shrink-0 cursor-default",
                                isSelected &&
                                  "ring-2 ring-inset ring-accent/50 bg-accent/5",
                              )}
                              style={{
                                width: COL_WIDTH,
                                minWidth: COL_WIDTH,
                                height: rowHeight,
                              }}
                              onClick={() =>
                                setSelectedCell({ row: vr.index, col: ci })
                              }
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
                              <CellValue
                                value={rowData[ci] ?? null}
                                family={family}
                              />
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

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-separator bg-sidebar/50 text-xs text-secondary">
        <span>
          {data
            ? totalCount === 0
              ? "No rows"
              : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${totalCount.toLocaleString()} rows`
            : ""}
          {data && data.executionMs > 0 && (
            <span className="ml-2 text-secondary/60">{data.executionMs} ms</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={!hasPrev}
            className="px-2 py-0.5 rounded hover:bg-control disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
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
    </div>
  );
}
