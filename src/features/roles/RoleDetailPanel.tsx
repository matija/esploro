import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import {
  CheckSquare,
  Square,
  User,
  Plus,
  X,
  ChevronRight,
} from "lucide-react";
import { useAppStore, type Tab } from "../../store";
import { useToast } from "../../components/Toast";
import { cn } from "../../lib/utils";
import { rolesApi } from "./api";
import type {
  AlterRoleRequest,
  MembershipOp,
  PrivilegeOp,
  RoleSummary,
} from "./types";

const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "REFERENCES", "TRIGGER"] as const;
const SCHEMA_PRIVILEGES = ["USAGE", "CREATE"] as const;

const BOOL_ATTRS: { key: keyof AlterRoleRequest; label: string }[] = [
  { key: "canLogin", label: "Login" },
  { key: "isSuperuser", label: "Superuser" },
  { key: "createDb", label: "Create DB" },
  { key: "createRole", label: "Create Role" },
  { key: "replication", label: "Replication" },
  { key: "bypassRls", label: "Bypass RLS" },
  { key: "inherit", label: "Inherit" },
];

function privilegeOpKey(op: PrivilegeOp) {
  return `${op.objectType}:${op.schema}:${op.name}:${op.privilege}`;
}

interface Props {
  tab: Tab;
}

