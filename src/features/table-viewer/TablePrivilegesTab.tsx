import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, CheckSquare, Square, User, X } from "lucide-react";
import { useToast } from "../../components/Toast";
import { rolesApi } from "../roles/api";
import type { TablePrivilegeOp } from "../roles/types";
import { cn } from "../../lib/utils";

const TABLE_GRANT_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "REFERENCES", "TRIGGER"] as const;

export function PrivApplyResultSummary({
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

export function TablePrivilegesTab({
  sessionId,
  schema,
  table,
}: {
  sessionId: string;
  schema: string;
  table: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: granteesData,
    isLoading: granteesLoading,
    isError: granteesError,
    error: granteesErr,
  } = useQuery({
    queryKey: ["table-privileges", sessionId, schema, table],
    queryFn: () => rolesApi.listTablePrivileges(sessionId, schema, table),
    enabled: !!sessionId,
  });

  const { data: allRolesData } = useQuery({
    queryKey: ["roles", sessionId],
    queryFn: () => rolesApi.listRoles(sessionId),
    staleTime: 5 * 60 * 1000,
    enabled: !!sessionId,
  });

  const [pendingOps, setPendingOps] = useState<Map<string, TablePrivilegeOp>>(new Map());
  const [addedGrantees, setAddedGrantees] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<{ sql: string; error: string | null }[] | null>(null);
  const [showAddGrantee, setShowAddGrantee] = useState(false);
  const [addGranteeSearch, setAddGranteeSearch] = useState("");

  const serverGrantees = useMemo(() => granteesData ?? [], [granteesData]);

  const allGrantees = useMemo(() => {
    const serverSet = new Set(serverGrantees.map((g) => g.grantee));
    return [
      ...serverGrantees.map((g) => g.grantee),
      ...addedGrantees.filter((g) => !serverSet.has(g)),
    ].sort();
  }, [serverGrantees, addedGrantees]);

  function opKey(grantee: string, priv: string) {
    return `${grantee}:${priv}`;
  }

  function hasPrivilege(grantee: string, priv: string): boolean {
    const pending = pendingOps.get(opKey(grantee, priv));
    if (pending) return pending.op === "grant";
    return serverGrantees.find((g) => g.grantee === grantee)?.privileges.includes(priv) ?? false;
  }

  function togglePrivilege(grantee: string, priv: string) {
    const current = hasPrivilege(grantee, priv);
    const serverHas =
      serverGrantees.find((g) => g.grantee === grantee)?.privileges.includes(priv) ?? false;
    const key = opKey(grantee, priv);
    setPendingOps((prev) => {
      const next = new Map(prev);
      if (current === serverHas) {
        next.set(key, { op: current ? "revoke" : "grant", grantee, privilege: priv });
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function addGrantee(grantee: string) {
    if (!allGrantees.includes(grantee)) {
      setAddedGrantees((prev) => [...prev, grantee]);
    }
    setShowAddGrantee(false);
    setAddGranteeSearch("");
  }

  const isDirty = pendingOps.size > 0;

  async function handleApply() {
    const ops = Array.from(pendingOps.values());
    if (ops.length === 0) return;
    setApplying(true);
    try {
      const results = await rolesApi.manageTablePrivileges(sessionId, schema, table, ops);
      setApplyResults(results.map((r) => ({ sql: r.sql, error: r.error })));
      const failedSqls = new Set(results.filter((r) => r.error).map((r) => r.sql));
      setPendingOps((prev) => {
        const next = new Map<string, TablePrivilegeOp>();
        for (const [k, op] of prev) {
          const buildSql = (o: TablePrivilegeOp) =>
            o.op === "grant"
              ? `GRANT ${o.privilege} ON "${schema}"."${table}" TO "${o.grantee}"`
              : `REVOKE ${o.privilege} ON "${schema}"."${table}" FROM "${o.grantee}"`;
          if (failedSqls.has(buildSql(op))) next.set(k, op);
        }
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["table-privileges", sessionId, schema, table] });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setApplying(false);
    }
  }

  const availableGrantees = useMemo(() => {
    const current = new Set(allGrantees);
    return (allRolesData ?? [])
      .filter((r) => !current.has(r.name))
      .filter((r) =>
        addGranteeSearch ? r.name.toLowerCase().includes(addGranteeSearch.toLowerCase()) : true,
      );
  }, [allRolesData, allGrantees, addGranteeSearch]);

  if (granteesLoading) {
    return <div className="p-5 text-[13px] text-tertiary">Loading privileges…</div>;
  }
  if (granteesError) {
    return (
      <div className="p-5 text-[13px] text-query-failed">
        {granteesErr instanceof Error
          ? granteesErr.message
          : "Failed to load privileges"}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto p-4">
        {/* Add grantee button */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] uppercase tracking-wide text-tertiary font-medium">
            Grantees ({allGrantees.length})
          </span>
          <button
            type="button"
            onClick={() => setShowAddGrantee((v) => !v)}
            className="flex items-center gap-1 text-[12px] text-accent hover:text-accent/80 transition-colors"
          >
            <Plus size={12} /> Add grantee
          </button>
        </div>

        {/* Grantee picker */}
        {showAddGrantee && (
          <div className="mb-3 p-2 bg-control rounded border border-separator">
            <input
              autoFocus
              value={addGranteeSearch}
              onChange={(e) => setAddGranteeSearch(e.target.value)}
              placeholder="Search roles…"
              className="w-full px-2 py-1 text-[12px] bg-transparent outline-none"
            />
            <div className="max-h-36 overflow-y-auto mt-1">
              {availableGrantees.length === 0 ? (
                <div className="px-2 py-1 text-[12px] text-tertiary">No roles available</div>
              ) : (
                availableGrantees.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => addGrantee(r.name)}
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

        {/* Privilege grid */}
        {allGrantees.length === 0 ? (
          <div className="text-[13px] text-tertiary">
            No privileges granted on{" "}
            <span className="font-mono text-label">
              {schema}.{table}
            </span>
            .
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-separator">
                <th className="text-left py-1 pr-4 text-tertiary font-medium">Grantee</th>
                {TABLE_GRANT_PRIVILEGES.map((p) => (
                  <th key={p} className="text-center py-1 px-1 text-tertiary font-medium text-[11px] w-14">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allGrantees.map((grantee) => (
                <tr key={grantee} className="border-b border-separator/40 hover:bg-hover">
                  <td className="py-1.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      <User size={11} className="text-tertiary shrink-0" />
                      <span className="text-label font-mono">{grantee}</span>
                    </div>
                  </td>
                  {TABLE_GRANT_PRIVILEGES.map((priv) => {
                    const checked = hasPrivilege(grantee, priv);
                    const pending = pendingOps.has(opKey(grantee, priv));
                    return (
                      <td key={priv} className="text-center py-1.5 px-1">
                        <button
                          type="button"
                          onClick={() => togglePrivilege(grantee, priv)}
                          className={cn(
                            "transition-colors",
                            checked ? "text-accent" : "text-tertiary/40",
                            pending && "ring-1 ring-warning rounded",
                          )}
                        >
                          {checked ? <CheckSquare size={14} /> : <Square size={14} />}
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

      {/* Apply bar */}
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
            {applying
              ? "Applying…"
              : `Apply (${pendingOps.size} change${pendingOps.size !== 1 ? "s" : ""})`}
          </button>
        </div>
      )}

      {applyResults && (
        <PrivApplyResultSummary results={applyResults} onClose={() => setApplyResults(null)} />
      )}
    </div>
  );
}
