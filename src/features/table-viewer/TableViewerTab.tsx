import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Filter, Database, Table2, AlertCircle, RotateCw, ClipboardCopy, ClipboardCheck, Save, X, FileCode2, Play } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { Tab } from "../../store";
import { useAppStore } from "../../store";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/ConfirmDialog";
import { tableApi } from "./api";
import { withSessionRetry } from "../../lib/sessionRetry";
import {
  type SortDirection,
  type ColumnFilter,
  type CellValue,
  type RowChange,
  type DeleteRowRequest,
  type EditableKind,
  OP_LABELS,
  cellToString,
  detectEnumColumns,
  editableKind,
  getIdentifierFirstColumnIndexes,
} from "./types";
import { cn } from "../../lib/utils";
import { CellRenderer } from "../data-grid/CellRenderer";
import type { MiniSqlEditorHandle } from "../query-editor/MiniSqlEditor";

const MiniSqlEditor = lazy(() =>
  import("../query-editor/MiniSqlEditor").then((m) => ({ default: m.MiniSqlEditor })),
);
import { COL_WIDTH, ROW_HEIGHT_BY_DENSITY } from "../data-grid/constants";
import { CellContextMenu } from "./CellContextMenu";
import { ColumnHeaderCell } from "./ColumnHeaderCell";
import { RefreshButton } from "./RefreshButton";
import { SkeletonGrid } from "./SkeletonGrid";
import { TableViewerFooter } from "./TableViewerFooter";
import { TablePrivilegesTab, PrivApplyResultSummary } from "./TablePrivilegesTab";
import { ColumnFilterPopover, type FilterEntry } from "./ColumnFilterPopover";
import { JsonArrayEditor } from "./JsonArrayEditor";

function quoteTableIdentifier(identifier: string, driver: "postgres" | "mysql"): string {
  if (driver === "mysql") return `\`${identifier.replace(/`/g, "``")}\``;
  return `"${identifier.replace(/"/g, '""')}"`;
}

function buildTableRawWhereSql(
  schema: string,
  table: string,
  rawWhere: string,
  driver: "postgres" | "mysql",
): string {
  const tableRef = `${quoteTableIdentifier(schema, driver)}.${quoteTableIdentifier(table, driver)}`;
  const trimmed = rawWhere.trim();
  return trimmed
    ? `SELECT *\nFROM ${tableRef}\nWHERE ${trimmed};`
    : `SELECT *\nFROM ${tableRef};`;
}

// ─── TableViewerTab ───────────────────────────────────────────────────────────