type PanelTab = "attributes" | "members" | "privileges";

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
          <button
            type="button"
            onClick={onClose}
            className="text-tertiary hover:text-label transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 space-y-1.5">
          {results.map((r) => (
            <div
              key={r.sql}
              className={cn(
                "rounded p-2 text-[12px] font-mono",
                r.error
                  ? "bg-query-failed/10 text-query-failed"
                  : "bg-success/10 text-success",
              )}
            >
              <div className="truncate">{r.sql}</div>
              {r.error && (
                <div className="mt-0.5 text-[11px] opacity-80 whitespace-pre-wrap">
                  {r.error}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Attributes Tab ─────────────────────────────────────────────────────────────

function AttributesTab({
  roleName,
  role,
  sessionId,
  onRefresh,
}: {
  roleName: string;
  role: RoleSummary;
  sessionId: string;
  onRefresh: () => void;
}) {
  const { toast } = useToast();

  const [draft, setDraft] = useState<AlterRoleRequest>({});
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<
    { sql: string; error: string | null }[] | null
  >(null);

  const isDirty =
    Object.keys(draft).length > 0 ||
    password !== "";

  function toggleAttr(key: keyof AlterRoleRequest, current: boolean) {
    setDraft((d) => {
      const next = { ...d };
      if (next[key] === !current) {
        delete next[key];
      } else {
        (next[key] as boolean) = !current;
      }
      return next;
    });
  }

  function effectiveValue(key: keyof AlterRoleRequest): boolean {
    const override = draft[key];
    if (typeof override === "boolean") return override;
    return role[key as keyof RoleSummary] as boolean;
  }

  async function handleApply() {
    const req: AlterRoleRequest = { ...draft };
    if (password !== "") {
      if (password !== confirmPassword) {
        toast("Passwords do not match", "error");
        return;
      }
      req.password = password;
    }

    if (Object.keys(req).length === 0) return;

    setApplying(true);
    try {
      await rolesApi.alterRole(sessionId, roleName, req);
      const alteredSql = buildAlterSql(roleName, req);
      setApplyResults([{ sql: alteredSql, error: null }]);
      setDraft({});
      setPassword("");
      setConfirmPassword("");
      onRefresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const alteredSql = buildAlterSql(roleName, draft);
      setApplyResults([{ sql: alteredSql, error: msg }]);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-5 max-w-lg">
      {/* Boolean attributes */}
      <div className="space-y-1">
        {BOOL_ATTRS.map(({ key, label }) => {
          const val = effectiveValue(key);
          const changed = key in draft;
          return (
            <label
              key={key}
              className={cn(
                "flex items-center gap-2.5 py-1 px-2 rounded cursor-default select-none",
                "hover:bg-hover transition-colors",
              )}
            >
              <button
                type="button"
                onClick={() => toggleAttr(key, effectiveValue(key))}
                className={cn(
                  "shrink-0 transition-colors",
                  val ? "text-accent" : "text-tertiary",
                  changed && "ring-1 ring-warning rounded-sm",
                )}
              >
                {val ? <CheckSquare size={14} /> : <Square size={14} />}
              </button>
              <span className={cn("text-[13px]", changed ? "text-label font-medium" : "text-secondary")}>
                {label}
              </span>
            </label>
          );
        })}
      </div>

      {/* Connection limit */}
      <div className="flex items-center gap-3">
        <label htmlFor="role-conn-limit" className="text-[13px] text-secondary w-32 shrink-0">Connection limit</label>
        <input
          id="role-conn-limit"
          type="number"
          min={-1}
          value={draft.connLimit ?? role.connLimit}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v)) {
              if (v === role.connLimit) {
                setDraft((d) => { const n = { ...d }; delete n.connLimit; return n; });
              } else {
                setDraft((d) => ({ ...d, connLimit: v }));
              }
            }
          }}
          className={cn(
            "w-24 px-2 py-1 rounded text-[13px] bg-control border border-separator focus:outline-none focus:ring-1 focus:ring-accent/50",
            "connLimit" in draft && "ring-1 ring-warning border-warning",
          )}
        />
        <span className="text-[12px] text-tertiary">(-1 = unlimited)</span>
      </div>

      {/* Valid until */}
      <div className="flex items-center gap-3">
        <label htmlFor="role-valid-until" className="text-[13px] text-secondary w-32 shrink-0">Valid until</label>
        <input
          id="role-valid-until"
          type="date"
          value={
            (draft.validUntil !== undefined
              ? draft.validUntil
              : role.validUntil?.substring(0, 10)) ?? ""
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v === (role.validUntil?.substring(0, 10) ?? "")) {
              setDraft((d) => { const n = { ...d }; delete n.validUntil; return n; });
            } else {
              setDraft((d) => ({ ...d, validUntil: v }));
            }
          }}
          className={cn(
            "px-2 py-1 rounded text-[13px] bg-control border border-separator focus:outline-none focus:ring-1 focus:ring-accent/50",
            "validUntil" in draft && "ring-1 ring-warning border-warning",
          )}
        />
        {role.validUntil && (
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, validUntil: "" }))}
            className="text-[12px] text-tertiary hover:text-label"
          >
            Clear
          </button>
        )}
      </div>

      {/* Password */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <label htmlFor="role-new-password" className="text-[13px] text-secondary w-32 shrink-0">New password</label>
          <input
            id="role-new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to keep current"
            className="flex-1 px-2 py-1 rounded text-[13px] bg-control border border-separator focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
        </div>
        {password && (
          <div className="flex items-center gap-3">
            <label htmlFor="role-confirm-password" className="text-[13px] text-secondary w-32 shrink-0">Confirm</label>
            <input
              id="role-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={cn(
                "flex-1 px-2 py-1 rounded text-[13px] bg-control border border-separator focus:outline-none focus:ring-1 focus:ring-accent/50",
                confirmPassword && confirmPassword !== password && "border-query-failed ring-1 ring-query-failed/50",
              )}
            />
          </div>
        )}
      </div>

      {/* Apply bar */}
      {isDirty && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => { setDraft({}); setPassword(""); setConfirmPassword(""); }}
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
            {applying ? "Applying…" : "Apply"}
          </button>
        </div>
      )}

      {applyResults && (
        <ApplyResultSummary
          results={applyResults}
          onClose={() => setApplyResults(null)}
        />
      )}
    </div>
  );
}

function buildAlterSql(roleName: string, req: AlterRoleRequest): string {
  const opts: string[] = [];
  if (req.canLogin !== undefined) opts.push(req.canLogin ? "LOGIN" : "NOLOGIN");
  if (req.isSuperuser !== undefined) opts.push(req.isSuperuser ? "SUPERUSER" : "NOSUPERUSER");
  if (req.createDb !== undefined) opts.push(req.createDb ? "CREATEDB" : "NOCREATEDB");
  if (req.createRole !== undefined) opts.push(req.createRole ? "CREATEROLE" : "NOCREATEROLE");
  if (req.replication !== undefined) opts.push(req.replication ? "REPLICATION" : "NOREPLICATION");
  if (req.bypassRls !== undefined) opts.push(req.bypassRls ? "BYPASSRLS" : "NOBYPASSRLS");
  if (req.inherit !== undefined) opts.push(req.inherit ? "INHERIT" : "NOINHERIT");
  if (req.connLimit !== undefined) opts.push(`CONNECTION LIMIT ${req.connLimit}`);
  if (req.validUntil !== undefined)
    opts.push(req.validUntil ? `VALID UNTIL '${req.validUntil}'` : "VALID UNTIL 'infinity'");
  if (req.password !== undefined) opts.push("PASSWORD ***");
  return `ALTER ROLE "${roleName}" WITH ${opts.join(" ")}`;
}

