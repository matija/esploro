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
        <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
          <Database size={40} className="text-accent" />
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold text-label">Esploro</p>
          <p className="text-sm text-tertiary mt-0.5">A fast PostgreSQL &amp; MySQL client</p>
        </div>
      </div>

      <div className="bg-control/40 rounded-lg px-5 py-3 space-y-2.5">
        {SHORTCUTS.map(({ icon: Icon, keys, label }) => (
          <div key={keys} className="flex items-center gap-3 text-secondary">
            <Icon size={14} className="text-tertiary shrink-0" />
            <kbd className="font-mono bg-control px-1.5 py-0.5 rounded text-[12px] text-tertiary shrink-0">
              {keys}
            </kbd>
            <span className="text-sm">{label}</span>
          </div>
        ))}
      </div>

      {!hasSession && (
        <button
          onClick={() => setPendingNewConnection(true)}
          className="px-4 py-1.5 rounded-full bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          Connect to a database
        </button>
      )}
    </div>
  );
}
