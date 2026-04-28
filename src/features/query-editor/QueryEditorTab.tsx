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
import { Play, Save, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import type { Tab } from "../../store";
import { useAppStore } from "../../store";
import { queryEditorApi, savedQueriesApi } from "./api";
import { SqlEditor } from "./SqlEditor";
import type { QueryResult, ResultColumn } from "./types";
import { cn } from "../../lib/utils";

const COL_WIDTH = 180;
const ROW_HEIGHT = 33;
const HEADER_HEIGHT = 36;

// ─── CellValue ────────────────────────────────────────────────────────────────

function CellValue({ value }: { value: string | null }) {
  if (value === null) {
    return (
      <span className="text-secondary italic text-[10px] px-1.5 py-px rounded bg-control leading-none">
        NULL
      </span>
    );
  }
  return (
    <span className="font-mono text-xs text-label truncate block">{value}</span>
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const totalWidth = columns.length * COL_WIDTH;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_HEIGHT,
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
                  height: ROW_HEIGHT,
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
                    style={{ width: COL_WIDTH, minWidth: COL_WIDTH, height: ROW_HEIGHT }}
                  >
                    <CellValue value={rowData?.[ci] ?? null} />
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
  const label = total > 1 ? `Result ${index + 1}` : "Result";

  return (
    <div className={cn("flex flex-col", hasGrid ? "min-h-[200px] flex-1" : "shrink-0")}>
      {/* Section header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-sidebar border-b border-separator shrink-0">
        <span className="text-xs font-semibold text-label">{label}</span>
        {result.error ? (
          <span className="flex items-center gap-1 text-xs text-red-500">
            <AlertCircle size={11} />
            {result.error.message}
          </span>
        ) : (
          <>
            {result.columns.length > 0 && (
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
            <span className="ml-auto text-xs text-secondary">{result.executionMs}ms</span>
          </>
        )}
      </div>

      {hasGrid && (
        <div className="flex-1 overflow-hidden">
          <ResultGrid columns={result.columns} rows={result.rows} />
        </div>
      )}

      {!hasGrid && !result.error && result.rowsAffected == null && (
        <div className="px-3 py-2 text-xs text-secondary italic">No rows returned.</div>
      )}
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

// ─── QueryEditorTab ───────────────────────────────────────────────────────────

export function QueryEditorTab({ tab }: { tab: Tab }) {
  const { profiles, activeSessions } = useAppStore();
  const rqClient = useQueryClient();

  const [sql, setSql] = useState(tab.queryContext?.sql ?? "");
  const [results, setResults] = useState<QueryResult[]>([]);
  const [error, setError] = useState<import("./types").QueryError | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [resultHeight, setResultHeight] = useState(260);
  const isDragging = useRef(false);
  const dragStart = useRef(0);
  const dragStartH = useRef(0);

  // Pick the session to run against
  const sessionId = useMemo(() => {
    if (tab.sessionId) return tab.sessionId;
    // Fall back to any active session
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

  const runMutation = useMutation({
    mutationFn: async (sqlText: string) => {
      if (!sessionId) throw new Error("No active connection");
      return queryEditorApi.executeSql(sessionId, sqlText);
    },
    onSuccess: (data) => {
      setResults(data);
      const firstError = data.find((r) => r.error != null)?.error ?? null;
      setError(firstError);
    },
    onError: (e: Error) => {
      setError({ message: e.message, position: null, code: null });
    },
  });

  const handleRun = useCallback(
    (sqlText: string) => {
      setError(null);
      runMutation.mutate(sqlText);
    },
    [runMutation],
  );

  const handleSave = useCallback(
    async (name: string, folder: string) => {
      try {
        const id = await savedQueriesApi.save({ name, folder: folder || undefined, sql });
        await rqClient.invalidateQueries({ queryKey: ["saved-queries"] });
        console.log("Saved query", id);
      } catch (e) {
        console.error("Failed to save query", e);
      }
    },
    [sql, rqClient],
  );

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
      setResultHeight(Math.max(80, Math.min(600, dragStartH.current + delta)));
    };
    const onMouseUp = () => { isDragging.current = false; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const hasResults = results.length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-sidebar border-b border-separator shrink-0">
        {/* Connection badge */}
        <div className="flex items-center gap-1 text-xs text-secondary bg-control px-2 py-1 rounded">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", sessionId ? "bg-green-500" : "bg-secondary")} />
          {connectionLabel}
          <ChevronDown size={10} className="ml-0.5" />
        </div>

        <div className="flex-1" />

        {/* Time badge */}
        {hasResults && !runMutation.isPending && (
          <span className="text-xs text-secondary">
            {results.reduce((sum, r) => sum + r.executionMs, 0)}ms total
          </span>
        )}

        {/* Save */}
        <button
          onClick={() => setSaveOpen(true)}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-secondary rounded hover:bg-control transition-colors"
          title="Save query (⌘S)"
        >
          <Save size={13} />
          Save
        </button>

        {/* Run */}
        <button
          onClick={() => handleRun(sql)}
          disabled={runMutation.isPending || !sessionId}
          className="flex items-center gap-1.5 px-3 py-1 text-xs bg-accent text-white rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
          title="Run query (⌘↵)"
        >
          {runMutation.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Play size={13} />
          )}
          Run
        </button>
      </div>

      {/* Editor area */}
      <div
        className="flex-1 overflow-hidden"
        style={{ minHeight: 0 }}
      >
        <SqlEditor
          value={sql}
          onChange={setSql}
          onRun={handleRun}
          error={error}
          schemaCompletions={schemaCompletions}
        />
      </div>

      {/* Drag handle */}
      {hasResults && (
        <div
          onMouseDown={onDragHandleMouseDown}
          className="h-1 bg-separator hover:bg-accent/40 cursor-row-resize shrink-0 transition-colors"
        />
      )}

      {/* Result panel */}
      {hasResults && (
        <div
          className="border-t border-separator shrink-0 overflow-hidden"
          style={{ height: resultHeight }}
        >
          <ResultPanel results={results} />
        </div>
      )}

      {/* Error banner (when no result rows but there's a top-level error) */}
      {error && results.length === 0 && (
        <div className="px-3 py-2 bg-red-500/10 border-t border-red-500/20 text-xs text-red-500 flex items-center gap-1.5 shrink-0">
          <AlertCircle size={12} />
          {error.message}
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
