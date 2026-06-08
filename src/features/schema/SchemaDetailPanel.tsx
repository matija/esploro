import { useReducer } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { CheckSquare, Square, Layers, User, Plus, X } from "lucide-react";
import { useAppStore, type Tab } from "../../store";
import { useToast } from "../../components/Toast";
import { cn } from "../../lib/utils";
import { rolesApi } from "../roles/api";
import type { SchemaPrivilegeOp } from "../roles/types";

const SCHEMA_PRIVILEGES = ["USAGE", "CREATE"] as const;

function schemaPrivOpKey(grantee: string, privilege: string): string {
  return `${grantee}:${privilege}`;
}

// ── Apply Result Dialog ────────────────────────────────────────────────────────

function ApplyResultSummary({
  results,
  onClose,
}: {
  results: { sql: string; error: string | null }[];
  onClose: () => void;
}) {
  const succeeded = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error).length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40 border-0 p-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative z-10 bg-raised rounded-[var(--radius-popover)] border border-separator shadow-[var(--shadow-popover)] p-5 w-[480px] max-h-[60vh] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-label">
            {succeeded} succeeded{failed > 0 ? `, ${failed} failed` : ""}
          </span>
          <button type="button" onClick={onClose} className="text-tertiary hover:text-label transition-colors">
            <X size={14} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 space-y-1.5">
          {results.map((r) => (
            <div
              key={r.sql}
              className={cn(
                "rounded p-2 text-[12px] font-mono",
                r.error ? "bg-query-failed/10 text-query-failed" : "bg-success/10 text-success",
              )}
            >
              <div className="truncate">{r.sql}</div>
              {r.error && (
                <div className="mt-0.5 text-[11px] opacity-80 whitespace-pre-wrap">{r.error}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Schema Privileges Tab ──────────────────────────────────────────────────────

type PrivsState = {
  pendingOps: Map<string, SchemaPrivilegeOp>;
  addedGrantees: string[];
  applying: boolean;
  applyResults: { sql: string; error: string | null }[] | null;
  showRolePicker: boolean;
  roleSearch: string;
};

type PrivsAction =
  | { type: "TOGGLE"; key: string; serverHas: boolean; current: boolean; grantee: string; priv: string }
  | { type: "ADD_GRANTEE"; name: string }
  | { type: "TOGGLE_PICKER" }
  | { type: "SET_SEARCH"; value: string }
  | { type: "APPLY_START" }
  | { type: "APPLY_DONE"; results: { sql: string; error: string | null }[]; schemaName: string }
  | { type: "APPLY_END" }
  | { type: "DISCARD" }
  | { type: "CLOSE_RESULTS" };

function privsReducer(state: PrivsState, action: PrivsAction): PrivsState {
  switch (action.type) {
    case "TOGGLE": {
      const next = new Map(state.pendingOps);
      if (action.serverHas === !action.current) {
        next.delete(action.key);
      } else {
        next.set(action.key, {
          op: action.current ? "revoke" : "grant",
          grantee: action.grantee,
          privilege: action.priv,
        });
      }
      return { ...state, pendingOps: next };
    }
    case "ADD_GRANTEE":
      return {
        ...state,
        addedGrantees: [...state.addedGrantees, action.name],
        showRolePicker: false,
        roleSearch: "",
      };
    case "TOGGLE_PICKER":
      return { ...state, showRolePicker: !state.showRolePicker };
    case "SET_SEARCH":
      return { ...state, roleSearch: action.value };
    case "APPLY_START":
      return { ...state, applying: true };
    case "APPLY_DONE": {
      const failedSqls = new Set(action.results.filter((r) => r.error).map((r) => r.sql));
      const remaining = new Map<string, SchemaPrivilegeOp>();
      for (const [k, op] of state.pendingOps) {
        const sql =
          op.op === "grant"
            ? `GRANT ${op.privilege} ON SCHEMA "${action.schemaName}" TO "${op.grantee}"`
            : `REVOKE ${op.privilege} ON SCHEMA "${action.schemaName}" FROM "${op.grantee}"`;
        if (failedSqls.has(sql)) remaining.set(k, op);
      }
      return {
        ...state,
        applyResults: action.results,
        pendingOps: remaining,
        addedGrantees: failedSqls.size === 0 ? [] : state.addedGrantees,
      };
    }
    case "APPLY_END":
      return { ...state, applying: false };
    case "DISCARD":
      return { ...state, pendingOps: new Map(), addedGrantees: [] };
    case "CLOSE_RESULTS":
      return { ...state, applyResults: null };
  }
}

function SchemaPrivilegesTab({
  schemaName,
  sessionId,
}: {
  schemaName: string;
  sessionId: string;
}) {
  const { toast } = useToast();

  const {
    data: infoData,
    isLoading: infoLoading,
    isError: infoError,
    error: infoErr,
    refetch: refetchInfo,
  } = useQuery({
    queryKey: ["schema-privileges", sessionId, schemaName],
    queryFn: () => rolesApi.listSchemaPrivileges(sessionId, schemaName),
  });

  const { data: allRolesData } = useQuery({
    queryKey: ["roles", sessionId],
    queryFn: () => rolesApi.listRoles(sessionId),
    staleTime: 60_000,
  });

  const [state, dispatch] = useReducer(privsReducer, {
    pendingOps: new Map<string, SchemaPrivilegeOp>(),
    addedGrantees: [] as string[],
    applying: false,
    applyResults: null as { sql: string; error: string | null }[] | null,
    showRolePicker: false,
    roleSearch: "",
  });
  const { pendingOps, addedGrantees, applying, applyResults, showRolePicker, roleSearch } = state;

  function hasPrivilege(grantee: string, priv: string): boolean {
    const key = schemaPrivOpKey(grantee, priv);
    const pending = pendingOps.get(key);
    if (pending) return pending.op === "grant";
    return infoData?.grantees.find((g) => g.grantee === grantee)?.privileges.includes(priv) ?? false;
  }

  function togglePrivilege(grantee: string, priv: string) {
    const current = hasPrivilege(grantee, priv);
    const key = schemaPrivOpKey(grantee, priv);
    const serverHas = infoData?.grantees.find((g) => g.grantee === grantee)?.privileges.includes(priv) ?? false;

    dispatch({ type: "TOGGLE", key, serverHas, current, grantee, priv });
  }

  async function handleApply() {
    const ops = Array.from(pendingOps.values());
    if (ops.length === 0) return;
    dispatch({ type: "APPLY_START" });
    try {
      const results = await rolesApi.manageSchemaPrivileges(sessionId, schemaName, ops);
      const resultItems = results.map((r) => ({ sql: r.sql, error: r.error }));
      dispatch({ type: "APPLY_DONE", results: resultItems, schemaName });
      void refetchInfo();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      dispatch({ type: "APPLY_END" });
    }
  }

  if (infoLoading) {
    return <div className="p-5 text-[13px] text-tertiary">Loading privileges…</div>;
  }
  if (infoError) {
    return (
      <div className="p-5 text-[13px] text-query-failed">
        {infoErr instanceof Error ? infoErr.message : "Failed to load privileges"}
      </div>
    );
  }

  const existingGrantees = infoData?.grantees.map((g) => g.grantee) ?? [];
  const allGrantees = [...existingGrantees, ...addedGrantees.filter((g) => !existingGrantees.includes(g))];

  const availableRoles = (allRolesData ?? []).filter(
    (r) => !allGrantees.includes(r.name) && r.name.toLowerCase().includes(roleSearch.toLowerCase()),
  );

  const isDirty = pendingOps.size > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] uppercase tracking-wide text-tertiary font-medium">Grantees</span>
          <button
            type="button"
            onClick={() => dispatch({ type: "TOGGLE_PICKER" })}
            className="flex items-center gap-1 text-[12px] text-accent hover:text-accent/80 transition-colors"
          >
            <Plus size={12} /> Add grantee
          </button>
        </div>

        {showRolePicker && (
          <div className="mb-3 p-2 bg-control rounded border border-separator">
            <input
              aria-label="Search roles to add as grantee"
              ref={(el) => { el?.focus(); }}
              value={roleSearch}
              onChange={(e) => dispatch({ type: "SET_SEARCH", value: e.target.value })}
              placeholder="Search roles…"
              className="w-full px-2 py-1 text-[12px] bg-transparent outline-none"
            />
            <div className="max-h-32 overflow-y-auto mt-1">
              {availableRoles.length === 0 ? (
                <div className="px-2 py-1 text-[12px] text-tertiary">No roles available</div>
              ) : (
                availableRoles.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => {
                      dispatch({ type: "ADD_GRANTEE", name: r.name });
                    }}
                    className="flex w-full items-center gap-2 px-2 py-1 text-[12px] text-label rounded hover:bg-hover transition-colors"
                  >
                    <User size={11} className="text-tertiary" />
                    {r.name}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {allGrantees.length === 0 ? (
          <div className="text-[13px] text-tertiary">No privileges granted on this schema.</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-separator">
                <th className="text-left py-1 pr-3 text-tertiary font-medium">Role</th>
                {SCHEMA_PRIVILEGES.map((p) => (
                  <th key={p} className="text-center py-1 px-2 text-tertiary font-medium w-20">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allGrantees.map((grantee) => (
                <tr key={grantee} className="border-b border-separator/40 hover:bg-hover">
                  <td className="py-1.5 pr-3 text-label font-mono">{grantee}</td>
                  {SCHEMA_PRIVILEGES.map((priv) => {
                    const checked = hasPrivilege(grantee, priv);
                    const pending = pendingOps.has(schemaPrivOpKey(grantee, priv));
                    return (
                      <td key={priv} className="text-center py-1.5 px-2">
                        <button
                          type="button"
                          onClick={() => togglePrivilege(grantee, priv)}
                          className={cn(
                            "transition-colors",
                            checked ? "text-accent" : "text-tertiary/40",
                            pending && "ring-1 ring-warning rounded",
                          )}
                        >
                          {checked ? <CheckSquare size={13} /> : <Square size={13} />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isDirty && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-separator bg-content">
          <button
            type="button"
            onClick={() => dispatch({ type: "DISCARD" })}
            className="px-3 py-1.5 rounded text-[13px] text-secondary hover:bg-hover hover:text-label transition-colors"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={applying}
            className="px-3 py-1.5 rounded text-[13px] bg-accent text-inverse hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {applying ? "Applying…" : `Apply (${pendingOps.size} change${pendingOps.size > 1 ? "s" : ""})`}
          </button>
        </div>
      )}

      {applyResults && (
        <ApplyResultSummary results={applyResults} onClose={() => dispatch({ type: "CLOSE_RESULTS" })} />
      )}
    </div>
  );
}

// ── SchemaDetailPanel ──────────────────────────────────────────────────────────

export function SchemaDetailPanel({ tab }: { tab: Tab }) {
  const { activeSessions } = useAppStore(
    useShallow((state) => ({ activeSessions: state.activeSessions })),
  );

  const ctx = tab.schemaContext;
  const schemaName = ctx?.schema ?? "";
  const connectionId = ctx?.connectionId ?? "";
  const sessionId = activeSessions[connectionId] ?? "";

  const { data: schemaOwner } = useQuery({
    queryKey: ["schema-privileges", sessionId, schemaName],
    queryFn: () => rolesApi.listSchemaPrivileges(sessionId, schemaName),
    enabled: !!sessionId && !!ctx,
    staleTime: 30_000,
  });

  if (!ctx) return null;

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-tertiary">
        No active session for this connection.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-separator shrink-0">
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-accent/10">
          <Layers size={14} className="text-accent" />
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-label truncate">{schemaName}</div>
          <div className="text-[12px] text-tertiary">
            {schemaOwner ? `owner: ${schemaOwner.owner}` : "schema"}
          </div>
        </div>
      </div>

      {/* Privileges content */}
      <div className="flex-1 overflow-hidden">
        <SchemaPrivilegesTab schemaName={schemaName} sessionId={sessionId} />
      </div>
    </div>
  );
}
