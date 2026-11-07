import { Database, Search, SquarePen, Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../store";

export function WelcomeView() {
  const { activeSessions, profiles, addTab, setPendingNewConnection, setCommandPaletteOpen } = useAppStore(
    useShallow((s) => ({
      activeSessions: s.activeSessions,
      profiles: s.profiles,
      addTab: s.addTab,
      setPendingNewConnection: s.setPendingNewConnection,
      setCommandPaletteOpen: s.setCommandPaletteOpen,
    })),
  );
  const actions = [
    { icon: Plus, label: "New connection", keys: "⌘N", onClick: () => setPendingNewConnection(true) },
    {
      icon: SquarePen,
      label: "New query",
      keys: "⌘T",
      onClick: () => {
        const [connectionId, sessionId] = Object.entries(activeSessions)[0] ?? [];
        addTab({ type: "query", title: "Query", sessionId, queryContext: connectionId ? { sql: "", connectionId } : undefined });
      },
    },
    { icon: Search, label: "Search", keys: "⌘K", onClick: () => setCommandPaletteOpen(true) },
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center min-h-full px-8 py-12 select-none">
      <div className="w-full max-w-xs">
        <Database size={28} strokeWidth={1.5} className="mb-5 text-tertiary" aria-hidden />
        <h1 className="mb-7 text-xl font-semibold tracking-tight text-label">
          {profiles.length > 0 ? "Your workspace" : "Connect to a database"}
        </h1>
        <div className="flex flex-col gap-1">
          {actions.map(({ icon: Icon, label, keys, onClick }) => (
            <button
              key={keys}
              type="button"
              onClick={onClick}
              className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-3 text-left text-[13px] text-secondary transition-colors hover:bg-hover hover:text-label active:bg-pressed"
            >
              <Icon size={16} strokeWidth={1.5} aria-hidden />
              <span className="flex-1">{label}</span>
              <kbd className="text-xs text-tertiary">{keys}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
