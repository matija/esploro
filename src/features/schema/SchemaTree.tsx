import { useState, useEffect, useMemo, useRef, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import {
  ChevronRight,
  Database,
  Folder,
  Table2,
  Eye,
  Hash,
  Zap,
  Search,
  X,
  AlertCircle,
  RotateCw,
  ExternalLink,
  Terminal as TerminalIcon,
} from "lucide-react";
import { useAppStore } from "../../store";
import { useToast } from "../../components/Toast";
import { fuzzyScore } from "../../lib/fuzzy";
import { withSessionRetry } from "../../lib/sessionRetry";
import { schemaApi } from "./api";
import type { TreeNode, SchemaObjects, ColumnDef, GroupLabel } from "./types";
import { cn } from "../../lib/utils";

interface Props {
  sessionId: string;
  connectionId: string;
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

const dbKey = (cid: string, db: string) => `${cid}:db:${db}`;
const schemaKey = (cid: string, db: string, s: string) =>
  `${cid}:db:${db}:schema:${s}`;
const groupKey = (cid: string, db: string, s: string, label: GroupLabel) =>
  `${cid}:db:${db}:schema:${s}:group:${label}`;
const tableKey = (cid: string, db: string, s: string, t: string) =>
  `${cid}:db:${db}:schema:${s}:table:${t}`;

// ─── Context menu ─────────────────────────────────────────────────────────────

type ContextMenuState = { node: TreeNode; x: number; y: number };

function ContextMenu({
  menu,
  onClose,
  onAction,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onAction: (action: string) => void;
}) {
  useEffect(() => {
    const onMouseDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const { node } = menu;

  type MenuItem = { label: string; action: string } | "sep";
  let items: MenuItem[] = [];

  if (node.kind === "table" || node.kind === "view") {
    items = [
      { label: "Copy table name", action: "copy-name" },
      { label: "Copy qualified name", action: "copy-qualified" },
      "sep",
      { label: "Open table viewer", action: "open-table" },
      { label: "Open in query editor", action: "open-query" },
    ];
  } else if (node.kind === "column") {
    items = [
      { label: "Copy column name", action: "copy-name" },
      { label: "Copy type", action: "copy-type" },
    ];
  }

  if (items.length === 0) return null;

  return createPortal(
    <div
      className="fixed z-50 min-w-[180px] rounded-[var(--radius-popover)] border border-separator bg-raised shadow-[var(--shadow-popover)] py-1"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item === "sep" ? (
          <div key={i} className="my-1 border-t border-separator" />
        ) : (
          <button
            key={item.action}
            onClick={() => onAction(item.action)}
            className="flex w-full items-center px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors duration-[var(--motion-fast)] text-left"
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

// ─── Tree row ─────────────────────────────────────────────────────────────────

function ColBadge({
  label,
  color,
}: {
  label: string;
  color: "gold" | "blue" | "gray";
}) {
  return (
    <span
      className={cn(
        "px-[3px] py-px text-[8px] font-semibold rounded shrink-0 leading-tight",
        color === "gold" && "bg-syntax-type/15 text-syntax-type",
        color === "blue" && "bg-syntax-number/15 text-syntax-number",
        color === "gray" && "bg-control text-tertiary",
      )}
    >
      {label}
    </span>
  );
}

interface RowProps {
  node: TreeNode;
  isExpanded: boolean;
  isFocused: boolean;
  isMysql?: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onContextMenu: (x: number, y: number) => void;
  onActivate: () => void;
  onAction?: (action: string) => void;
}

function TreeRow({
  node,
  isExpanded,
  isFocused,
  isMysql,
  onToggle,
  onFocus,
  onContextMenu,
  onActivate,
  onAction,
}: RowProps) {
  // MySQL tree is one level shallower (no schema node between database and groups)
  const depthAdj = isMysql ? -1 : 0;
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(e.clientX, e.clientY);
  };

  if (node.kind === "loading") {
    const widths = [52, 72, 60];
    return (
      <div
        className="flex flex-col gap-[5px] py-1"
        style={{ paddingLeft: node.depth * 10 + 18 }}
      >
        {widths.map((w, i) => (
          <div
            key={i}
            className="h-[7px] rounded animate-pulse bg-control"
            style={{ width: w }}
          />
        ))}
      </div>
    );
  }

  if (node.kind === "error") {
    return (
      <div
        className="flex items-center gap-1.5 py-[3px] text-xs text-query-failed"
        style={{ paddingLeft: node.depth * 10 + 8, paddingRight: 8 }}
      >
        <AlertCircle size={10} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{node.message}</span>
        {node.onRetry && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              node.onRetry?.();
            }}
            className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-query-failed hover:bg-query-failed/10 active:bg-query-failed/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-query-failed/30"
          >
            <RotateCw size={9} />
            Retry
          </button>
        )}
      </div>
    );
  }

  const expandable =
    node.kind === "database" ||
    node.kind === "schema" ||
    node.kind === "group" ||
    node.kind === "table";

  // Column row — special layout with badges
  if (node.kind === "column") {
    const { def } = node;
    return (
      <div
        className={cn(
          "flex items-center gap-1 py-[3px] hover:bg-control transition-colors cursor-default",
          isFocused && "bg-accent/10 ring-1 ring-inset ring-accent/30 rounded",
        )}
        style={{ paddingLeft: (4 + depthAdj) * 10 + 8, paddingRight: 8 }}
        onClick={onFocus}
        onContextMenu={handleContextMenu}
      >
        <span className="w-[10px] shrink-0" />
        <span className="text-xs text-label truncate flex-1 min-w-0">
          {def.name}
        </span>
        {def.isPrimaryKey && <ColBadge label="PK" color="gold" />}
        {def.isForeignKey && <ColBadge label="FK" color="blue" />}
        {def.isNullable && !def.isPrimaryKey && (
          <ColBadge label="?" color="gray" />
        )}
        <span className="text-[11px] text-secondary shrink-0 ml-0.5">
          {def.dataType}
        </span>
      </div>
    );
  }

  const baseDepth =
    node.kind === "database"
      ? 0
      : node.kind === "schema"
        ? 1
        : node.kind === "group"
          ? 2
          : 3; // table, view, sequence, function
  const depth = node.kind === "database" ? baseDepth : baseDepth + depthAdj;

  const icon = (() => {
    switch (node.kind) {
      case "database":  return <Database size={11} className="text-schema-database" />;
      case "schema":    return <Folder size={11} className="text-schema-schema" />;
      case "table":     return <Table2 size={11} className="text-schema-table" />;
      case "view":      return <Eye size={11} className="text-schema-view" />;
      case "sequence":  return <Hash size={11} className="text-schema-sequence" />;
      case "function":  return <Zap size={11} className="text-schema-function" />;
      default:          return null;
    }
  })();

  const label = (() => {
    switch (node.kind) {
      case "database":
      case "schema":
        return node.name;
      case "group":
        return node.label;
      case "table":
      case "view":
      case "sequence":
      case "function":
        return node.name;
      default:
        return "";
    }
  })();

  const secondary = (() => {
    if (node.kind === "group") return `${node.count}`;
    if (node.kind === "table" && node.estimatedRows != null) {
      return node.estimatedRows.toLocaleString();
    }
    if (node.kind === "view") return "view";
    return null;
  })();

  const hasInlineActions = onAction && (node.kind === "table" || node.kind === "view");

  const isDataNode = node.kind === "table" || node.kind === "view";

  return (
    <div
      className={cn(
        "group flex items-center gap-1 py-[3px] select-none transition-colors",
        "hover:bg-control",
        "cursor-default",
        isFocused && "bg-accent/10 ring-1 ring-inset ring-accent/30 rounded",
      )}
      style={{ paddingLeft: depth * 10 + 8, paddingRight: 8 }}
      onClick={() => {
        onFocus();
        if (isDataNode) {
          onActivate();
        } else if (expandable) {
          onToggle();
        }
      }}
      onContextMenu={handleContextMenu}
    >
      {/* Chevron — clickable on its own so users can expand columns
       * without triggering the row's primary action. */}
      {expandable ? (
        <button
          type="button"
          aria-label={isExpanded ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
            onToggle();
          }}
          className="shrink-0 p-0 text-secondary hover:text-label transition-colors"
        >
          <ChevronRight
            size={10}
            className={cn(
              "transition-transform duration-100",
              isExpanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span className="w-[10px] shrink-0" />
      )}

      {/* Icon */}
      {icon && (
        <span className="shrink-0 flex items-center">{icon}</span>
      )}

      {/* Label */}
      <span
        className={cn(
          "text-[13px] text-label truncate flex-1 min-w-0",
          node.kind === "group" &&
            "text-secondary text-[11px] uppercase tracking-wide",
        )}
      >
        {label}
      </span>

      {/* Inline hover actions for tables/views */}
      {hasInlineActions && (
        <span
          className={cn(
            "flex items-center gap-0.5 shrink-0 transition-opacity",
            "opacity-0 group-hover:opacity-100",
            isFocused && "opacity-100",
          )}
        >
          <button
            type="button"
            title="Open in table viewer"
            onClick={(e) => { e.stopPropagation(); onAction("open-table"); }}
            className="p-0.5 rounded text-tertiary hover:text-accent hover:bg-accent/10 transition-colors duration-[var(--motion-fast)]"
          >
            <ExternalLink size={10} />
          </button>
          <button
            type="button"
            title="Open in query editor"
            onClick={(e) => { e.stopPropagation(); onAction("open-query"); }}
            className="p-0.5 rounded text-tertiary hover:text-accent hover:bg-accent/10 transition-colors duration-[var(--motion-fast)]"
          >
            <TerminalIcon size={10} />
          </button>
        </span>
      )}

      {/* Secondary — hidden when inline actions are showing */}
      {secondary && (
        <span className={cn(
          "text-[11px] text-secondary shrink-0 ml-1",
          hasInlineActions && "group-hover:hidden",
        )}>
          {secondary}
        </span>
      )}
    </div>
  );
}

// ─── SchemaTree ───────────────────────────────────────────────────────────────

function isNavigable(node: TreeNode) {
  return node.kind !== "loading" && node.kind !== "error";
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

// Postgres' `public` schema is where most user objects live. When a database
// has many schemas (system extensions, per-tenant schemas, etc.) it's annoying
// to scroll to find it, so we always pin it to the top.
function sortSchemas(schemas: string[]): string[] {
  return [...schemas].sort((a, b) => {
    if (a === b) return 0;
    if (a === "public") return -1;
    if (b === "public") return 1;
    return a.localeCompare(b);
  });
}

function nodeDepth(node: TreeNode): number {
  if (node.kind === "database") return 0;
  if (node.kind === "schema") return 1;
  if (node.kind === "group") return 2;
  if (node.kind === "table" || node.kind === "view" || node.kind === "sequence" || node.kind === "function") return 3;
  if (node.kind === "column") return 4;
  return 0;
}

export function SchemaTree({ sessionId, connectionId }: Props) {
  const { toast } = useToast();
  const {
    expandedNodes,
    toggleNode,
    addTab,
    setActiveTab,
    addRecentObject,
    tabs,
    profiles,
  } = useAppStore(
    useShallow((state) => ({
      expandedNodes: state.expandedNodes,
      toggleNode: state.toggleNode,
      addTab: state.addTab,
      setActiveTab: state.setActiveTab,
      addRecentObject: state.addRecentObject,
      tabs: state.tabs,
      profiles: state.profiles,
    })),
  );
  const isExp = (key: string) => !!expandedNodes[key];

  const driver = profiles.find((p) => p.id === connectionId)?.driver ?? "postgres";
  const isMysql = driver === "mysql";

  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const SCHEMA_STALE_MS = 5 * 60 * 1000;

  function refreshSchema() {
    void queryClient.invalidateQueries({ queryKey: ["databases", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["schemas", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["objects", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["columns", sessionId] });
  }

  // Level 1 — databases
  const dbsQuery = useQuery({
    queryKey: ["databases", sessionId],
    queryFn: () => withSessionRetry(connectionId, (sid) => schemaApi.listDatabases(sid), toast),
    staleTime: SCHEMA_STALE_MS,
  });
  const databases = useMemo(() => dbsQuery.data ?? [], [dbsQuery.data]);
  const dbsIsLoading = dbsQuery.isLoading;
  const dbsIsError = dbsQuery.isError;
  const dbsError = dbsQuery.error;
  const refetchDbs = dbsQuery.refetch;

  // Level 2 — schemas (one query per expanded database; skipped for MySQL)
  const expandedDbs = useMemo(
    () => databases.filter((db) => !!expandedNodes[dbKey(connectionId, db)]),
    [connectionId, databases, expandedNodes],
  );
  const schemaQueries = useQueries({
    queries: (isMysql ? [] : expandedDbs).map((db) => ({
      queryKey: ["schemas", sessionId, db],
      queryFn: () => withSessionRetry(connectionId, (sid) => schemaApi.listSchemas(sid, db), toast),
      staleTime: SCHEMA_STALE_MS,
    })),
  });
  const schemasMap = useMemo(() => {
    const next: Record<string, string[]> = {};
    if (isMysql) {
      // For MySQL there is no schema level; use the database name as the pseudo-schema
      expandedDbs.forEach((db) => { next[db] = [db]; });
    } else {
      expandedDbs.forEach((db, i) => {
        next[db] = sortSchemas(schemaQueries[i]?.data ?? []);
      });
    }
    return next;
  }, [expandedDbs, isMysql, schemaQueries]);

  // Level 3 — objects (one query per expanded schema)
  const expandedSchemaEntries = useMemo(() => {
    const entries: { db: string; schema: string }[] = [];
    for (const db of expandedDbs) {
      for (const s of schemasMap[db] ?? []) {
        // MySQL: the db is always "expanded" (no schema node to click)
        if (isMysql || !!expandedNodes[schemaKey(connectionId, db, s)]) {
          entries.push({ db, schema: s });
        }
      }
    }
    return entries;
  }, [connectionId, expandedDbs, expandedNodes, isMysql, schemasMap]);
  const objectQueries = useQueries({
    queries: expandedSchemaEntries.map(({ db, schema }) => ({
      queryKey: ["objects", sessionId, db, schema],
      queryFn: () => withSessionRetry(connectionId, (sid) => schemaApi.listObjects(sid, db, schema), toast),
      staleTime: SCHEMA_STALE_MS,
    })),
  });
  const objectsMap = useMemo(() => {
    const next: Record<string, SchemaObjects> = {};
    expandedSchemaEntries.forEach(({ db, schema }, i) => {
      const data = objectQueries[i]?.data;
      if (data) next[`${db}:${schema}`] = data;
    });
    return next;
  }, [expandedSchemaEntries, objectQueries]);

  // Level 4 — columns (one query per expanded table)
  const expandedTableEntries = useMemo(() => {
    const entries: { db: string; schema: string; table: string }[] = [];
    for (const { db, schema } of expandedSchemaEntries) {
      const objs = objectsMap[`${db}:${schema}`];
      if (!objs) continue;
      if (!expandedNodes[groupKey(connectionId, db, schema, "Tables")]) continue;
      for (const t of objs.tables) {
        if (expandedNodes[tableKey(connectionId, db, schema, t.name)]) {
          entries.push({ db, schema, table: t.name });
        }
      }
    }
    return entries;
  }, [connectionId, expandedNodes, expandedSchemaEntries, objectsMap]);
  const columnQueries = useQueries({
    queries: expandedTableEntries.map(({ db, schema, table }) => ({
      queryKey: ["columns", sessionId, db, schema, table],
      queryFn: () => withSessionRetry(connectionId, (sid) => schemaApi.listColumns(sid, db, schema, table), toast),
      staleTime: SCHEMA_STALE_MS,
    })),
  });
  const columnsMap = useMemo(() => {
    const next: Record<string, ColumnDef[]> = {};
    expandedTableEntries.forEach(({ db, schema, table }, i) => {
      const data = columnQueries[i]?.data;
      if (data) next[`${db}:${schema}:${table}`] = data;
    });
    return next;
  }, [columnQueries, expandedTableEntries]);

  // ── Build flat list ──────────────────────────────────────────────────────────

  type FlatItem = { key: string; node: TreeNode };
  const items = useMemo(() => {
    const items: FlatItem[] = [];
    const trimmedSearchQuery = deferredSearchQuery.trim();

  if (trimmedSearchQuery) {
    // Search mode: fuzzy-filter tables/views across all loaded schemas, sorted by score
    const q = trimmedSearchQuery;
    type ScoredLeaf = { score: number; db: string; schema: string; oKey: string } & (
      | { kind: "table"; t: { name: string; estimatedRowCount: number | null } }
      | { kind: "view"; name: string }
    );
    const leaves: ScoredLeaf[] = [];

    for (const [oKey, objs] of Object.entries(objectsMap)) {
      const colonIdx = oKey.indexOf(":");
      const db = oKey.slice(0, colonIdx);
      const schema = oKey.slice(colonIdx + 1);

      for (const t of objs.tables) {
        const score = fuzzyScore(t.name, q);
        if (score > 0) leaves.push({ kind: "table", score, db, schema, oKey, t });
      }
      for (const v of objs.views) {
        const score = fuzzyScore(v, q);
        if (score > 0) leaves.push({ kind: "view", score, db, schema, oKey, name: v });
      }
    }

    leaves.sort((a, b) => b.score - a.score);

    const seenDbs = new Set<string>();
    const seenSchemas = new Set<string>();

    for (const leaf of leaves) {
      const { db, schema, oKey } = leaf;
      if (!seenDbs.has(db)) {
        seenDbs.add(db);
        items.push({
          key: dbKey(connectionId, db),
          node: { kind: "database", name: db, sessionId, connectionId },
        });
      }
      if (!seenSchemas.has(oKey) && !isMysql) {
        seenSchemas.add(oKey);
        items.push({
          key: schemaKey(connectionId, db, schema),
          node: { kind: "schema", name: schema, database: db, sessionId, connectionId },
        });
      }
      if (leaf.kind === "table") {
        items.push({
          key: tableKey(connectionId, db, schema, leaf.t.name),
          node: { kind: "table", name: leaf.t.name, schema, database: db, sessionId, connectionId, estimatedRows: leaf.t.estimatedRowCount },
        });
      } else {
        items.push({
          key: `${connectionId}:db:${db}:schema:${schema}:view:${leaf.name}`,
          node: { kind: "view", name: leaf.name, schema, database: db, sessionId, connectionId },
        });
      }
    }
  } else {
    // Normal tree mode
    if (dbsIsLoading) {
      items.push({ key: "loading-dbs", node: { kind: "loading", depth: 0 } });
    } else if (dbsIsError) {
      items.push({
        key: "error-dbs",
        node: {
          kind: "error",
          depth: 0,
          message: errorMessage(dbsError, "Could not load databases"),
          onRetry: () => { void refetchDbs(); },
        },
      });
    } else {
      for (const db of databases) {
        const dk = dbKey(connectionId, db);
        const dbExpanded = !!expandedNodes[dk];
        items.push({
          key: dk,
          node: { kind: "database", name: db, sessionId, connectionId },
        });
        if (!dbExpanded) continue;

        if (!isMysql) {
          const sqi = expandedDbs.indexOf(db);
          const sq = schemaQueries[sqi];
          if (!sq || sq.isLoading) {
            items.push({
              key: `${dk}:loading`,
              node: { kind: "loading", depth: 1 },
            });
            continue;
          }
          if (sq.isError) {
            items.push({
              key: `${dk}:error`,
              node: {
                kind: "error",
                depth: 1,
                message: errorMessage(sq.error, "Could not load schemas"),
                onRetry: () => { void sq.refetch(); },
              },
            });
            continue;
          }
        }

        for (const schema of schemasMap[db] ?? []) {
          const sk = schemaKey(connectionId, db, schema);
          // MySQL: skip rendering the schema node (it's the database itself)
          if (!isMysql) {
            const sExpanded = !!expandedNodes[sk];
            items.push({
              key: sk,
              node: { kind: "schema", name: schema, database: db, sessionId, connectionId },
            });
            if (!sExpanded) continue;
          }

          const oki = expandedSchemaEntries.findIndex(
            (e) => e.db === db && e.schema === schema,
          );
          const oq = objectQueries[oki];
          const objLoadingDepth = isMysql ? 1 : 2;
          if (!oq || oq.isLoading) {
            items.push({
              key: `${sk}:loading`,
              node: { kind: "loading", depth: objLoadingDepth },
            });
            continue;
          }
          if (oq.isError) {
            items.push({
              key: `${sk}:error`,
              node: {
                kind: "error",
                depth: objLoadingDepth,
                message: errorMessage(oq.error, "Could not load schema objects"),
                onRetry: () => { void oq.refetch(); },
              },
            });
            continue;
          }

          const objs = objectsMap[`${db}:${schema}`];
          if (!objs) continue;

          const allGroups: { label: GroupLabel; count: number }[] = [
            { label: "Tables", count: objs.tables.length },
            { label: "Views", count: objs.views.length },
            { label: "Sequences", count: objs.sequences.length },
            { label: "Functions", count: objs.functions.length },
          ];

          for (const grp of allGroups) {
            if (grp.count === 0) continue;
            const gk = groupKey(connectionId, db, schema, grp.label);
            const gExpanded = !!expandedNodes[gk];
            items.push({
              key: gk,
              node: { kind: "group", label: grp.label, count: grp.count, schema, database: db, sessionId, connectionId },
            });
            if (!gExpanded) continue;

            if (grp.label === "Tables") {
              for (const t of objs.tables) {
                const tk = tableKey(connectionId, db, schema, t.name);
                const tExpanded = !!expandedNodes[tk];
                items.push({
                  key: tk,
                  node: { kind: "table", name: t.name, schema, database: db, sessionId, connectionId, estimatedRows: t.estimatedRowCount },
                });
                if (!tExpanded) continue;

                const ci = expandedTableEntries.findIndex(
                  (e) =>
                    e.db === db &&
                    e.schema === schema &&
                    e.table === t.name,
                );
                const cq = columnQueries[ci];
                const colLoadingDepth = isMysql ? 3 : 4;
                if (!cq || cq.isLoading) {
                  items.push({
                    key: `${tk}:loading`,
                    node: { kind: "loading", depth: colLoadingDepth },
                  });
                  continue;
                }
                if (cq.isError) {
                  items.push({
                    key: `${tk}:error`,
                    node: {
                      kind: "error",
                      depth: colLoadingDepth,
                      message: errorMessage(cq.error, "Could not load columns"),
                      onRetry: () => { void cq.refetch(); },
                    },
                  });
                  continue;
                }
                for (const col of columnsMap[`${db}:${schema}:${t.name}`] ?? []) {
                  items.push({
                    key: `${tk}:col:${col.name}`,
                    node: { kind: "column", def: col, table: t.name, schema, database: db, sessionId, connectionId },
                  });
                }
              }
            } else if (grp.label === "Views") {
              for (const v of objs.views) {
                items.push({
                  key: `${connectionId}:db:${db}:schema:${schema}:view:${v}`,
                  node: { kind: "view", name: v, schema, database: db, sessionId, connectionId },
                });
              }
            } else if (grp.label === "Sequences") {
              for (const seq of objs.sequences) {
                items.push({
                  key: `${connectionId}:db:${db}:schema:${schema}:seq:${seq}`,
                  node: { kind: "sequence", name: seq, schema, database: db, sessionId, connectionId },
                });
              }
            } else if (grp.label === "Functions") {
              for (const fn of objs.functions) {
                items.push({
                  key: `${connectionId}:db:${db}:schema:${schema}:fn:${fn.name}`,
                  node: { kind: "function", name: fn.name, resultType: fn.resultType, schema, database: db, sessionId, connectionId },
                });
              }
            }
          }
        }
      }
    }
  }

    return items;
  }, [
    columnQueries,
    columnsMap,
    connectionId,
    databases,
    dbsError,
    dbsIsError,
    dbsIsLoading,
    deferredSearchQuery,
    expandedDbs,
    expandedSchemaEntries,
    expandedTableEntries,
    expandedNodes,
    isMysql,
    objectQueries,
    objectsMap,
    schemaQueries,
    schemasMap,
    refetchDbs,
    sessionId,
  ]);

  // ── Keyboard navigation ───────────────────────────────────────────────────────

  const focusedIndex = focusedKey !== null
    ? items.findIndex(({ key }) => key === focusedKey)
    : -1;

  useEffect(() => {
    if (focusedIndex >= 0 && rowsRef.current) {
      const child = rowsRef.current.children[focusedIndex] as HTMLElement | undefined;
      child?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;

    const navItems = items.filter(({ node }) => isNavigable(node));
    if (navItems.length === 0) return;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex < 0) {
          setFocusedKey(navItems[0].key);
        } else {
          for (let i = focusedIndex + 1; i < items.length; i++) {
            if (isNavigable(items[i].node)) { setFocusedKey(items[i].key); break; }
          }
        }
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex <= 0) break;
        for (let i = focusedIndex - 1; i >= 0; i--) {
          if (isNavigable(items[i].node)) { setFocusedKey(items[i].key); break; }
        }
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex < 0) break;
        const { node } = items[focusedIndex];
        const nkey = keyForNode(node);
        if (nkey && !isExp(nkey)) toggleNode(nkey);
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex < 0) break;
        const { node } = items[focusedIndex];
        const nkey = keyForNode(node);
        if (nkey && isExp(nkey)) {
          toggleNode(nkey);
        } else {
          // Move to nearest ancestor (lower depth)
          const curDepth = nodeDepth(node);
          for (let i = focusedIndex - 1; i >= 0; i--) {
            if (isNavigable(items[i].node) && nodeDepth(items[i].node) < curDepth) {
              setFocusedKey(items[i].key);
              break;
            }
          }
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex < 0) break;
        const { node } = items[focusedIndex];
        if (node.kind === "table" || node.kind === "view") {
          openTable(node);
        } else {
          const nkey = keyForNode(node);
          if (nkey) toggleNode(nkey);
        }
        break;
      }
      default:
        break;
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  function handleAction(node: TreeNode, action: string) {
    if (node.kind === "table" || node.kind === "view") {
      if (action === "copy-name") {
        navigator.clipboard.writeText(node.name);
      } else if (action === "copy-qualified") {
        navigator.clipboard.writeText(`${node.schema}.${node.name}`);
      } else if (action === "open-table") {
        openTable(node);
      } else if (action === "open-query") {
        const qualifiedName = isMysql
          ? `\`${node.schema}\`.\`${node.name}\``
          : `"${node.schema}"."${node.name}"`;
        const sql = `SELECT * FROM ${qualifiedName} LIMIT 100;\n`;
        addTab({
          type: "query",
          title: `Query ${node.name}`,
          sessionId,
          queryContext: { sql, connectionId },
          tableContext: {
            database: node.database,
            schema: node.schema,
            table: node.name,
            connectionId,
            estimatedRows: node.kind === "table" ? node.estimatedRows : null,
          },
        });
        addRecentObject({
          type: node.kind as "table" | "view",
          title: `${node.schema}.${node.name}`,
          schema: node.schema,
          table: node.name,
          database: node.database,
          connectionId,
          sessionId,
        });
      }
    } else if (node.kind === "column") {
      if (action === "copy-name") navigator.clipboard.writeText(node.def.name);
      else if (action === "copy-type")
        navigator.clipboard.writeText(node.def.dataType);
    }
    setContextMenu(null);
  }

  function openTable(node: TreeNode) {
    if (node.kind !== "table" && node.kind !== "view") return;

    // Reuse an existing tab for this exact table so repeat clicks don't
    // spawn duplicates — focus it instead.
    const existing = tabs.find(
      (t) =>
        t.type === "table" &&
        t.tableContext?.connectionId === connectionId &&
        t.tableContext?.database === node.database &&
        t.tableContext?.schema === node.schema &&
        t.tableContext?.table === node.name,
    );
    if (existing) {
      setActiveTab(existing.id);
    } else {
      addTab({
        type: "table",
        title: `${node.schema}.${node.name}`,
        sessionId,
        tableContext: {
          database: node.database,
          schema: node.schema,
          table: node.name,
          connectionId,
          estimatedRows: node.kind === "table" ? node.estimatedRows : null,
          isView: node.kind === "view",
        },
      });
    }
    addRecentObject({
      type: node.kind as "table" | "view",
      title: `${node.schema}.${node.name}`,
      schema: node.schema,
      table: node.name,
      database: node.database,
      connectionId,
      sessionId,
    });
  }

  function keyForNode(node: TreeNode): string {
    switch (node.kind) {
      case "database":
        return dbKey(connectionId, node.name);
      case "schema":
        return schemaKey(connectionId, node.database, node.name);
      case "group":
        return groupKey(connectionId, node.database, node.schema, node.label);
      case "table":
        return tableKey(connectionId, node.database, node.schema, node.name);
      default:
        return "";
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setFocusedKey(null);
        }
      }}
    >
      {/* Search input */}
      <div className="px-2 pt-1 pb-1.5 flex items-center gap-1">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-control flex-1 min-w-0">
          <Search size={10} className="text-secondary shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter tables…"
            className="flex-1 text-xs bg-transparent text-label outline-none placeholder:text-secondary min-w-0"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-secondary hover:text-label transition-colors"
            >
              <X size={9} />
            </button>
          )}
        </div>
        <button
          type="button"
          title="Refresh schema"
          onClick={refreshSchema}
          className="shrink-0 p-1 rounded text-secondary hover:text-label hover:bg-control transition-colors duration-[var(--motion-fast)]"
        >
          <RotateCw size={11} />
        </button>
      </div>

      {/* Tree nodes */}
      <div ref={rowsRef}>
        {deferredSearchQuery.trim() && items.length === 0 && (
          <div className="px-3 py-2 text-xs text-secondary">
            No tables matching "{searchQuery}"
          </div>
        )}
        {items.map(({ key, node }) => {
          const nkey = keyForNode(node);
          return (
            <TreeRow
              key={key}
              node={node}
              isExpanded={nkey ? isExp(nkey) : false}
              isFocused={key === focusedKey}
              isMysql={isMysql}
              onToggle={() => nkey && toggleNode(nkey)}
              onFocus={() => setFocusedKey(key)}
              onContextMenu={(x, y) => setContextMenu({ node, x, y })}
              onActivate={() => openTable(node)}
              onAction={(action) => handleAction(node, action)}
            />
          );
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onAction={(action) => handleAction(contextMenu.node, action)}
        />
      )}
    </div>
  );
}
