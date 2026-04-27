import { useAppStore } from "../store";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { CommandPalette } from "./CommandPalette";
import { cn } from "../lib/utils";

function WelcomeView() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-secondary">
      <span className="text-4xl">⌘</span>
      <p className="text-sm">
        Press <kbd className="font-mono bg-control px-1.5 py-0.5 rounded text-xs">⌘K</kbd> to open
        the command palette
      </p>
      <p className="text-xs">
        or <kbd className="font-mono bg-control px-1.5 py-0.5 rounded">⌘T</kbd> to open a new tab
      </p>
    </div>
  );
}

export function AppShell() {
  const { tabs, activeTabId } = useAppStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* macOS title-bar drag region */}
      <div
        data-tauri-drag-region
        className="h-[38px] shrink-0 bg-sidebar border-b border-separator"
      />

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        {/* Right panel */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <TabBar />

          <main
            className={cn(
              "flex-1 overflow-auto bg-content",
              "text-label",
            )}
          >
            {activeTab?.type === "welcome" && <WelcomeView />}
            {activeTab?.type === "query" && (
              <div className="p-6 text-secondary text-sm">
                Query editor — coming in Phase 05
              </div>
            )}
            {activeTab?.type === "table" && (
              <div className="p-6 text-secondary text-sm">
                Table viewer — coming in Phase 04
              </div>
            )}
            {!activeTab && (
              <WelcomeView />
            )}
          </main>
        </div>
      </div>

      <CommandPalette />
    </div>
  );
}