// ── Members Tab ────────────────────────────────────────────────────────────────

function MembersTab({
  roleName,
  sessionId,
  onRefresh,
}: {
  roleName: string;
  sessionId: string;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const { data: membersData, refetch: refetchMembers } = useQuery({
    queryKey: ["role-members", sessionId, roleName],
    queryFn: () => rolesApi.listRoleMembers(sessionId, roleName),
  });
  const { data: allRolesData } = useQuery({
    queryKey: ["roles", sessionId],
    queryFn: () => rolesApi.listRoles(sessionId),
    staleTime: 5 * 60 * 1000,
  });

  const [pendingOps, setPendingOps] = useState<MembershipOp[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<
    { sql: string; error: string | null }[] | null
  >(null);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberOfSearch, setAddMemberOfSearch] = useState("");
  const [showAddMemberOf, setShowAddMemberOf] = useState(false);

  const members = useMemo(() => {
    const base = membersData?.members ?? [];
    const added = pendingOps
      .filter((op) => op.op === "grant" && op.role === roleName)
      .map((op) => op.member);
    const removed = new Set(
      pendingOps
        .filter((op) => op.op === "revoke" && op.role === roleName)
        .map((op) => op.member),
    );
    return [...new Set([...base, ...added])].filter((m) => !removed.has(m)).sort();
  }, [membersData, pendingOps, roleName]);

  const memberOf = useMemo(() => {
    const base = membersData?.memberOf ?? [];
    const added = pendingOps
      .filter((op) => op.op === "grant" && op.member === roleName)
      .map((op) => op.role);
    const removed = new Set(
      pendingOps
        .filter((op) => op.op === "revoke" && op.member === roleName)
        .map((op) => op.role),
    );
    return [...new Set([...base, ...added])].filter((r) => !removed.has(r)).sort();
  }, [membersData, pendingOps, roleName]);

  function addMember(member: string) {
    const existsInServer = membersData?.members.includes(member);
    const existsInPending = pendingOps.some(
      (op) => op.op === "grant" && op.role === roleName && op.member === member,
    );
    if (existsInServer || existsInPending) return;
    // Remove any pending revoke for this member
    setPendingOps((ops) =>
      ops.filter(
        (op) => !(op.op === "revoke" && op.role === roleName && op.member === member),
      ).concat({ op: "grant", role: roleName, member }),
    );
    setShowAddMember(false);
    setAddMemberSearch("");
  }

  function removeMember(member: string) {
    const isFromServer = membersData?.members.includes(member);
    if (isFromServer) {
      setPendingOps((ops) => [
        ...ops.filter(
          (op) => !(op.op === "grant" && op.role === roleName && op.member === member),
        ),
        { op: "revoke", role: roleName, member },
      ]);
    } else {
      setPendingOps((ops) =>
        ops.filter(
          (op) => !(op.op === "grant" && op.role === roleName && op.member === member),
        ),
      );
    }
  }

  function addMemberOf(parentRole: string) {
    const existsInServer = membersData?.memberOf.includes(parentRole);
    const existsInPending = pendingOps.some(
      (op) => op.op === "grant" && op.member === roleName && op.role === parentRole,
    );
    if (existsInServer || existsInPending) return;
    setPendingOps((ops) =>
      ops.filter(
        (op) => !(op.op === "revoke" && op.member === roleName && op.role === parentRole),
      ).concat({ op: "grant", role: parentRole, member: roleName }),
    );
    setShowAddMemberOf(false);
    setAddMemberOfSearch("");
  }

  function removeMemberOf(parentRole: string) {
    const isFromServer = membersData?.memberOf.includes(parentRole);
    if (isFromServer) {
      setPendingOps((ops) => [
        ...ops.filter(
          (op) => !(op.op === "grant" && op.member === roleName && op.role === parentRole),
        ),
        { op: "revoke", role: parentRole, member: roleName },
      ]);
    } else {
      setPendingOps((ops) =>
        ops.filter(
          (op) => !(op.op === "grant" && op.member === roleName && op.role === parentRole),
        ),
      );
    }
  }

  async function handleApply() {
    if (pendingOps.length === 0) return;
    setApplying(true);
    try {
      const results = await rolesApi.manageRoleMembership(sessionId, pendingOps);
      const formatted = results.map((r) => ({
        sql:
          r.op === "grant"
            ? `GRANT "${r.role}" TO "${r.member}"`
            : `REVOKE "${r.role}" FROM "${r.member}"`,
        error: r.error,
      }));
      setApplyResults(formatted);
      const allOk = results.every((r) => !r.error);
      if (allOk) {
        setPendingOps([]);
        void refetchMembers();
        onRefresh();
      } else {
        const failedOps = new Set(
          results
            .filter((r) => r.error)
            .map((r) => `${r.op}:${r.role}:${r.member}`),
        );
        setPendingOps((ops) =>
          ops.filter((op) => failedOps.has(`${op.op}:${op.role}:${op.member}`)),
        );
        void refetchMembers();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setApplying(false);
    }
  }

  const availableForMembers = useMemo(() => {
    const current = new Set(members);
    return (allRolesData ?? []).filter(
      (r) =>
        r.name !== roleName &&
        !current.has(r.name) &&
        (!addMemberSearch || r.name.toLowerCase().includes(addMemberSearch.toLowerCase())),
    );
  }, [allRolesData, members, roleName, addMemberSearch]);

  const availableForMemberOf = useMemo(() => {
    const current = new Set(memberOf);
    return (allRolesData ?? []).filter(
      (r) =>
        r.name !== roleName &&
        !current.has(r.name) &&
        (!addMemberOfSearch || r.name.toLowerCase().includes(addMemberOfSearch.toLowerCase())),
    );
  }, [allRolesData, memberOf, roleName, addMemberOfSearch]);

  const isDirty = pendingOps.length > 0;

  return (
    <div className="flex flex-col gap-5 p-5 max-w-lg">
      {/* Members list (roles/users that belong to this role) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-wide text-tertiary font-medium">
            Members ({members.length})
          </span>
          <button
            type="button"
            onClick={() => setShowAddMember((v) => !v)}
            className="flex items-center gap-1 text-[12px] text-accent hover:text-accent/80 transition-colors"
          >
            <Plus size={12} /> Add member
          </button>
        </div>

        {showAddMember && (
          <div className="mb-2 p-2 bg-control rounded border border-separator">
            <input
              aria-label="Search roles to add as member"
              ref={(el) => { el?.focus(); }}
              value={addMemberSearch}
              onChange={(e) => setAddMemberSearch(e.target.value)}
              placeholder="Search roles…"
              className="w-full px-2 py-1 text-[12px] bg-transparent outline-none"
            />
            <div className="max-h-32 overflow-y-auto mt-1">
              {availableForMembers.length === 0 ? (
                <div className="px-2 py-1 text-[12px] text-tertiary">No roles available</div>
              ) : (
                availableForMembers.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => addMember(r.name)}
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

        <div className="space-y-0.5">
          {members.length === 0 && (
            <div className="text-[12px] text-tertiary py-1">No members</div>
          )}
          {members.map((m) => {
            const isPending = pendingOps.some(
              (op) => op.role === roleName && op.member === m,
            );
            return (
              <div
                key={m}
                className={cn(
                  "flex items-center gap-2 px-2 py-1 rounded group",
                  isPending && "bg-warning/10",
                )}
              >
                <User size={11} className="text-tertiary shrink-0" />
                <span className="text-[13px] text-label flex-1">{m}</span>
                <button
                  type="button"
                  onClick={() => removeMember(m)}
                  className="opacity-0 group-hover:opacity-100 text-tertiary hover:text-query-failed transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Member of list (roles this role inherits from) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-wide text-tertiary font-medium">
            Member of ({memberOf.length})
          </span>
          <button
            type="button"
            onClick={() => setShowAddMemberOf((v) => !v)}
            className="flex items-center gap-1 text-[12px] text-accent hover:text-accent/80 transition-colors"
          >
            <Plus size={12} /> Add
          </button>
        </div>

        {showAddMemberOf && (
          <div className="mb-2 p-2 bg-control rounded border border-separator">
            <input
              aria-label="Search roles to add to member of"
              ref={(el) => { el?.focus(); }}
              value={addMemberOfSearch}
              onChange={(e) => setAddMemberOfSearch(e.target.value)}
              placeholder="Search roles…"
              className="w-full px-2 py-1 text-[12px] bg-transparent outline-none"
            />
            <div className="max-h-32 overflow-y-auto mt-1">
              {availableForMemberOf.length === 0 ? (
                <div className="px-2 py-1 text-[12px] text-tertiary">No roles available</div>
              ) : (
                availableForMemberOf.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => addMemberOf(r.name)}
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

        <div className="space-y-0.5">
          {memberOf.length === 0 && (
            <div className="text-[12px] text-tertiary py-1">Not a member of any role</div>
          )}
          {memberOf.map((r) => {
            const isPending = pendingOps.some(
              (op) => op.member === roleName && op.role === r,
            );
            return (
              <div
                key={r}
                className={cn(
                  "flex items-center gap-2 px-2 py-1 rounded group",
                  isPending && "bg-warning/10",
                )}
              >
                <User size={11} className="text-tertiary shrink-0" />
                <span className="text-[13px] text-label flex-1">{r}</span>
                <button
                  type="button"
                  onClick={() => removeMemberOf(r)}
                  className="opacity-0 group-hover:opacity-100 text-tertiary hover:text-query-failed transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Apply bar */}
      {isDirty && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setPendingOps([])}
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
            {applying ? "Applying…" : `Apply (${pendingOps.length} op${pendingOps.length > 1 ? "s" : ""})`}
          </button>
        </div>
      )}

      {applyResults && (
        <ApplyResultSummary
          results={applyResults}
          onClose={() => setApplyResults(null)}
        />
      )}
    </div>
  );
}

