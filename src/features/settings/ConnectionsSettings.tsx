import { Database, Plus } from "lucide-react";
import { useAppStore } from "../../store";

export function ConnectionsSettings() {
  const { setPendingNewConnection } = useAppStore();

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h3 className="text-[11px] font-medium text-secondary uppercase mb-1">
          Connections
        </h3>
        <p className="text-[12px] text-tertiary">
          Manage your database connection profiles.
        </p>
      </div>

      <div className="rounded-[var(--radius-panel)] border border-separator bg-sidebar p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent/10">
            <Database size={16} className="text-accent" />
          </div>
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-label">
              Connections live in the sidebar
            </p>
            <p className="text-[12px] text-tertiary leading-relaxed">
              Add, edit, and delete connections from the Connections section in
              the sidebar. Right-click a connection for additional options like
              duplicate, edit, and delete.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setPendingNewConnection(true)}
          className="inline-flex h-7 w-fit items-center gap-1.5 rounded-[var(--radius-control)] bg-control px-2.5 text-[12px] text-secondary shadow-[var(--shadow-hairline)] transition-colors duration-[var(--motion-fast)] hover:bg-subtle hover:text-label active:bg-active"
        >
          <Plus size={13} />
          New connection
        </button>
      </div>
    </section>
  );
}
