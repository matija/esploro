import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { CheckSquare, Square, Layers, User, Plus, X } from "lucide-react";
import { useAppStore, type Tab } from "../../store";
import { useToast } from "../../components/Toast";
import { cn } from "../../lib/utils";
import { rolesApi } from "../roles/api";
import type { SchemaPrivilegeOp } from "../roles/types";

const SCHEMA_PRIVILEGES = ["USAGE", "CREATE"] as const;

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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
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

  const [pendingOps, setPendingOps] = useState<Map<string, SchemaPrivilegeOp>>(new Map());
  const [addedGrantees, setAddedGrantees] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<{ sql: string; error: string | null }[] | null>(null);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [roleSearch, setRoleSearch] = useState("");

  function opKey(grantee: string, privilege: string): string {
    return `${grantee}:${privilege}`;
  }

  function hasPrivilege(grantee: string, priv: string): boolean {
    const key = opKey(grantee, priv);
    const pending = pendingOps.get(key);
    if (pending) return pending.op === "grant";
    return infoData?.grantees.find((g) => g.grantee === grantee)?.privileges.includes(priv) ?? false;
  }

  function togglePrivilege(grantee: string, priv: string) {
    const current = hasPrivilege(grantee, priv);
    const key = opKey(grantee, priv);
    const serverHas = infoData?.grantees.find((g) => g.grantee === grantee)?.privileges.includes(priv) ?? false;

    setPendingOps((prev) => {
      const next = new Map(prev);
      if (serverHas === !current) {
        next.delete(key);
      } else {
        next.set(key, { op: current ? "revoke" : "grant", grantee, privilege: priv });
      }
      return next;
    });
  }

  async function handleApply() {
    const ops = Array.from(pendingOps.values());
    if (ops.length === 0) return;
    setApplying(true);
    try {
      const results = await rolesApi.manageSchemaPrivileges(sessionId, schemaName, ops);
      setApplyResults(results.map((r) => ({ sql: r.sql, error: r.error })));
      const failedSqls = new Set(results.filter((r) => r.error).map((r) => r.sql));
      setPendingOps((prev) => {
        const next = new Map<string, SchemaPrivilegeOp>();
        for (const [k, op] of prev) {
          const sql = op.op === "grant"
            ? `GRANT ${op.privilege} ON SCHEMA "${schemaName}" TO "${op.grantee}"`
            : `REVOKE ${op.privilege} ON SCHEMA "${schemaName}" FROM "${op.grantee}"`;
          if (failedSqls.has(sql)) next.set(k, op);
        }
        return next;
      });
      if (failedSqls.size === 0) setAddedGrantees([]);
      void refetchInfo();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setApplying(false);
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
            onClick={() => setShowRolePicker((v) => !v)}
            className="flex items-center gap-1 text-[12px] text-accent hover:text-accent/80 transition-colors"
          >
            <Plus size={12} /> Add grantee
          </button>
        </div>

        {showRolePicker && (
          <div className="mb-3 p-2 bg-control rounded border border-separator">
            <input
              aria-label="Search roles to add as grantee"
              autoFocus
              value={roleSearch}
              onChange={(e) => setRoleSearch(e.target.value)}
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
                      setAddedGrantees((prev) => [...prev, r.name]);
                      setShowRolePicker(false);
                      setRoleSearch("");
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
                    const pending = pendingOps.has(opKey(grantee, priv));
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
            onClick={() => { setPendingOps(new Map()); setAddedGrantees([]); }}
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
        <ApplyResultSummary results={applyResults} onClose={() => setApplyResults(null)} />
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
