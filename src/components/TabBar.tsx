import { X } from "lucide-react";
import { useAppStore, type Tab } from "../store";
import { cn } from "../lib/utils";

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const { setActiveTab, closeTab } = useAppStore();

  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={() => setActiveTab(tab.id)}
      className={cn(
        "flex items-center gap-1.5 px-3 h-full",
        "text-sm cursor-pointer select-none shrink-0",
        "border-r border-separator border-b-2",
        active
          ? "bg-content text-label border-b-accent"
          : "text-secondary hover:text-label hover:bg-control transition-colors border-b-transparent",
      )}
    >
      <span className="max-w-[140px] truncate">{tab.title}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tab.id);
        }}
        className={cn(
          "rounded p-0.5 transition-colors",
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