// ── Privileges Tab ─────────────────────────────────────────────────────────────

function PrivilegesTab({
  roleName,
  sessionId,
}: {
  roleName: string;
  sessionId: string;
}) {
  const { toast } = useToast();
  const {
    data: privsData,
    isLoading: privsLoading,
    isError: privsError,
    error: privsErr,
    refetch: refetchPrivs,
  } = useQuery({
    queryKey: ["role-privileges", sessionId, roleName],
    queryFn: () => rolesApi.listRolePrivileges(sessionId, roleName),
  });

  // pendingOps: maps "type:schema:name:priv" -> PrivilegeOp
  const [pendingOps, setPendingOps] = useState<Map<string, PrivilegeOp>>(new Map());
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<
    { sql: string; error: string | null }[] | null
  >(null);
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());

  function hasPrivilege(objectType: "table" | "schema", schema: string, name: string, priv: string): boolean {
    const key = `${objectType}:${schema}:${name}:${priv}`;
    const pending = pendingOps.get(key);
    if (pending) return pending.op === "grant";

    if (objectType === "table") {
      const grant = privsData?.tableGrants.find(
        (g) => g.schema === schema && g.table === name,
      );
      return grant?.privileges.includes(priv) ?? false;
    } else {
      const grant = privsData?.schemaGrants.find((g) => g.schema === schema);
      return grant?.privileges.includes(priv) ?? false;
    }
  }

  function togglePrivilege(objectType: "table" | "schema", schema: string, name: string, priv: string) {
    const current = hasPrivilege(objectType, schema, name, priv);
    const op: PrivilegeOp = {
      op: current ? "revoke" : "grant",
      objectType,
      schema,
      name,
      privilege: priv,
    };
    const key = privilegeOpKey(op);

    // Check if this is a no-op (reverting to server state)
    const serverHas =
      objectType === "table"
        ? privsData?.tableGrants.find((g) => g.schema === schema && g.table === name)?.privileges.includes(priv) ?? false
        : privsData?.schemaGrants.find((g) => g.schema === schema)?.privileges.includes(priv) ?? false;

    setPendingOps((prev) => {
      const next = new Map(prev);
      if (serverHas === !current) {
        next.delete(key);
      } else {
        next.set(key, op);
      }
      return next;
    });
  }

  async function handleApply() {
    const ops = Array.from(pendingOps.values());
    if (ops.length === 0) return;
    setApplying(true);
    try {
      const results = await rolesApi.manageRolePrivileges(sessionId, roleName, ops);
      setApplyResults(results.map((r) => ({ sql: r.sql, error: r.error })));
      const failedSqls = new Set(results.filter((r) => r.error).map((r) => r.sql));
      setPendingOps((prev) => {
        const next = new Map<string, PrivilegeOp>();
        for (const [k, op] of prev) {
          const buildSql = (o: PrivilegeOp) =>
            o.op === "grant"
              ? o.objectType === "table"
                ? `GRANT ${o.privilege} ON "${o.schema}"."${o.name}" TO "${roleName}"`
                : `GRANT ${o.privilege} ON SCHEMA "${o.schema}" TO "${roleName}"`
              : o.objectType === "table"
                ? `REVOKE ${o.privilege} ON "${o.schema}"."${o.name}" FROM "${roleName}"`
                : `REVOKE ${o.privilege} ON SCHEMA "${o.schema}" FROM "${roleName}"`;
          if (failedSqls.has(buildSql(op))) {
            next.set(k, op);
          }
        }
        return next;
      });
      void refetchPrivs();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setApplying(false);
    }
  }

  const tableGrants = privsData?.tableGrants ?? [];
  const schemaGrants = privsData?.schemaGrants ?? [];

  // Group tables by schema — must be called before any conditional returns
  const tablesBySchema = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of privsData?.tableGrants ?? []) {
      if (!map.has(g.schema)) map.set(g.schema, []);
      map.get(g.schema)!.push(g.table);
    }
    return map;
  }, [privsData?.tableGrants]);

  if (privsLoading) {
    return <div className="p-5 text-[13px] text-tertiary">Loading privileges…</div>;
  }
  if (privsError) {
    return (
      <div className="p-5 text-[13px] text-query-failed">
        {privsErr instanceof Error ? privsErr.message : "Failed to load privileges"}
      </div>
    );
  }

  const hasAnyData = tableGrants.length > 0 || schemaGrants.length > 0 || pendingOps.size > 0;

  if (!hasAnyData) {
    return (
      <div className="p-5 text-[13px] text-tertiary">
        No table or schema privileges granted to <span className="font-mono text-label">{roleName}</span>.
      </div>
    );
  }

  const isDirty = pendingOps.size > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* Schema grants */}
        {schemaGrants.length > 0 && (
          <div className="p-4">
            <div className="text-[11px] uppercase tracking-wide text-tertiary mb-2">Schema Grants</div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-separator">
                  <th className="text-left py-1 pr-3 text-tertiary font-medium">Schema</th>
                  {SCHEMA_PRIVILEGES.map((p) => (
                    <th key={p} className="text-center py-1 px-2 text-tertiary font-medium w-16">{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schemaGrants.map((g) => (
                  <tr key={g.schema} className="border-b border-separator/40 hover:bg-hover">
                    <td className="py-1.5 pr-3 text-label font-mono">{g.schema}</td>
                    {SCHEMA_PRIVILEGES.map((priv) => {
                      const checked = hasPrivilege("schema", g.schema, g.schema, priv);
                      const pending = pendingOps.has(`schema:${g.schema}:${g.schema}:${priv}`);
                      return (
                        <td key={priv} className="text-center py-1.5 px-2">
                          <button
                            type="button"
                            onClick={() => togglePrivilege("schema", g.schema, g.schema, priv)}
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
          </div>
        )}

        {/* Table grants by schema */}
        {Array.from(tablesBySchema.entries()).map(([schema, tables]) => (
          <div key={schema} className="p-4">
            <button
              type="button"
              onClick={() =>
                setExpandedSchemas((prev) => {
                  const next = new Set(prev);
                  if (next.has(schema)) next.delete(schema);
                  else next.add(schema);
                  return next;
                })
              }
              className="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wide text-tertiary hover:text-label transition-colors"
            >
              <ChevronRight
                size={10}
                className={cn(
                  "transition-transform duration-100",
                  expandedSchemas.has(schema) && "rotate-90",
                )}
              />
              {schema} ({tables.length} table{tables.length !== 1 ? "s" : ""})
            </button>

            {expandedSchemas.has(schema) && (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-separator">
                    <th className="text-left py-1 pr-3 text-tertiary font-medium">Table</th>
                    {TABLE_PRIVILEGES.map((p) => (
                      <th key={p} className="text-center py-1 px-1 text-tertiary font-medium text-[11px] w-14">{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tables.map((table) => (
                    <tr key={table} className="border-b border-separator/40 hover:bg-hover">
                      <td className="py-1.5 pr-3 text-label font-mono">{table}</td>
                      {TABLE_PRIVILEGES.map((priv) => {
                        const checked = hasPrivilege("table", schema, table, priv);
                        const pending = pendingOps.has(`table:${schema}:${table}:${priv}`);
                        return (
                          <td key={priv} className="text-center py-1.5 px-1">
                            <button
                              type="button"
                              onClick={() => togglePrivilege("table", schema, table, priv)}
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
        ))}
      </div>

      {/* Apply bar */}
      {isDirty && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-separator bg-content">
          <button
            type="button"
            onClick={() => setPendingOps(new Map())}
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
              : `Apply (${pendingOps.size} change${pendingOps.size > 1 ? "s" : ""})`}
          </button>
        </div>
      )}

      {applyResults && (
        <ApplyResultSummary
          results={applyResults}
          onClose={() => setApplyResults(null)}
        />
      )}
    </div>
  );
}

// ── RoleDetailPanel ────────────────────────────────────────────────────────────

export function RoleDetailPanel({ tab }: Props) {
  const { activeSessions } = useAppStore(
    useShallow((state) => ({ activeSessions: state.activeSessions })),
  );
  const queryClient = useQueryClient();

  const ctx = tab.roleContext;
  const roleName = ctx?.roleName ?? "";
  const connectionId = ctx?.connectionId ?? "";
  const sessionId = activeSessions[connectionId] ?? "";

  const [activeTab, setActiveTab] = useState<PanelTab>("attributes");

  const { data: rolesData, isLoading: roleLoading } = useQuery({
    queryKey: ["roles", sessionId],
    queryFn: () => rolesApi.listRoles(sessionId),
    enabled: !!sessionId && !!ctx,
    staleTime: 60_000,
  });

  const role = useMemo(
    () => rolesData?.find((r) => r.name === roleName),
    [rolesData, roleName],
  );

  function handleRefresh() {
    void queryClient.invalidateQueries({ queryKey: ["roles", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["role-members", sessionId, roleName] });
    void queryClient.invalidateQueries({ queryKey: ["role-privileges", sessionId, roleName] });
  }

  if (!ctx) return null;

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-tertiary">
        No active session for this connection.
      </div>
    );
  }

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-tertiary">
        Loading role…
      </div>
    );
  }

  if (!role) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-tertiary">
        Role <span className="mx-1 font-mono text-label">{roleName}</span> not found.
      </div>
    );
  }

  const tabClass = (t: PanelTab) =>
    cn(
      "px-3 py-1.5 text-[13px] rounded-[var(--radius-control)] transition-colors select-none",
      activeTab === t
        ? "bg-control text-label shadow-[var(--shadow-hairline)]"
        : "text-secondary hover:text-label hover:bg-hover",
    );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-separator shrink-0">
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-accent/10">
          <User size={14} className="text-accent" />
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-label truncate">{roleName}</div>
          <div className="text-[12px] text-tertiary">
            {role.canLogin ? "Login role" : "Group role"}
            {role.isSuperuser && " · Superuser"}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-separator shrink-0">
        <button type="button" className={tabClass("attributes")} onClick={() => setActiveTab("attributes")}>
          Attributes
        </button>
        <button type="button" className={tabClass("members")} onClick={() => setActiveTab("members")}>
          Members
        </button>
        <button type="button" className={tabClass("privileges")} onClick={() => setActiveTab("privileges")}>
          Privileges
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "attributes" && (
          <AttributesTab
            roleName={roleName}
            role={role}
            sessionId={sessionId}
            onRefresh={handleRefresh}
          />
        )}
        {activeTab === "members" && (
          <MembersTab
            roleName={roleName}
            sessionId={sessionId}
            onRefresh={handleRefresh}
          />
        )}
        {activeTab === "privileges" && (
          <PrivilegesTab
            roleName={roleName}
            sessionId={sessionId}
          />
        )}
      </div>
    </div>
  );
}
