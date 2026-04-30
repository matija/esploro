import { X, Loader2, Database, Terminal, Settings } from "lucide-react";
import { useAppStore, type Tab } from "../store";
import { cn } from "../lib/utils";

function tabIcon(tab: Tab) {
  switch (tab.type) {
    case "table":
      return <Database size={11} className="shrink-0 text-tertiary" />;
    case "query":
      return <Terminal size={11} className="shrink-0 text-tertiary" />;
    case "settings":
      return <Settings size={11} className="shrink-0 text-tertiary" />;
    default:
      return null;
  }
}

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const { setActiveTab, closeTab } = useAppStore();

  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={() => setActiveTab(tab.id)}
      className={cn(
        "group flex items-center gap-1.5 px-3 h-full",
        "text-sm cursor-pointer select-none shrink-0",
        "border-r border-separator border-b-2",
        active
          ? "bg-content text-label border-b-accent"
          : "text-secondary hover:text-label hover:bg-control transition-colors border-b-transparent",
      )}
    >
      {tab.isLoading ? (
        <Loader2 size={11} className="shrink-0 animate-spin text-secondary" />
      ) : (
        tabIcon(tab)
      )}
      <span className="max-w-[120px] truncate">{tab.title}</span>
      {tab.isDirty && !tab.isLoading && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-accent/70 shrink-0"
          aria-label="Unsaved changes"
        />
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tab.id);
        }}
        className={cn(
          "rounded p-0.5 transition-colors shrink-0 ml-0.5",
          "hover:bg-control text-secondary hover:text-label",
          "opacity-0 group-hover:opacity-100",
          active && "opacity-100",
        )}
        aria-label={`Close ${tab.title}`}
      >
        <X size={11} />
      </button>
    </div>
  );
}

export function TabBar() {
  const { tabs, activeTabId } = useAppStore();

  return (
    <div
      role="tablist"
      className="flex h-9 items-stretch overflow-x-auto bg-sidebar border-b border-separator"
      style={{ scrollbarWidth: "none" }}
    >
      {tabs.map((tab) => (
        <TabItem key={tab.id} tab={tab} active={tab.id === activeTabId} />
      ))}
    </div>
  );
}
