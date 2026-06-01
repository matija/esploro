import { useState, useEffect, useMemo, useRef, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import {
  ChevronRight,
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
  Users,
  User,
  Plus,
  CheckSquare,
  Square,
} from "lucide-react";
import { useAppStore } from "../../store";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/ConfirmDialog";
import { fuzzyScore } from "../../lib/fuzzy";
import { withSessionRetry } from "../../lib/sessionRetry";
import { schemaApi } from "./api";
import { rolesApi } from "../roles/api";
import type { TreeNode, SchemaObjects, ColumnDef, GroupLabel } from "./types";
import { cn } from "../../lib/utils";

interface Props {
  sessionId: string;
  connectionId: string;
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

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
  } else if (node.kind === "role") {
    items = [{ label: "Delete role…", action: "delete-role" }];
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
  // No database level in the tree; MySQL is also one level shallower (no schema node)
  const depthAdj = isMysql ? -2 : -1;
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
    node.kind === "schema" ||
    node.kind === "group" ||
    node.kind === "table" ||
    node.kind === "roles-group";

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
    node.kind === "schema" || node.kind === "roles-group"
      ? 1
      : node.kind === "group" || node.kind === "role"
        ? 2
        : 3; // table, view, sequence, function
  const depth = baseDepth + depthAdj;

  const icon = (() => {
    switch (node.kind) {
      case "schema":      return <Folder size={11} className="text-schema-schema" />;
      case "table":       return <Table2 size={11} className="text-schema-table" />;
      case "view":        return <Eye size={11} className="text-schema-view" />;
      case "sequence":    return <Hash size={11} className="text-schema-sequence" />;
      case "function":    return <Zap size={11} className="text-schema-function" />;
      case "roles-group": return <Users size={11} className="text-secondary" />;
      case "role":        return <User size={11} className="text-secondary" />;
      default:            return null;
    }
  })();

  const label = (() => {
    switch (node.kind) {
      case "schema":
        return node.name;
      case "group":
        return node.label;
      case "table":
      case "view":
      case "sequence":
      case "function":
      case "role":
        return node.name;
      case "roles-group":
        return "Roles";
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

  const hasInlineActions = onAction && (node.kind === "table" || node.kind === "view" || node.kind === "roles-group");

  const isDataNode = node.kind === "table" || node.kind === "view" || node.kind === "role";

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

      {/* Inline hover actions for tables/views/roles-group */}
      {hasInlineActions && (
        <span
          className={cn(
            "flex items-center gap-0.5 shrink-0 transition-opacity",
            "opacity-0 group-hover:opacity-100",
            isFocused && "opacity-100",
          )}
        >
          {node.kind === "roles-group" ? (
            <button
              type="button"
              title="Create role"
              onClick={(e) => { e.stopPropagation(); onAction?.("create-role"); }}
              className="p-0.5 rounded text-tertiary hover:text-accent hover:bg-accent/10 transition-colors duration-[var(--motion-fast)]"
            >
              <Plus size={10} />
            </button>
          ) : (
            <>
              <button
                type="button"
                title="Open in table viewer"
                onClick={(e) => { e.stopPropagation(); onAction?.("open-table"); }}
                className="p-0.5 rounded text-tertiary hover:text-accent hover:bg-accent/10 transition-colors duration-[var(--motion-fast)]"
              >
                <ExternalLink size={10} />
              </button>
              <button
                type="button"
                title="Open in query editor"
                onClick={(e) => { e.stopPropagation(); onAction?.("open-query"); }}
                className="p-0.5 rounded text-tertiary hover:text-accent hover:bg-accent/10 transition-colors duration-[var(--motion-fast)]"
              >
                <TerminalIcon size={10} />
              </button>
            </>
          )}
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

// ─── Create Role Modal ────────────────────────────────────────────────────────

function CreateRoleModal({
  sessionId,
  onClose,
  onCreated,
}: {
  sessionId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [canLogin, setCanLogin] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [createDb, setCreateDb] = useState(false);
  const [createRole, setCreateRole] = useState(false);
  const [replication, setReplication] = useState(false);
  const [bypassRls, setBypassRls] = useState(false);
  const [inherit, setInherit] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Role name is required"); return; }
    if (password && password !== confirmPassword) { setError("Passwords do not match"); return; }
    setSubmitting(true);
    setError(null);
    try {
      await rolesApi.createRole(sessionId, {
        name: trimmedName,
        canLogin,
        isSuperuser,
        createDb,
        createRole,
        replication,
        bypassRls,
        inherit,
        password: password || undefined,
      });
      toast(`Role "${trimmedName}" created`, "success");
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const ATTRS: { label: string; value: boolean; set: React.Dispatch<React.SetStateAction<boolean>> }[] = [
    { label: "Login",        value: canLogin,     set: setCanLogin },
    { label: "Superuser",    value: isSuperuser,  set: setIsSuperuser },
    { label: "Create DB",    value: createDb,     set: setCreateDb },
    { label: "Create Role",  value: createRole,   set: setCreateRole },
    { label: "Replication",  value: replication,  set: setReplication },
    { label: "Bypass RLS",   value: bypassRls,    set: setBypassRls },
    { label: "Inherit",      value: inherit,      set: setInherit },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 bg-raised rounded-[var(--radius-popover)] border border-separator shadow-[var(--shadow-popover)] p-5 w-[380px] flex flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-semibold text-label">Create Role</span>
          <button type="button" onClick={onClose} className="text-tertiary hover:text-label transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] text-secondary">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="role_name"
            className="px-2 py-1.5 rounded text-[13px] bg-control border border-separator focus:outline-none focus:ring-1 focus:ring-accent/50 font-mono"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-secondary">Attributes</span>
          <div className="grid grid-cols-2 gap-0.5">
            {ATTRS.map(({ label, value, set }) => (
              <label key={label} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-hover cursor-default select-none">
                <button
                  type="button"
                  onClick={() => set((v) => !v)}
                  className={cn("shrink-0 transition-colors", value ? "text-accent" : "text-tertiary")}
                >
                  {value ? <CheckSquare size={13} /> : <Square size={13} />}
                </button>
                <span className="text-[13px] text-label">{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] text-secondary">Password (optional)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank for no password"
            className="px-2 py-1.5 rounded text-[13px] bg-control border border-separator focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
          {password && (
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              className={cn(
                "px-2 py-1.5 rounded text-[13px] bg-control border border-separator focus:outline-none focus:ring-1 focus:ring-accent/50",
                confirmPassword && confirmPassword !== password && "border-query-failed ring-1 ring-query-failed/50",
              )}
            />
          )}
        </div>

        {error && (
          <div className="text-[12px] text-query-failed bg-query-failed/10 rounded px-2 py-1.5">{error}</div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-[13px] text-secondary hover:bg-hover hover:text-label transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="px-3 py-1.5 rounded text-[13px] bg-accent text-inverse hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Creating…" : "Create Role"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
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
  if (node.kind === "schema" || node.kind === "roles-group") return 1;
  if (node.kind === "group" || node.kind === "role") return 2;
  if (node.kind === "table" || node.kind === "view" || node.kind === "sequence" || node.kind === "function") return 3;
  if (node.kind === "column") return 4;
  return 0;
}

export function SchemaTree({ sessionId, connectionId }: Props) {
  const { toast } = useToast();
  const confirm = useConfirm();
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

  const profile = profiles.find((p) => p.id === connectionId);
  const driver = profile?.driver ?? "postgres";
  const isMysql = driver === "mysql";
  const targetDatabase = profile?.database ?? "";

  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const SCHEMA_STALE_MS = 5 * 60 * 1000;

  function refreshSchema() {
    void queryClient.invalidateQueries({ queryKey: ["schemas", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["objects", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["columns", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["roles", sessionId] });
  }

  // Level 1 — schemas (connection IS the database; MySQL has no schema level)
  const schemasQuery = useQuery({
    queryKey: ["schemas", sessionId, targetDatabase],
    queryFn: () => withSessionRetry(connectionId, (sid) => schemaApi.listSchemas(sid, targetDatabase), toast),
    staleTime: SCHEMA_STALE_MS,
    enabled: !isMysql,
  });
  const schemas = useMemo(() => {
    if (isMysql) return [targetDatabase];
    return sortSchemas(schemasQuery.data ?? []);
  }, [isMysql, schemasQuery.data, targetDatabase]);

  // Roles — Postgres only; fetched when the Roles group is expanded
  const rolesGroupKey = `${connectionId}:roles`;
  const rolesQuery = useQuery({
    queryKey: ["roles", sessionId],
    queryFn: () => withSessionRetry(connectionId, (sid) => rolesApi.listRoles(sid), toast),
    staleTime: SCHEMA_STALE_MS,
    enabled: !isMysql && !!expandedNodes[rolesGroupKey],
  });

  // Level 2 — objects (one query per expanded schema)
  const expandedSchemaEntries = useMemo(() => {
    const entries: { db: string; schema: string }[] = [];
    for (const s of schemas) {
      if (isMysql || !!expandedNodes[schemaKey(connectionId, targetDatabase, s)]) {
        entries.push({ db: targetDatabase, schema: s });
      }
    }
    return entries;
  }, [connectionId, expandedNodes, isMysql, schemas, targetDatabase]);
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

  // Level 3 — columns (one query per expanded table)
  const expandedTableEntries = useMemo(() => {
    const entries: { db: string; schema: string; table: string }[] = [];
    for (const schema of schemas) {
      const objs = objectsMap[`${targetDatabase}:${schema}`];
      if (!objs) continue;
      if (!expandedNodes[groupKey(connectionId, targetDatabase, schema, "Tables")]) continue;
      for (const t of objs.tables) {
        if (expandedNodes[tableKey(connectionId, targetDatabase, schema, t.name)]) {
          entries.push({ db: targetDatabase, schema, table: t.name });
        }
      }
    }
    return entries;
  }, [connectionId, expandedNodes, objectsMap, schemas, targetDatabase]);
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

    const seenSchemas = new Set<string>();

    for (const leaf of leaves) {
      const { db, schema, oKey } = leaf;
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
    // Normal tree mode — schemas are the root level
    if (!isMysql) {
      if (schemasQuery.isLoading) {
        items.push({ key: "loading-schemas", node: { kind: "loading", depth: 0 } });
      } else if (schemasQuery.isError) {
        items.push({
          key: "error-schemas",
          node: {
            kind: "error",
            depth: 0,
            message: errorMessage(schemasQuery.error, "Could not load schemas"),
            onRetry: () => { void schemasQuery.refetch(); },
          },
        });
      }
    }

    if (!schemasQuery.isLoading && !schemasQuery.isError) {
      for (const schema of schemas) {
        const sk = schemaKey(connectionId, targetDatabase, schema);
        // MySQL: skip rendering the schema node (database IS the connection)
        if (!isMysql) {
          const sExpanded = !!expandedNodes[sk];
          items.push({
            key: sk,
            node: { kind: "schema", name: schema, database: targetDatabase, sessionId, connectionId },
          });
          if (!sExpanded) continue;
        }

        const oki = expandedSchemaEntries.findIndex(
          (e) => e.db === targetDatabase && e.schema === schema,
        );
        const oq = objectQueries[oki];
        const objLoadingDepth = isMysql ? 0 : 1;
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

        const objs = objectsMap[`${targetDatabase}:${schema}`];
        if (!objs) continue;

        const allGroups: { label: GroupLabel; count: number }[] = [
          { label: "Tables", count: objs.tables.length },
          { label: "Views", count: objs.views.length },
          { label: "Sequences", count: objs.sequences.length },
          { label: "Functions", count: objs.functions.length },
        ];

        for (const grp of allGroups) {
          if (grp.count === 0) continue;
          const gk = groupKey(connectionId, targetDatabase, schema, grp.label);
          const gExpanded = !!expandedNodes[gk];
          items.push({
            key: gk,
            node: { kind: "group", label: grp.label, count: grp.count, schema, database: targetDatabase, sessionId, connectionId },
          });
          if (!gExpanded) continue;

          if (grp.label === "Tables") {
            for (const t of objs.tables) {
              const tk = tableKey(connectionId, targetDatabase, schema, t.name);
              const tExpanded = !!expandedNodes[tk];
              items.push({
                key: tk,
                node: { kind: "table", name: t.name, schema, database: targetDatabase, sessionId, connectionId, estimatedRows: t.estimatedRowCount },
              });
              if (!tExpanded) continue;

              const ci = expandedTableEntries.findIndex(
                (e) =>
                  e.db === targetDatabase &&
                  e.schema === schema &&
                  e.table === t.name,
              );
              const cq = columnQueries[ci];
              const colLoadingDepth = isMysql ? 2 : 3;
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
              for (const col of columnsMap[`${targetDatabase}:${schema}:${t.name}`] ?? []) {
                items.push({
                  key: `${tk}:col:${col.name}`,
                  node: { kind: "column", def: col, table: t.name, schema, database: targetDatabase, sessionId, connectionId },
                });
              }
            }
          } else if (grp.label === "Views") {
            for (const v of objs.views) {
              items.push({
                key: `${connectionId}:db:${targetDatabase}:schema:${schema}:view:${v}`,
                node: { kind: "view", name: v, schema, database: targetDatabase, sessionId, connectionId },
              });
            }
          } else if (grp.label === "Sequences") {
            for (const seq of objs.sequences) {
              items.push({
                key: `${connectionId}:db:${targetDatabase}:schema:${schema}:seq:${seq}`,
                node: { kind: "sequence", name: seq, schema, database: targetDatabase, sessionId, connectionId },
              });
            }
          } else if (grp.label === "Functions") {
            for (const fn of objs.functions) {
              items.push({
                key: `${connectionId}:db:${targetDatabase}:schema:${schema}:fn:${fn.name}`,
                node: { kind: "function", name: fn.name, resultType: fn.resultType, schema, database: targetDatabase, sessionId, connectionId },
              });
            }
          }
        }
      }
    }

    // Roles section — Postgres only, appended below schemas
    if (!isMysql) {
      items.push({ key: rolesGroupKey, node: { kind: "roles-group", sessionId, connectionId } });
      if (isExp(rolesGroupKey)) {
        if (rolesQuery.isLoading) {
          items.push({ key: `${rolesGroupKey}:loading`, node: { kind: "loading", depth: 2 } });
        } else if (rolesQuery.isError) {
          items.push({
            key: `${rolesGroupKey}:error`,
            node: {
              kind: "error",
              depth: 2,
              message: errorMessage(rolesQuery.error, "Could not load roles"),
              onRetry: () => { void rolesQuery.refetch(); },
            },
          });
        } else {
          for (const role of rolesQuery.data ?? []) {
            items.push({
              key: `${connectionId}:role:${role.name}`,
              node: { kind: "role", name: role.name, sessionId, connectionId },
            });
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
    deferredSearchQuery,
    expandedSchemaEntries,
    expandedTableEntries,
    expandedNodes,
    isMysql,
    objectQueries,
    objectsMap,
    rolesGroupKey,
    rolesQuery.data,
    rolesQuery.error,
    rolesQuery.isError,
    rolesQuery.isLoading,
    rolesQuery.refetch,
    schemas,
    schemasQuery.error,
    schemasQuery.isError,
    schemasQuery.isLoading,
    schemasQuery.refetch,
    sessionId,
    targetDatabase,
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
        } else if (node.kind === "role") {
          openRole(node);
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
    } else if (node.kind === "role") {
      if (action === "delete-role") {
        setContextMenu(null);
        void (async () => {
          const dependents = await rolesApi.getRoleDependents(sessionId, node.name).catch(() => []);
          let description = `This will permanently delete the role "${node.name}".`;
          if (dependents.length > 0) {
            const list = dependents.slice(0, 5).map((d) => `${d.kind}: ${d.name}`).join(", ");
            const more = dependents.length > 5 ? ` and ${dependents.length - 5} more` : "";
            description += ` Owned objects: ${list}${more}. You must reassign or drop them first.`;
          }
          const ok = await confirm({
            title: `Delete role "${node.name}"?`,
            description,
            confirmLabel: "Delete",
            destructive: true,
          });
          if (!ok) return;
          try {
            await rolesApi.dropRole(sessionId, node.name);
            toast(`Role "${node.name}" deleted`, "success");
            void queryClient.invalidateQueries({ queryKey: ["roles", sessionId] });
          } catch (e) {
            toast(e instanceof Error ? e.message : String(e), "error");
          }
        })();
        return;
      }
    } else if (node.kind === "roles-group") {
      if (action === "create-role") {
        setShowCreateRole(true);
        return;
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

  function openRole(node: TreeNode) {
    if (node.kind !== "role") return;
    const existing = tabs.find(
      (t) => t.type === "role" && t.roleContext?.connectionId === connectionId && t.roleContext?.roleName === node.name,
    );
    if (existing) {
      setActiveTab(existing.id);
    } else {
      addTab({ type: "role", title: node.name, sessionId, roleContext: { roleName: node.name, connectionId } });
    }
  }

  function keyForNode(node: TreeNode): string {
    switch (node.kind) {
      case "schema":
        return schemaKey(connectionId, node.database, node.name);
      case "group":
        return groupKey(connectionId, node.database, node.schema, node.label);
      case "table":
        return tableKey(connectionId, node.database, node.schema, node.name);
      case "roles-group":
        return rolesGroupKey;
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
              onActivate={() => {
                if (node.kind === "table" || node.kind === "view") openTable(node);
                else if (node.kind === "role") openRole(node);
              }}
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

      {/* Create Role modal */}
      {showCreateRole && (
        <CreateRoleModal
          sessionId={sessionId}
          onClose={() => setShowCreateRole(false)}
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: ["roles", sessionId] });
          }}
        />
      )}
    </div>
  );
}
