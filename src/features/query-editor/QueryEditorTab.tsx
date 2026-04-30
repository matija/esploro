import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Play,
  Save,
  Loader2,
  AlertCircle,
  ChevronDown,
  Check,
  X,
  Terminal,
} from "lucide-react";
import type { Tab } from "../../store";
import { useAppStore } from "../../store";
import { queryEditorApi, savedQueriesApi } from "./api";
import { SqlEditor } from "./SqlEditor";
import type { QueryResult, ResultColumn } from "./types";
import { getTypeFamily, type TypeFamily } from "../table-viewer/types";
import { cn } from "../../lib/utils";

const COL_WIDTH = 180;
const HEADER_HEIGHT = 36;

const ROW_HEIGHT_BY_DENSITY = {
  compact: 33,
  comfortable: 44,
  spacious: 56,
} as const;
const RESULT_HEIGHT_KEY = "esploro-query-result-height";

type RunState = "idle" | "pending" | "success" | "error";

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
        {"''"}
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

// ─── ResultGrid ───────────────────────────────────────────────────────────────

function ResultGrid({
  columns,
  rows,
}: {
  columns: ResultColumn[];
  rows: (string | null)[][];
}) {
  const { gridRowDensity } = useAppStore();
  const rowHeight = ROW_HEIGHT_BY_DENSITY[gridRowDensity];
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const totalWidth = columns.length * COL_WIDTH;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const onBodyScroll = useCallback(() => {
    if (bodyRef.current && headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = bodyRef.current.scrollLeft;
    }
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.addEventListener("scroll", onBodyScroll, { passive: true });
    return () => el.removeEventListener("scroll", onBodyScroll);
  }, [onBodyScroll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "c" && selectedCell) {
        const val = rows[selectedCell.row]?.[selectedCell.col];
        if (val !== undefined) {
          navigator.clipboard.writeText(val ?? "");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCell, rows]);

  const families = useMemo(
    () => columns.map((col) => getTypeFamily(col.dataType ?? "")),
    [columns],
  );

  if (columns.length === 0) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sticky header */}
      <div
        ref={headerScrollRef}
        className="flex shrink-0 overflow-hidden border-b border-separator"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="flex" style={{ width: totalWidth, minWidth: totalWidth }}>
          {columns.map((col) => (
            <div
              key={col.name}
              className="flex items-center gap-1.5 px-2 select-none shrink-0 bg-sidebar"
              style={{ width: COL_WIDTH, minWidth: COL_WIDTH, height: HEADER_HEIGHT }}
            >
              <span className="text-xs font-semibold text-label truncate flex-1 min-w-0">
                {col.name}
              </span>
              {col.dataType && (
                <span className="text-[9px] text-secondary bg-control px-1 py-px rounded shrink-0">
                  {col.dataType}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Virtualized body */}
      <div ref={bodyRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: totalWidth,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vrow) => {
            const rowData = rows[vrow.index];
            return (
              <div
                key={vrow.key}
                style={{
                  position: "absolute",
                  top: vrow.start,
                  height: rowHeight,
                  width: totalWidth,
                  display: "flex",
                }}
                className={cn(
                  "border-b border-separator",
                  vrow.index % 2 === 0 ? "bg-content" : "bg-sidebar",
                )}
              >
                {columns.map((col, ci) => (
                  <div
                    key={col.name}
                    onClick={() => setSelectedCell({ row: vrow.index, col: ci })}
                    className={cn(
                      "flex items-center px-2 border-r border-separator shrink-0 overflow-hidden cursor-default",
                      selectedCell?.row === vrow.index &&
                        selectedCell?.col === ci &&
                        "ring-1 ring-inset ring-accent",
                    )}
                    style={{ width: COL_WIDTH, minWidth: COL_WIDTH, height: rowHeight }}
                  >
                    <CellValue value={rowData?.[ci] ?? null} family={families[ci]} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── EmptyResultState ─────────────────────────────────────────────────────────

function EmptyResultState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 select-none pointer-events-none">
      <Terminal size={28} className="text-secondary opacity-40" />
      <p className="text-xs text-secondary opacity-60">
        Press <kbd className="font-mono bg-control px-1 py-px rounded text-[10px]">⌘↵</kbd> to run the query
      </p>
    </div>
  );
}

// ─── ResultPanel ──────────────────────────────────────────────────────────────

function ResultPanel({ results }: { results: QueryResult[] }) {
  if (results.length === 0) return null;

  return (
    <div className="flex flex-col h-full overflow-auto divide-y divide-separator">
      {results.map((result, i) => (
        <ResultSection key={i} result={result} index={i} total={results.length} />
      ))}
    </div>
  );
}

function ResultSection({
  result,
  index,
  total,
}: {
  result: QueryResult;
  index: number;
  total: number;
}) {
  const hasGrid = result.columns.length > 0 && result.rows.length > 0;
  const hasColumns = result.columns.length > 0;
  const label = total > 1 ? `Result ${index + 1}` : "Result";

  return (
    <div className={cn("flex flex-col", hasGrid ? "min-h-[200px] flex-1" : "shrink-0")}>
      {/* Section header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-sidebar border-b border-separator shrink-0">
        {total > 1 && (
          <span className="text-[10px] font-semibold text-secondary uppercase tracking-wide">
            {label}
          </span>
        )}
        {result.error ? (
          <span className="flex items-center gap-1 text-xs text-query-failed">
            <AlertCircle size={11} />
            {result.error.message}
          </span>
        ) : (
          <>
            {hasColumns && (
              <span className="text-xs text-secondary">
                {result.rows.length.toLocaleString()} row
                {result.rows.length !== 1 ? "s" : ""}
              </span>
            )}
            {result.rowsAffected != null && (
              <span className="text-xs text-secondary">
                {result.rowsAffected} row{result.rowsAffected !== 1 ? "s" : ""} affected
              </span>
            )}
            <span className="ml-auto text-[10px] text-secondary tabular-nums">
              {result.executionMs}ms
            </span>
          </>
        )}
      </div>

      {hasGrid && (
        <div className="flex-1 overflow-hidden">
          <ResultGrid columns={result.columns} rows={result.rows} />
        </div>
      )}

      {/* Empty rows state (query returned columns but no rows) */}
      {hasColumns && !hasGrid && !result.error && (
        <div className="flex items-center justify-center py-6 text-xs text-secondary italic">
          No rows returned.
        </div>
      )}

      {!hasColumns && !result.error && result.rowsAffected == null && (
        <div className="px-3 py-2 text-xs text-secondary italic">No rows returned.</div>
      )}
    </div>
  );
}

// ─── ErrorSummary ─────────────────────────────────────────────────────────────

function ErrorSummary({ error }: { error: import("./types").QueryError }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-query-failed/8 border-t border-query-failed/20 shrink-0">
      <AlertCircle size={13} className="text-query-failed shrink-0 mt-px" />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-medium text-query-failed leading-snug">
          {error.message}
        </span>
        {error.code && (
          <span className="text-[10px] text-query-failed/70 font-mono">{error.code}</span>
        )}
      </div>
    </div>
  );
}

// ─── SaveDialog ───────────────────────────────────────────────────────────────

function SaveDialog({
  open,
  onClose,
  onSave,
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, folder: string) => void;
  initialName: string;
}) {
  const [name, setName] = useState(initialName);
  const [folder, setFolder] = useState("");

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-[30%] -translate-x-1/2 z-50",
            "w-[400px] rounded-xl overflow-hidden",
            "bg-content border border-separator shadow-2xl p-5",
          )}
          aria-label="Save query"
        >
          <Dialog.Title className="text-sm font-semibold text-label mb-4">
            Save Query
          </Dialog.Title>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-secondary mb-1 block">Name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My query"
                className="w-full bg-control rounded px-2 py-1.5 text-sm text-label outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-xs text-secondary mb-1 block">
                Folder <span className="text-secondary">(optional)</span>
              </label>
              <input
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="Reports"
                className="w-full bg-control rounded px-2 py-1.5 text-sm text-label outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-secondary rounded hover:bg-control"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (name.trim()) {
                  onSave(name.trim(), folder.trim());
                  onClose();
                }
              }}
              disabled={!name.trim()}
              className="px-3 py-1.5 text-sm bg-accent text-white rounded hover:opacity-90 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── RunButton ────────────────────────────────────────────────────────────────

function RunButton({
  runState,
  disabled,
  onClick,
}: {
  runState: RunState;
  disabled: boolean;
  onClick: () => void;
}) {
  const config = {
    idle: {
      icon: <Play size={12} />,
      label: "Run",
      hint: "⌘↵",
      cls: "bg-accent hover:opacity-90 text-white",
    },
    pending: {
      icon: <Loader2 size={12} className="animate-spin" />,
      label: "Running",
      hint: null,
      cls: "bg-accent/70 text-white cursor-wait",
    },
    success: {
      icon: <Check size={12} />,
      label: "Done",
      hint: null,
      cls: "bg-query-succeeded text-inverse",
    },
    error: {
      icon: <X size={12} />,
      label: "Error",
      hint: null,
      cls: "bg-query-failed text-inverse",
    },
  }[runState];

  return (
    <button
      onClick={onClick}
      disabled={disabled || runState === "pending"}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-all duration-150",
        "disabled:opacity-50",
        config.cls,
      )}
      title="Run query (⌘↵)"
    >
      {config.icon}
      <span>{config.label}</span>
      {config.hint && (
        <kbd className="ml-0.5 text-[9px] opacity-60 font-mono">{config.hint}</kbd>
      )}
    </button>
  );
}

// ─── QueryEditorTab ───────────────────────────────────────────────────────────

export function QueryEditorTab({ tab }: { tab: Tab }) {
  const { profiles, activeSessions, setTabDirty, setLastAction } = useAppStore();
  const rqClient = useQueryClient();

  const [sql, setSql] = useState(tab.queryContext?.sql ?? "");
  const [results, setResults] = useState<QueryResult[]>([]);
  const [error, setError] = useState<import("./types").QueryError | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [saveOpen, setSaveOpen] = useState(false);
  const [hasEverRun, setHasEverRun] = useState(false);

  const persistedHeight = () => {
    const stored = localStorage.getItem(RESULT_HEIGHT_KEY);
    const n = stored ? parseInt(stored, 10) : NaN;
    return isNaN(n) ? 260 : Math.max(80, Math.min(600, n));
  };

  const [resultHeight, setResultHeight] = useState(persistedHeight);
  const isDragging = useRef(false);
  const dragStart = useRef(0);
  const dragStartH = useRef(0);
  const savedSql = useRef(tab.queryContext?.sql ?? "");
  const runStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pick the session to run against
  const sessionId = useMemo(() => {
    if (tab.sessionId) return tab.sessionId;
    return Object.values(activeSessions)[0] ?? null;
  }, [tab.sessionId, activeSessions]);

  const connectionLabel = useMemo(() => {
    if (!sessionId) return "No connection";
    const connId = Object.entries(activeSessions).find(([, s]) => s === sessionId)?.[0];
    if (!connId) return "Unknown";
    return profiles.find((p) => p.id === connId)?.displayName ?? "Unknown";
  }, [sessionId, activeSessions, profiles]);

  // Build schema completions from React Query cache
  const schemaCompletions = useMemo(() => {
    if (!sessionId) return undefined;
    const cache = rqClient.getQueryCache();
    const objectQueries = cache
      .getAll()
      .filter(
        (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "objects" &&
          q.queryKey[1] === sessionId &&
          q.state.status === "success",
      );

    const schema: Record<string, string[]> = {};
    for (const oq of objectQueries) {
      const [, , , schemaName] = oq.queryKey as string[];
      const data = oq.state.data as import("../schema/types").SchemaObjects | undefined;
      if (!data) continue;
      for (const tbl of data.tables) {
        schema[`${schemaName}.${tbl.name}`] = [];
        schema[tbl.name] = [];
      }
      for (const view of data.views) {
        schema[`${schemaName}.${view}`] = [];
        schema[view] = [];
      }
    }
    return Object.keys(schema).length > 0 ? schema : undefined;
  }, [sessionId, rqClient]);

  const setRunStateBriefly = useCallback((state: "success" | "error") => {
    setRunState(state);
    if (runStateTimerRef.current) clearTimeout(runStateTimerRef.current);
    runStateTimerRef.current = setTimeout(() => setRunState("idle"), 1500);
  }, []);

  const runMutation = useMutation({
    mutationFn: async (sqlText: string) => {
      if (!sessionId) throw new Error("No active connection");
      return queryEditorApi.executeSql(sessionId, sqlText);
    },
    onSuccess: (data) => {
      setResults(data);
      const firstError = data.find((r) => r.error != null)?.error ?? null;
      setError(firstError);
      setRunStateBriefly(firstError ? "error" : "success");
      const totalMs = data.reduce((sum, r) => sum + r.executionMs, 0);
      const totalRows = data.reduce((sum, r) => sum + r.rows.length, 0);
      setLastAction({
        label: firstError ? "Query error" : "Query executed",
        durationMs: totalMs,
        rowCount: totalRows,
        timestamp: Date.now(),
      });
    },
    onError: (e: Error) => {
      setError({ message: e.message, position: null, code: null });
      setRunStateBriefly("error");
    },
  });

  const handleRun = useCallback(
    (sqlText: string) => {
      setError(null);
      setRunState("pending");
      setHasEverRun(true);
      runMutation.mutate(sqlText);
    },
    [runMutation],
  );

  const handleSave = useCallback(
    async (name: string, folder: string) => {
      try {
        const id = await savedQueriesApi.save({ name, folder: folder || undefined, sql });
        await rqClient.invalidateQueries({ queryKey: ["saved-queries"] });
        savedSql.current = sql;
        setTabDirty(tab.id, false);
        console.log("Saved query", id);
      } catch (e) {
        console.error("Failed to save query", e);
      }
    },
    [sql, rqClient, tab.id, setTabDirty],
  );

  // Track dirty state vs saved SQL
  useEffect(() => {
    setTabDirty(tab.id, sql !== savedSql.current);
  }, [sql, tab.id, setTabDirty]);

  // Clear dirty on unmount
  useEffect(() => () => setTabDirty(tab.id, false), [tab.id, setTabDirty]);

  // Clear run state timer on unmount
  useEffect(() => () => {
    if (runStateTimerRef.current) clearTimeout(runStateTimerRef.current);
  }, []);

  // ⌘S keyboard shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        setSaveOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drag handle for resizing result panel
  const onDragHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStart.current = e.clientY;
    dragStartH.current = resultHeight;
  }, [resultHeight]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStart.current - e.clientY;
      const next = Math.max(80, Math.min(600, dragStartH.current + delta));
      setResultHeight(next);
    };
    const onMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        setResultHeight((h) => {
          localStorage.setItem(RESULT_HEIGHT_KEY, String(h));
          return h;
        });
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const hasResults = results.length > 0;
  const isDirty = sql !== savedSql.current;
  const showResultPane = hasResults || hasEverRun;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 h-9 bg-sidebar border-b border-separator shrink-0">
        {/* Connection badge */}
        <div className="flex items-center gap-1.5 text-xs text-secondary bg-control px-2 py-1 rounded max-w-[180px]">
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              sessionId ? "bg-query-succeeded" : "bg-secondary opacity-40",
            )}
          />
          <span className="truncate">{connectionLabel}</span>
          <ChevronDown size={9} className="ml-0.5 shrink-0 opacity-60" />
        </div>

        <div className="flex-1" />

        {/* Total execution time */}
        {hasResults && runState === "idle" && (
          <span className="text-[10px] text-secondary tabular-nums">
            {results.reduce((sum, r) => sum + r.executionMs, 0).toLocaleString()}ms
          </span>
        )}

        {/* Save button */}
        <button
          onClick={() => setSaveOpen(true)}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors",
            isDirty
              ? "text-accent hover:bg-accent/10"
              : "text-secondary hover:bg-control",
          )}
          title="Save query (⌘S)"
        >
          <Save size={12} />
          <span>Save</span>
          {isDirty && <span className="w-1 h-1 rounded-full bg-accent shrink-0" />}
          <kbd className="text-[9px] opacity-50 font-mono ml-0.5">⌘S</kbd>
        </button>

        {/* Run button */}
        <RunButton
          runState={runState}
          disabled={!sessionId}
          onClick={() => handleRun(sql)}
        />
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        <SqlEditor
          value={sql}
          onChange={setSql}
          onRun={handleRun}
          error={error}
          schemaCompletions={schemaCompletions}
        />
      </div>

      {/* Error summary (shown above result pane when query errored) */}
      {error && (
        <ErrorSummary error={error} />
      )}

      {/* Drag handle — only visible when result pane is shown */}
      {showResultPane && (
        <div
          onMouseDown={onDragHandleMouseDown}
          className="h-1 bg-separator hover:bg-accent/40 cursor-row-resize shrink-0 transition-colors"
          title="Drag to resize"
        />
      )}

      {/* Result panel */}
      {showResultPane && (
        <div
          className="border-t border-separator shrink-0 overflow-hidden"
          style={{ height: resultHeight }}
        >
          {hasResults ? (
            <ResultPanel results={results} />
          ) : (
            <EmptyResultState />
          )}
        </div>
      )}

      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={handleSave}
        initialName=""
      />
    </div>
  );
}
