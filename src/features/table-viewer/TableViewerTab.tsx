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
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import type { Tab } from "../../store";
import { tableApi } from "./api";
import {
  type FilterOperator,
  type SortDirection,
  type ColumnFilter,
  type ResultColumn,
  OP_LABELS,
  getTypeFamily,
  getOperatorsForFamily,
  typeFamilyBadgeClass,
} from "./types";
import { cn } from "../../lib/utils";

const COL_WIDTH = 180;
const ROW_HEIGHT = 33;
const HEADER_HEIGHT = 36;

// ─── CellValue ────────────────────────────────────────────────────────────────

function CellValue({ value }: { value: string | null }) {
  if (value === null) {
    return (
      <span className="font-mono text-[9px] font-medium px-1.5 py-px rounded bg-control text-tertiary leading-none tracking-wide">
        NULL
      </span>
    );
  }
  return (
    <span className="font-mono text-xs text-label truncate block">{value}</span>
  );
}

// ─── ColumnHeader ─────────────────────────────────────────────────────────────

function ColumnHeaderCell({
  col,
  sortDir,
  onClick,
}: {
  col: ResultColumn;
  sortDir: "asc" | "desc" | null;
  onClick: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2 select-none cursor-pointer hover:bg-control group shrink-0"
      style={{ width: COL_WIDTH, minWidth: COL_WIDTH, height: HEADER_HEIGHT }}
      onClick={onClick}
    >
      <span className="text-xs font-semibold text-label truncate flex-1 min-w-0">
        {col.name}
      </span>
      <span className={cn("text-[9px] font-mono px-1 py-px rounded shrink-0", typeFamilyBadgeClass(getTypeFamily(col.dataType)))}>
        {col.dataType}
      </span>
      {sortDir === "asc" && <ChevronUp size={12} className="text-accent shrink-0" />}
      {sortDir === "desc" && <ChevronDown size={12} className="text-accent shrink-0" />}
    </div>
  );
}

// ─── FilterInput ──────────────────────────────────────────────────────────────

interface FilterEntry {
  operator: FilterOperator;
  value: string;
}

function FilterInput({
  col,
  entry,
  onChange,
}: {
  col: ResultColumn;
  entry: FilterEntry | undefined;
  onChange: (e: FilterEntry) => void;
}) {
  const family = getTypeFamily(col.dataType);
  const ops = getOperatorsForFamily(family);
  const current: FilterEntry = entry ?? { operator: ops[0], value: "" };
  const noValue =
    current.operator === "IsNull" || current.operator === "IsNotNull";

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 rounded bg-control text-xs"
      style={{ minWidth: 200 }}
    >
      <span className="text-secondary font-medium shrink-0 truncate max-w-[70px]">
        {col.name}
      </span>
      <select
        value={current.operator}
        onChange={(e) =>
          onChange({ ...current, operator: e.target.value as FilterOperator })
        }
        className="bg-transparent text-label text-xs outline-none shrink-0 cursor-pointer"
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>
      {!noValue && (
        <input
          type="text"
          value={current.value}
          onChange={(e) => onChange({ ...current, value: e.target.value })}
          placeholder="value…"
          className="w-24 bg-transparent text-label text-xs outline-none placeholder:text-secondary min-w-0"
        />
      )}
    </div>
  );
}

// ─── RowContextMenu ───────────────────────────────────────────────────────────