export function TableViewerTab({ tab }: { tab: Tab }) {
  const tabSessionId = tab.sessionId;
  const ctx = tab.tableContext;
  const {
    setTabLoading,
    setTabError,
    setTabDirty,
    updateTableTabState,
    gridPageSize,
    gridRowDensity,
    showTotalCount,
    setLastAction,
    profiles,
    activeSessions,
    addTab,
  } = useAppStore(
    useShallow((state) => ({
      setTabLoading: state.setTabLoading,
      setTabError: state.setTabError,
      setTabDirty: state.setTabDirty,
      updateTableTabState: state.updateTableTabState,
      gridPageSize: state.gridPageSize,
      gridRowDensity: state.gridRowDensity,
      showTotalCount: state.showTotalCount,
      setLastAction: state.setLastAction,
      profiles: state.profiles,
      activeSessions: state.activeSessions,
      addTab: state.addTab,
    })),
  );
  const { toast } = useToast();
  const confirm = useConfirm();
  const rowHeight = ROW_HEIGHT_BY_DENSITY[gridRowDensity];
  const isView = ctx?.isView ?? false;
  const connectionId = ctx?.connectionId ?? null;
  const liveSessionId = connectionId ? activeSessions[connectionId] : undefined;
  const querySessionKey = connectionId ?? tabSessionId ?? "no-connection";

  const [viewMode, setViewMode] = useState<"data" | "privileges">("data");

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
  const guardNavigation = useCallback(async (): Promise<boolean> => {
    if (!hasPendingEdits) return true;
    return confirm({
      title: "Discard unsaved changes?",
      description: "You have unsaved changes. They will be lost if you continue.",
      confirmLabel: "Discard",
      cancelLabel: "Cancel",
      destructive: true,
    });
  }, [hasPendingEdits, confirm]);

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
    if (!connectionId) return null;
    return profiles.find((p) => p.id === connectionId)?.displayName ?? null;
  }, [connectionId, profiles]);

  const driver = useMemo(() => {
    return profiles.find((p) => p.id === ctx?.connectionId)?.driver ?? "postgres";
  }, [profiles, ctx?.connectionId]);

  const [page, setPage] = useState(0);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("Asc");

  const [activeFilters, setActiveFilters] = useState<
    Record<string, FilterEntry>
  >({});

  const [rawWhereInput, setRawWhereInput] = useState(
    tab.tableState?.rawWhereInput ?? tab.tableState?.appliedRawWhere ?? "",
  ); // live editor content
  const [appliedRawWhere, setAppliedRawWhere] = useState(
    tab.tableState?.appliedRawWhere ?? "",
  ); // sent to the query
  const rawWhereEditorRef = useRef<MiniSqlEditorHandle>(null);
  const [copiedRawSql, setCopiedRawSql] = useState(false);
  const copiedRawSqlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedRawSqlTimerRef.current) clearTimeout(copiedRawSqlTimerRef.current);
  }, []);

  const handleRawWhereInputChange = useCallback(
    (v: string) => {
      setRawWhereInput(v);
      updateTableTabState(tab.id, { rawWhereInput: v });
    },
    [tab.id, updateTableTabState],
  );

  const applyRawWhere = useCallback(
    async (v: string) => {
      if (!await guardNavigation()) return;
      discardEdits();
      const applied = v.trim();
      setRawWhereInput(v);
      setAppliedRawWhere(applied);
      updateTableTabState(tab.id, {
        rawWhereInput: v,
        appliedRawWhere: applied,
      });
      setPage(0);
    },
    [guardNavigation, discardEdits, tab.id, updateTableTabState],
  );

  const copyRawWhereSql = useCallback(async () => {
    if (!ctx) return;
    const normalized = rawWhereEditorRef.current?.getNormalizedValue() ?? rawWhereInput.trim();
    const sql = buildTableRawWhereSql(ctx.schema, ctx.table, normalized, driver);
    await navigator.clipboard.writeText(sql);
    setCopiedRawSql(true);
    if (copiedRawSqlTimerRef.current) clearTimeout(copiedRawSqlTimerRef.current);
    copiedRawSqlTimerRef.current = setTimeout(() => setCopiedRawSql(false), 1500);
  }, [ctx, driver, rawWhereInput]);

  const apiFilters = useMemo((): ColumnFilter[] => {
    return Object.entries(activeFilters).reduce((acc, [column, f]) => {
      if (
        f.operator === "IsNull" ||
        f.operator === "IsNotNull" ||
        f.value.trim() !== ""
      ) {
        acc.push({
          column,
          operator: f.operator,
          value:
            f.operator === "IsNull" || f.operator === "IsNotNull"
              ? null
              : f.value,
        });
      }
      return acc;
    }, [] as ColumnFilter[]);
  }, [activeFilters]);

  const enabled = !!ctx && !!connectionId;

  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: [
      "table-viewer",
      querySessionKey,
      ctx?.database,
      ctx?.schema,
      ctx?.table,
      apiFilters,
      appliedRawWhere,
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
          rawWhere: appliedRawWhere || null,
          sortColumn: sortColumn ?? null,
          sortDirection: sortColumn ? sortDirection : null,
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
    rawWhere: appliedRawWhere || null,
    sortColumn: null,
    sortDirection: null,
    page: 0,
    pageSize: gridPageSize,
  }), [ctx?.database, ctx?.schema, ctx?.table, apiFilters, appliedRawWhere, gridPageSize]);

  const { data: countData } = useQuery({
    queryKey: [
      "table-viewer-count",
      querySessionKey,
      ctx?.database,
      ctx?.schema,
      ctx?.table,
      apiFilters,
      appliedRawWhere,
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
    async (colName: string) => {
      if (!await guardNavigation()) return;
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
  const schemaCompletions = useMemo(
    () => (ctx && data?.columns) ? { [ctx.table]: data.columns.map((c) => c.name) } : undefined,
    [data?.columns, ctx],
  );
  const enumCols = useMemo(() => detectEnumColumns(columns), [columns]);
  const displayColumnIndexes = useMemo(
    () => getIdentifierFirstColumnIndexes(columns),
    [columns],
  );
  const firstDisplayColumnName = displayColumnIndexes.length > 0
    ? columns[displayColumnIndexes[0]]?.name
    : undefined;

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
      const displayIndex = displayColumnIndexes.indexOf(fromCol);
      if (displayIndex === -1) return null;

      let idx = displayIndex + dir;
      while (idx >= 0 && idx < displayColumnIndexes.length) {
        const colIdx = displayColumnIndexes[idx];
        const col = columns[colIdx];
        if (col && isColEditable(col.dataType)) return colIdx;
        idx += dir;
      }
      return null;
    },
    [columns, displayColumnIndexes, isColEditable],
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

  // Build the RowChange[] payload from pendingEdits. Shared by handleSave and
  // handleOpenAsSql. Throws if a row has neither a PK nor a ctid.
  const buildRowChanges = useCallback((): RowChange[] => {
    if (!data || pendingEdits.size === 0) return [];
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
        changes.push({ pkConditions, ctid: null, columnChanges });
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
    return changes;
  }, [data, pendingEdits, columns, ctids]);

  const handleSave = useCallback(async () => {
    if (!data || !ctx || pendingEdits.size === 0) return;
    setIsSaving(true);
    try {
      const changes = buildRowChanges();

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
  }, [data, ctx, pendingEdits, buildRowChanges, totalPendingChanges, toast, refetch]);

  // ── Open as SQL handler ────────────────────────────────────────────────────
  // Pending edits are kept; user can run the SQL from the new tab, then click
  // Discard once it succeeds. Errors leave pending state untouched.
  const handleOpenAsSql = useCallback(async () => {
    if (!data || !ctx || pendingEdits.size === 0) return;
    try {
      const changes = buildRowChanges();
      const sql = await withSessionRetry(ctx.connectionId, (sid) =>
        tableApi.previewUpdateRowsSql(sid, {
          schema: ctx.schema,
          table: ctx.table,
          changes,
        }),
        toast,
      );
      addTab({
        type: "query",
        title: `Edit ${ctx.schema}.${ctx.table}`,
        sessionId: useAppStore.getState().activeSessions[ctx.connectionId] ?? tabSessionId,
        queryContext: { sql, connectionId: ctx.connectionId },
        isDirty: true,
      });
    } catch (e) {
      toast(`Open as SQL failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [data, ctx, pendingEdits, buildRowChanges, tabSessionId, toast, addTab]);

  // ── Delete row handler ──────────────────────────────────────────────────────
  const [deleteResults, setDeleteResults] = useState<
    { sql: string; error: string | null }[] | null
  >(null);

  const buildDeleteRequest = useCallback(
    (rowIdx: number): DeleteRowRequest | null => {
      if (!data) return null;
      const row = data.rows[rowIdx];
      if (!row) return null;
      const pkCols = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
      const colIndexByName = new Map(columns.map((c, i) => [c.name, i]));
      if (pkCols.length > 0) {
        const pkConditions = pkCols.map((pkName) => {
          const idx = colIndexByName.get(pkName)!;
          const cellStr = cellToString(row[idx] ?? { t: "null" });
          return { column: pkName, value: cellStr ?? "" };
        });
        return { pkConditions, ctid: null };
      }
      const ctid = ctids[rowIdx];
      if (ctid) return { pkConditions: [], ctid };
      return null;
    },
    [data, columns, ctids],
  );

  const handleDeleteRow = useCallback(
    async (rowIdx: number) => {
      if (!data || !ctx) return;
      const req = buildDeleteRequest(rowIdx);
      if (!req) {
        toast("Cannot delete: no primary key or ctid", "error");
        return;
      }

      let sql: string;
      try {
        sql = await withSessionRetry(
          ctx.connectionId,
          (sid) =>
            tableApi.previewDeleteRowsSql(sid, {
              schema: ctx.schema,
              table: ctx.table,
              rows: [req],
            }),
          toast,
        );
      } catch (e) {
        toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, "error");
        return;
      }

      const hasPending = pendingEdits.has(rowIdx);
      const ok = await confirm({
        title: "Delete this row?",
        description:
          sql +
          (hasPending ? " — unsaved edits on this row will be discarded." : ""),
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;

      try {
        const results = await withSessionRetry(
          ctx.connectionId,
          (sid) =>
            tableApi.deleteRows(sid, {
              schema: ctx.schema,
              table: ctx.table,
              rows: [req],
            }),
          toast,
        );
        const failed = results.filter((r) => r.error);
        if (failed.length > 0) {
          setDeleteResults(results);
        } else {
          toast("Row deleted", "success");
          if (hasPending) {
            setPendingEdits((prev) => {
              const next = new Map(prev);
              next.delete(rowIdx);
              return next;
            });
          }
        }
        await refetch();
      } catch (e) {
        toast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
    [data, ctx, buildDeleteRequest, pendingEdits, confirm, toast, refetch],
  );

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

  // Store latest values in refs so the effect subscribes once
  // (prefer-useEffectEvent — React 19 useEffectEvent is still experimental;
  //  the stable ref pattern achieves the same result).
  const selectedCellRef = useRef(selectedCell);
  selectedCellRef.current = selectedCell;
  const dataRef = useRef(data);
  dataRef.current = data;
  const copyCellRef = useRef(copyCell);
  copyCellRef.current = copyCell;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't hijack copy while the user is editing an input/textarea/contenteditable.
      const target = e.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isTyping) return;
      const cell = selectedCellRef.current;
      const d = dataRef.current;
      if ((e.metaKey || e.ctrlKey) && e.key === "c" && cell && d) {
        e.preventDefault();
        copyCellRef.current(cell.row, cell.col, d.rows);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Cell context menu ──────────────────────────────────────────────────────

  const [cellMenu, setCellMenu] = useState<{
    rowData: CellValue[];
    rowIdx: number;
    colIdx: number;
    x: number;
    y: number;
  } | null>(null);

  // ── Column widths ──────────────────────────────────────────────────────────

  const colWidthsKey = ctx
    ? `esploro-col-widths:${ctx.connectionId}:${ctx.database}:${ctx.schema}:${ctx.table}`
    : null;

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (!colWidthsKey) return {};
    try {
      const stored = localStorage.getItem(colWidthsKey);
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
  const end = currentPage * pageSize + (data?.rows.length ?? 0);
  const hasPrev = currentPage > 0;
  const hasNext = totalCount !== null ? end < totalCount : (data?.rows.length ?? 0) >= pageSize;
  const goToPreviousPage = useCallback(async () => {
    if (!await guardNavigation()) return;
    discardEdits();
    setPage((p) => Math.max(0, p - 1));
  }, [guardNavigation, discardEdits]);
  const goToNextPage = useCallback(async () => {
    if (!await guardNavigation()) return;
    discardEdits();
    setPage((p) => p + 1);
  }, [guardNavigation, discardEdits]);

  // ── Filter chip helpers ────────────────────────────────────────────────────

  const activeChips = apiFilters;
  const activeFilterCols = useMemo(
    () => new Set(apiFilters.map((f) => f.column)),
    [apiFilters],
  );

  const removeFilter = async (col: string) => {
    if (!await guardNavigation()) return;
    discardEdits();
    setActiveFilters((prev) => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
    setPage(0);
  };

  const clearAllFilters = async () => {
    if (!await guardNavigation()) return;
    discardEdits();
    setActiveFilters({});
    setPage(0);
  };

  // ── Filter popover state ───────────────────────────────────────────────────

  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const filterAnchorEl = useRef<Element | null>(null);

  const applyFilterEntry = useCallback(
    async (colName: string, entry: FilterEntry | null) => {
      if (!await guardNavigation()) return;
      discardEdits();
      setActiveFilters((prev) => {
        const next = { ...prev };
        if (entry === null) {
          delete next[colName];
        } else {
          next[colName] = entry;
        }
        return next;
      });
      setPage(0);
    },
    [guardNavigation, discardEdits],
  );

  const handleFilterByValue = useCallback(
    async (colName: string, value: string | null) => {
      if (!await guardNavigation()) return;
      discardEdits();
      setActiveFilters((prev) => ({
        ...prev,
        [colName]: {
          operator: value === null ? "IsNull" : "Eq",
          value: value ?? "",
        },
      }));
      setPage(0);
    },
    [guardNavigation, discardEdits],
  );

  // ⌘F: open filter popover for sorted column or first column
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && firstDisplayColumnName) {
        e.preventDefault();
        const target = sortColumn ?? firstDisplayColumnName;
        setOpenFilterCol(target);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [firstDisplayColumnName, sortColumn]);

  const totalWidth = useMemo(
    () => columns.reduce((sum, col) => sum + (colWidths[col.name] ?? COL_WIDTH), 0),
    [columns, colWidths],
  );

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!ctx) {
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
        <div className="flex items-center gap-1.5 min-w-0 shrink">
          <span className="shrink-0 text-schema-table">
            <Table2 size={13} />
          </span>
          <span className="text-xs truncate">
            {ctx.schema && (
              <span className="text-secondary">{ctx.schema}<span className="mx-0.5 text-tertiary">.</span></span>
            )}
            <span className="text-label font-medium">{ctx.table}</span>
          </span>
        </div>

        {/* Raw WHERE query bar (replaces the database badge) */}
        <div className="flex-1 min-w-0 flex items-center bg-control rounded px-2 h-[24px] border border-transparent focus-within:border-accent/40">
          <div className="flex-1 min-w-0">
            <Suspense fallback={<span className="text-secondary text-xs">…</span>}>
            <MiniSqlEditor
              ref={rawWhereEditorRef}
              value={rawWhereInput}
              onChange={handleRawWhereInputChange}
              onApply={applyRawWhere}
              onClear={async () => {
                if (!await guardNavigation()) return;
                discardEdits();
                setRawWhereInput("");
                setAppliedRawWhere("");
                updateTableTabState(tab.id, {
                  rawWhereInput: "",
                  appliedRawWhere: "",
                });
                setPage(0);
              }}
              schemaCompletions={schemaCompletions}
              whereColumns={columns}
              sqlDriver={driver}
              placeholder="WHERE …"
            />
            </Suspense>
          </div>
          <div className="ml-1 flex shrink-0 items-center gap-0.5 border-l border-separator/60 pl-1">
            <button
              type="button"
              title="Copy SQL"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void copyRawWhereSql()}
              className="inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-control)] text-secondary hover:bg-hover hover:text-label transition-colors"
            >
              {copiedRawSql ? <ClipboardCheck size={12} className="text-accent" /> : <ClipboardCopy size={12} />}
            </button>
            <button
              type="button"
              title="Run filter"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => rawWhereEditorRef.current?.apply()}
              className="inline-flex h-5 items-center gap-1 rounded-[var(--radius-control)] bg-accent px-1.5 text-[10px] font-medium text-inverse hover:bg-accent-hover transition-colors"
            >
              <Play size={10} fill="currentColor" />
              Run
            </button>
          </div>
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
                    : liveSessionId ? 'var(--ds-success)' : 'var(--border-default)',
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
          onRefresh={async () => {
            if (!await guardNavigation()) return;
            discardEdits();
            void refetch();
          }}
        />
      </div>

      {/* Tab bar (Data | Privileges) — Postgres only */}
      {driver !== "mysql" && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-separator shrink-0 bg-sidebar">
          {(["data", "privileges"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={cn(
                "px-2.5 py-0.5 text-[12px] rounded transition-colors capitalize",
                viewMode === mode
                  ? "bg-control text-label shadow-[var(--shadow-hairline)]"
                  : "text-secondary hover:text-label hover:bg-hover",
              )}
            >
              {mode === "data" ? "Data" : "Privileges"}
            </button>
          ))}
        </div>
      )}

      {/* Privileges view */}
      {viewMode === "privileges" && (
        <TablePrivilegesTab
          sessionId={liveSessionId ?? ""}
          schema={ctx.schema}
          table={ctx.table}
        />
      )}

      {/* Active filter chips */}
      {viewMode === "data" && (activeChips.length > 0 || appliedRawWhere) && (
        <div className="shrink-0 flex flex-wrap items-center gap-1 px-2 py-1 border-b border-separator bg-accent/5">
          {appliedRawWhere && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs">
              <span className="font-medium">WHERE</span>
              <span className="font-mono truncate max-w-[280px]">{appliedRawWhere}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={async () => {
                  if (!await guardNavigation()) return;
                  discardEdits();
                  setRawWhereInput("");
                  setAppliedRawWhere("");
                  updateTableTabState(tab.id, {
                    rawWhereInput: "",
                    appliedRawWhere: "",
                  });
                  setPage(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.currentTarget.click();
                  }
                }}
                className="hover:text-destructive transition-colors ml-0.5 cursor-default"
              >
                ×
              </span>
            </span>
          )}
          {activeChips.map((f) => (
            <button
              type="button"
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
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); removeFilter(f.column); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault(); e.stopPropagation(); removeFilter(f.column);
                  }
                }}
                className="hover:text-destructive transition-colors ml-0.5 cursor-default"
              >
                ×
              </span>
            </button>
          ))}
          {activeChips.length > 0 && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-xs text-secondary hover:text-destructive transition-colors ml-1"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Grid area */}
      {viewMode === "data" && (
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
              type="button"
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
                {displayColumnIndexes.map((ci) => {
                  const col = columns[ci];
                  if (!col) return null;

                  return (
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
                  );
                })}
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
                      type="button"
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
                        {displayColumnIndexes.map((ci) => {
                          const col = columns[ci];
                          if (!col) return null;

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
                              role="gridcell"
                              tabIndex={-1}
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
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedCell({ row: vr.index, col: ci });
                                }
                              }}
                              onDoubleClick={(e) => {
                                if (editable) startEdit(vr.index, ci, e.currentTarget);
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSelectedCell({ row: vr.index, col: ci });
                                setCellMenu({
                                  rowData,
                                  rowIdx: vr.index,
                                  colIdx: ci,
                                  x: e.clientX,
                                  y: e.clientY,
                                });
                              }}
                            >
                              {isEditing ? (
                                <input
                                  aria-label="Edit cell value"
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
                                  type="button"
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
      )}

      {/* Save / Discard bar — visible only when there are pending edits */}
      {viewMode === "data" && hasPendingEdits && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-t border-[var(--ds-warning)]/40 bg-[color-mix(in_srgb,var(--ds-warning)_10%,transparent)] text-xs">
          <span className="text-label font-medium">
            {totalPendingChanges} unsaved change{totalPendingChanges === 1 ? "" : "s"}
            {pendingEdits.size > 1 && (
              <span className="text-secondary"> in {pendingEdits.size} rows</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={discardEdits}
              disabled={isSaving}
              className="px-3 py-1 rounded-[var(--radius-control)] text-secondary hover:text-label hover:bg-control transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="inline-flex items-center gap-1.5"><X size={12} /> Discard</span>
            </button>
            <button
              type="button"
              onClick={() => void handleOpenAsSql()}
              disabled={isSaving}
              title="Open the generated UPDATE statements in a new query editor tab"
              className="px-3 py-1 rounded-[var(--radius-control)] text-secondary hover:text-label hover:bg-control transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="inline-flex items-center gap-1.5"><FileCode2 size={12} /> Open as SQL</span>
            </button>
            <button
              type="button"
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
      {viewMode === "data" && (
        <TableViewerFooter
          data={data}
          totalCount={totalCount}
          isEstimate={isEstimate}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPreviousPage={() => { void goToPreviousPage(); }}
          onNextPage={() => { void goToNextPage(); }}
        />
      )}

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
            entry={activeFilters[openFilterCol]}
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
          onDeleteRow={() => handleDeleteRow(cellMenu.rowIdx)}
          canDelete={columns.some((c) => c.isPrimaryKey) || !!ctids[cellMenu.rowIdx]}
        />
      )}

      {/* Delete row partial-failure summary */}
      {deleteResults && (
        <PrivApplyResultSummary results={deleteResults} onClose={() => setDeleteResults(null)} />
      )}

      {/* Header context menu */}
      {headerMenu && createPortal(
        <div
          className="fixed z-50 min-w-[180px] rounded-[var(--radius-popover)] border border-separator bg-raised shadow-[var(--shadow-popover)] py-1"
          style={{ left: headerMenu.x, top: headerMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
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
