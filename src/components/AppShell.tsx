import { useEffect } from "react";
import { Database, Loader2, Search, SquarePen, Settings } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { CommandPalette } from "./CommandPalette";
import { TableViewerTab } from "../features/table-viewer";
import { QueryEditorTab } from "../features/query-editor";
import {
  LicenseBanner,
  UsageTypeDialog,
  licenseApi,
  LICENSE_STATUS_KEY,
} from "../features/license";
import { SettingsView } from "../features/settings";
import {
  applyUiPreferencesToDocument,
  cacheUiPreferencesForBootstrap,
  defaultUiPreferences,
  normalizeTheme,
  normalizeUiPreferences,
  themeToDomAttribute,
  type UiPreferences,
} from "../features/settings/preferences";
import { cn } from "../lib/utils";
import { ToastProvider } from "./Toast";

function WelcomeView() {
  const { activeSessions } = useAppStore();
  const hasSession = Object.keys(activeSessions).length > 0;

  return (
    <div className="flex flex-col items-center justify-center flex-1 h-full gap-4 text-secondary select-none">
      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
        <Database size={20} className="text-accent" />
      </div>
      <div className="text-center space-y-2">
        <p className="text-sm font-medium text-label">
          {hasSession ? "Open something to get started" : "Connect to a database"}
        </p>
        <p className="text-xs text-tertiary leading-relaxed">
          Press{" "}
          <kbd className="font-mono bg-control px-1.5 py-0.5 rounded text-[11px]">
            ⌘K
          </kbd>{" "}
          to search tables and commands
          <br />
          or{" "}
          <kbd className="font-mono bg-control px-1.5 py-0.5 rounded text-[11px]">
            ⌘T
          </kbd>{" "}
          to open a new query
        </p>
      </div>
    </div>
  );
}

function StatusBar() {
  const { tabs, activeTabId, profiles, activeSessions, lastAction } = useAppStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const sessionId =
    activeTab?.sessionId ??
    (activeTab?.tableContext
      ? Object.values(activeSessions)[0]
      : Object.values(activeSessions)[0]);

  const connEntry = sessionId
    ? Object.entries(activeSessions).find(([, s]) => s === sessionId)
    : null;
  const connId = connEntry?.[0];
  const profile = connId ? profiles.find((p) => p.id === connId) : null;
  const database = activeTab?.tableContext?.database;

  const loadingTabs = tabs.filter((t) => t.isLoading);

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-5 px-3 border-t border-separator bg-sidebar text-[11px] text-tertiary shrink-0 select-none"
    >
      {/* Left: connection + database */}
      <div data-tauri-drag-region className="flex items-center gap-1.5 min-w-0 flex-1">
        {profile ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
            <span className="text-secondary truncate">{profile.displayName}</span>
            {database && (
              <>
                <span className="opacity-40 mx-0.5">/</span>
                <span className="truncate">{database}</span>
              </>
            )}
          </>
        ) : (
          <span>No connection</span>
        )}
      </div>

      {/* Center: background work */}
      {loadingTabs.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 text-secondary">
          <Loader2 size={10} className="animate-spin text-accent" />
          <span className="tabular-nums">
            {loadingTabs.length === 1
              ? "1 task running"
              : `${loadingTabs.length} tasks running`}
          </span>
        </div>
      )}

      {/* Right: last action info */}
      {lastAction && (
        <div className="flex items-center gap-2 shrink-0 tabular-nums">
          {lastAction.rowCount != null && (
            <span>
              {lastAction.rowCount.toLocaleString()} row{lastAction.rowCount !== 1 ? "s" : ""}
            </span>
          )}
          <span>{lastAction.durationMs.toLocaleString()} ms</span>
        </div>
      )}
    </div>
  );
}

const toolbarBtnClass =
  "flex items-center gap-1.5 h-[26px] px-2 rounded-[var(--radius-control)] text-[11px] text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-hover hover:text-label active:bg-pressed select-none";

function Toolbar() {
  const { addTab, activeSessions, setCommandPaletteOpen } = useAppStore();

  return (
    <div className="flex items-center gap-1 px-2">
      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className={cn(toolbarBtnClass, "gap-2 min-w-[140px] bg-control/50 shadow-[var(--shadow-hairline)]")}
        title="Search (⌘K)"
      >
        <Search size={12} className="shrink-0 text-tertiary" />
        <span className="flex-1 text-left text-tertiary">Search…</span>
        <kbd className="text-[10px] text-tertiary/60 font-mono">⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={() => {
          const sessionId = Object.values(activeSessions)[0];
          addTab({ type: "query", title: "Query", sessionId });
        }}
        className={toolbarBtnClass}
        title="New Query (⌘T)"
      >
        <SquarePen size={13} />
      </button>
      <button
        type="button"
        onClick={() => addTab({ type: "settings", title: "Appearance" })}
        className={toolbarBtnClass}
        title="Settings"
      >
        <Settings size={13} />
      </button>
    </div>
  );
}

export function AppShell() {
  const {
    tabs,
    activeTabId,
    addTab,
    closeTab,
    activeSessions,
    profiles,
    sidebarWidth,
    theme,
    setTheme,
    hydrateTheme,
    hydrateEditorAndGridPrefs,
  } = useAppStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const queryClient = useQueryClient();

  useEffect(() => {
    const normalizedTheme = normalizeTheme(theme);
    if (normalizedTheme !== theme) {
      setTheme(normalizedTheme);
    }

    const root = document.documentElement;
    const domTheme = themeToDomAttribute(normalizedTheme);
    if (domTheme === null) {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", domTheme);
    }
  }, [theme, setTheme]);

  useEffect(() => {
    let cancelled = false;

    invoke<UiPreferences>("get_ui_preferences")
      .catch(() => defaultUiPreferences)
      .then((preferences) => {
        if (cancelled) return;
        const normalizedPreferences = normalizeUiPreferences(preferences);
        applyUiPreferencesToDocument(normalizedPreferences);
        cacheUiPreferencesForBootstrap(normalizedPreferences);
        hydrateTheme(normalizedPreferences.ui.theme);
        hydrateEditorAndGridPrefs(
          normalizedPreferences.editor.tabSize,
          normalizedPreferences.editor.wordWrap,
          normalizedPreferences.grid.rowDensity,
          normalizedPreferences.grid.pageSize,
        );
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [hydrateTheme, hydrateEditorAndGridPrefs]);

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
    <ToastProvider>
    <div className="flex flex-col h-screen overflow-hidden">
      {/* macOS title-bar + toolbar */}
      <div
        data-tauri-drag-region
        className="flex h-[38px] shrink-0 bg-sidebar border-b border-separator"
      >
        <div data-tauri-drag-region className="shrink-0" style={{ width: sidebarWidth }} />
        <div className="flex flex-1 items-center justify-end border-l border-separator">
          <Toolbar />
        </div>
      </div>

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
            {activeTab?.type === "settings" && <SettingsView initialSection={activeTab.title} />}
          </main>

          <LicenseBanner />
          <StatusBar />
        </div>
      </div>

      <CommandPalette />
      <UsageTypeDialog />
    </div>
    </ToastProvider>
  );
}
