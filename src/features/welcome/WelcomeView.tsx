import { Database, Search, SquarePen, Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../store";

const SHORTCUTS = [
  { icon: Search, keys: "⌘K", label: "Search tables & commands" },
  { icon: SquarePen, keys: "⌘T", label: "New query" },
  { icon: Plus, keys: "⌘N", label: "New connection" },
];

export function WelcomeView() {
  const { activeSessions, setPendingNewConnection } = useAppStore(
    useShallow((s) => ({
      activeSessions: s.activeSessions,
      setPendingNewConnection: s.setPendingNewConnection,
    })),
  );
  const hasSession = Object.keys(activeSessions).length > 0;

  return (
    <div className="flex flex-col items-center justify-center flex-1 h-full gap-5 select-none">
      <div className="flex flex-col items-center gap-2">
        <div className="w-16 h-16 rounded-[var(--radius-panel)] border border-separator bg-sidebar shadow-[var(--shadow-hairline)] flex items-center justify-center">
          <Database size={40} className="text-secondary" />
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold text-label">Esploro</p>
          <p className="text-sm text-tertiary mt-0.5">A fast PostgreSQL &amp; MySQL client</p>
        </div>
      </div>

      <div className="rounded-[var(--radius-panel)] border border-separator bg-sidebar px-5 py-3 shadow-[var(--shadow-hairline)] space-y-2.5">
        {SHORTCUTS.map(({ icon: Icon, keys, label }) => (
          <div key={keys} className="flex items-center gap-3 text-secondary">
            <Icon size={14} className="text-tertiary shrink-0" />
            <kbd className="font-mono bg-content border border-separator/60 px-1.5 py-0.5 rounded-[var(--radius-badge)] text-[12px] text-tertiary shrink-0">
              {keys}
            </kbd>
            <span className="text-sm">{label}</span>
          </div>
        ))}
      </div>

      {!hasSession && (
        <button
          type="button"
          onClick={() => setPendingNewConnection(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-separator bg-control px-3 text-sm font-medium text-label shadow-[var(--shadow-hairline)] transition-colors duration-[var(--motion-fast)] hover:bg-subtle active:bg-active"
        >
          <Plus size={14} className="text-secondary" />
          Connect to a database
        </button>
      )}
    </div>
  );
}