function RowContextMenu({
  row,
  columns,
  x,
  y,
  onClose,
}: {
  row: (string | null)[];
  columns: ResultColumn[];
  x: number;
  y: number;
  onClose: () => void;
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

  const copyJson = () => {
    const obj: Record<string, string | null> = {};
    columns.forEach((c, i) => {
      obj[c.name] = row[i] ?? null;
    });
    navigator.clipboard.writeText(JSON.stringify(obj));
    onClose();
  };

  const copyCsv = () => {
    const csv = row
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

  return createPortal(
    <div
      className="fixed z-50 min-w-[180px] rounded-lg border border-separator bg-content shadow-2xl py-1"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={copyJson}
        className="flex w-full items-center px-3 py-1.5 text-xs text-label hover:bg-control transition-colors text-left"
      >
        Copy row as JSON
      </button>
      <button
        onClick={copyCsv}
        className="flex w-full items-center px-3 py-1.5 text-xs text-label hover:bg-control transition-colors text-left"
      >
        Copy row as CSV
      </button>
    </div>,
    document.body,
  );
}

// ─── TableViewerTab ───────────────────────────────────────────────────────────

export function TableViewerTab({ tab }: { tab: Tab }) {
  const { sessionId } = tab;
  const ctx = tab.tableContext;

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

  const { data, isLoading, isFetching, error } = useQuery({
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
        pageSize: 200,
      }),
    enabled,
    placeholderData: (prev) => prev,
  });

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
  const columns = data?.columns ?? [];

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_HEIGHT,
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

  // ── Row context menu ───────────────────────────────────────────────────────

  const [rowMenu, setRowMenu] = useState<{
    row: (string | null)[];
    x: number;
    y: number;
  } | null>(null);

  // ── Pagination helpers ─────────────────────────────────────────────────────

  const totalCount = data?.totalCount ?? 0;
  const pageSize = data?.pageSize ?? 200;
  const currentPage = data?.page ?? page;
  const start = currentPage * pageSize + 1;
  const end = Math.min(currentPage * pageSize + (data?.rows.length ?? 0), totalCount);
  const hasPrev = currentPage > 0;
  const hasNext = end < totalCount;

  // ── Filter chip helpers ────────────────────────────────────────────────────

  const activeChips = apiFilters;

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
      {/* Filter bar */}
      {columns.length > 0 && (
        <div className="shrink-0 border-b border-separator overflow-x-auto bg-sidebar/50">
          <div className="flex gap-1.5 px-2 py-1.5" style={{ minWidth: "max-content" }}>
            {columns.map((col) => (
              <FilterInput
                key={col.name}
                col={col}
                entry={filterDraft[col.name]}
                onChange={(e) =>
                  setFilterDraft((prev) => ({ ...prev, [col.name]: e }))
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-1 px-2 py-1 border-b border-separator bg-accent/5">
          {activeChips.map((f) => (
            <span
              key={f.column}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs"
            >
              <span className="font-medium">{f.column}</span>
              <span>{OP_LABELS[f.operator]}</span>
              {f.value !== undefined && (
                <span className="font-mono">'{f.value}'</span>
              )}
              <button
                onClick={() => removeFilter(f.column)}
                className="hover:text-destructive transition-colors ml-0.5"
              >
                ×
              </button>
            </span>
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
        {/* Fetching indicator */}
        {isFetching && !isLoading && (
          <div className="absolute top-0 right-0 z-20 p-1">
            <Loader2 size={12} className="text-accent animate-spin" />
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center flex-1 gap-2 text-secondary text-sm">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center justify-center flex-1 text-destructive text-sm px-6 text-center">
            {String(error)}
          </div>
        )}

        {/* Grid header */}
        {!isLoading && !error && data && (
          <>
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
                    onClick={() => handleSort(col.name)}
                  />
                ))}
              </div>
            </div>

            {/* Grid body */}
            <div
              ref={bodyRef}
              className="flex-1 overflow-auto"
              onScroll={syncHeader}
            >
              {rows.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-secondary text-sm">
                  {apiFilters.length > 0 ? "No rows match the active filters" : "No rows"}
                </div>
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
                          height: ROW_HEIGHT,
                          width: "100%",
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setRowMenu({
                            row: rowData,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                      >
                        {columns.map((col, ci) => (
                          <div
                            key={col.name}
                            className={cn(
                              "flex items-center px-2 overflow-hidden shrink-0 cursor-default",
                              selectedCell?.row === vr.index &&
                                selectedCell?.col === ci &&
                                "ring-2 ring-inset ring-accent/50 bg-accent/5",
                            )}
                            style={{ width: COL_WIDTH, minWidth: COL_WIDTH, height: ROW_HEIGHT }}
                            onClick={() =>
                              setSelectedCell({ row: vr.index, col: ci })
                            }
                          >
                            <CellValue value={rowData[ci] ?? null} />
                          </div>
                        ))}
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
          {data && (
            <span className="ml-2 text-secondary/60">
              ({data.executionMs} ms)
            </span>
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

      {/* Row context menu */}
      {rowMenu && (
        <RowContextMenu
          row={rowMenu.row}
          columns={columns}
          x={rowMenu.x}
          y={rowMenu.y}
          onClose={() => setRowMenu(null)}
        />
      )}
    </div>
  );
}
