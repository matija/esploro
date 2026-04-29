import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../store";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { CommandPalette } from "./CommandPalette";
import { TableViewerTab } from "../features/table-viewer";
import { QueryEditorTab } from "../features/query-editor";
import {
  LicenseBanner,
  LicenseSettings,
  UsageTypeDialog,
  licenseApi,
  LICENSE_STATUS_KEY,
} from "../features/license";
import { cn } from "../lib/utils";

function WelcomeView() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 h-full gap-3 text-secondary">
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
  const { tabs, activeTabId, addTab, closeTab, activeSessions, profiles, theme } = useAppStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const queryClient = useQueryClient();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  // Notify Rust of current connection count for commercial heuristic
  useEffect(() => {
    if (profiles.length === 0) return;
    licenseApi.notifyConnectionCount(profiles.length).then((status) => {
      queryClient.setQueryData(LICENSE_STATUS_KEY, status);
    });
  }, [profiles.length, queryClient]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "t") {
        e.preventDefault();
        const sessionId = Object.values(activeSessions)[0];
        addTab({ type: "query", title: "Query", sessionId });
      } else if (e.key === "w") {
        e.preventDefault();
        if (activeTabId && activeTabId !== "welcome") closeTab(activeTabId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addTab, closeTab, activeTabId, activeSessions]);

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
              "flex-1 overflow-hidden bg-content",
              "text-label",
            )}
          >
            {(activeTab?.type === "welcome" || !activeTab) && (
              <div className="flex h-full overflow-auto">
                <WelcomeView />
              </div>
            )}
            {activeTab?.type === "query" && (
              <QueryEditorTab tab={activeTab} />
            )}
            {activeTab?.type === "table" && (
              <TableViewerTab tab={activeTab} />
            )}
            {activeTab?.type === "settings" && (
              <div className="flex h-full overflow-auto">
                <LicenseSettings />
              </div>
            )}
          </main>

          <LicenseBanner />
        </div>
      </div>

      <CommandPalette />
      <UsageTypeDialog />
    </div>
  );
}
