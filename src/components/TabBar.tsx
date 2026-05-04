import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Database, Terminal, Settings, AlertCircle } from "lucide-react";
import { useAppStore, type Tab } from "../store";
import { cn, truncateSmart } from "../lib/utils";

type ContextMenuState = { tab: Tab; x: number; y: number };

const menuItemClass =
  "flex w-full items-center px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors duration-[var(--motion-fast)] text-left disabled:opacity-40 disabled:cursor-not-allowed";

function TabContextMenu({
  menu,
  tabs,
  onClose,
}: {
  menu: ContextMenuState;
  tabs: Tab[];
  onClose: () => void;
}) {
  const { closeTab, closeOtherTabs, closeTabsToRight } = useAppStore();

  useEffect(() => {
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const { tab } = menu;
  const tabIdx = tabs.findIndex((t) => t.id === tab.id);
  const hasOthers = tabs.some((t) => t.id !== tab.id);
  const hasRight = tabIdx >= 0 && tabIdx < tabs.length - 1;

  return createPortal(
    <div
      className="fixed z-50 min-w-[180px] rounded-[var(--radius-popover)] border border-separator bg-raised shadow-[var(--shadow-popover)] py-1"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => {
          closeTab(tab.id);
          onClose();
        }}
        className={menuItemClass}
      >
        Close Tab
      </button>
      <button
        onClick={() => {
          closeOtherTabs(tab.id);
          onClose();
        }}
        disabled={!hasOthers}
        className={menuItemClass}
      >
        Close Others
      </button>
      <button
        onClick={() => {
          closeTabsToRight(tab.id);
          onClose();
        }}
        disabled={!hasRight}
        className={menuItemClass}
      >
        Close to Right
      </button>
      <div className="my-1 border-t border-separator" />
      <button
        onClick={() => {
          navigator.clipboard.writeText(tab.title);
          onClose();
        }}
        className={menuItemClass}
      >
        Copy Title
      </button>
    </div>,
    document.body,
  );
}

function tabIcon(tab: Tab, active: boolean) {
  if (tab.isError && !active) {
    return <AlertCircle size={11} className="shrink-0 text-query-failed" />;
  }
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

function TabItem({
  tab,
  active,
  onContextMenu,
}: {
  tab: Tab;
  active: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { setActiveTab, closeTab } = useAppStore();

  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={() => setActiveTab(tab.id)}
      onContextMenu={onContextMenu}
      className={cn(
        "group flex items-center gap-1.5 px-3 h-full",
        "text-sm cursor-pointer select-none shrink-0",
        "border-r border-separator border-b-2",
        active
          ? "bg-content text-label border-b-accent"
          : tab.isError
            ? "text-secondary hover:text-label hover:bg-control transition-colors duration-[var(--motion-fast)] border-b-query-failed"
            : "text-secondary hover:text-label hover:bg-control transition-colors duration-[var(--motion-fast)] border-b-transparent",
      )}
    >
      {tab.isLoading ? (
        <Loader2 size={11} className="shrink-0 animate-spin text-secondary" />
      ) : (
        tabIcon(tab, active)
      )}
      <span className="max-w-[120px] truncate" title={tab.title}>
        {tab.type === "table" ? truncateSmart(tab.title, 18) : tab.title}
      </span>
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
          "rounded p-0.5 transition-colors duration-[var(--motion-fast)] shrink-0 ml-0.5",
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  return (
    <>
      <div
        role="tablist"
        data-tauri-drag-region
        className="flex h-9 items-stretch overflow-x-auto bg-sidebar border-b border-separator"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ tab, x: e.clientX, y: e.clientY });
            }}
          />
        ))}
      </div>
      {contextMenu && (
        <TabContextMenu
          menu={contextMenu}
          tabs={tabs}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
