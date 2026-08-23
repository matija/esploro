import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Loader2, Search, SquarePen, Settings } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { CommandPalette } from "./CommandPalette";
import { TableViewerTab } from "../features/table-viewer/TableViewerTab";
import { QueryEditorTab } from "../features/query-editor/QueryEditorTab";
import { LicenseBanner } from "../features/license/LicenseBanner";
import { UsageTypeDialog } from "../features/license/UsageTypeDialog";
import { licenseApi, LICENSE_STATUS_KEY } from "../features/license/api";
import { SettingsView } from "../features/settings/SettingsView";
import { NAV_ITEMS, TITLE_TO_SECTION } from "../features/settings/settingsNav";
import { UpdateSheet } from "../features/updates/UpdateSheet";
import { useUpdateChecker } from "../features/updates/useUpdateChecker";
import { useUpdateCheckAction } from "../features/updates/useUpdateCheckAction";
import { isSelfUpdateAvailable } from "../features/updates/api";
import { MenuUpdateCheckListener } from "../features/updates/MenuUpdateCheckListener";
import { WelcomeView } from "../features/welcome/WelcomeView";
import { RoleDetailPanel } from "../features/roles/RoleDetailPanel";
import { SchemaDetailPanel } from "../features/schema/SchemaDetailPanel";
import {
  applyUiPreferencesToDocument,
  cacheUiPreferencesForBootstrap,
  defaultUiPreferences,
  normalizeTheme,
  normalizeUiPreferences,
  themeToDomAttribute,
} from "../features/settings/preferences";
import { settingsApi } from "../features/settings/api";
import { onMenuEvent } from "../lib/tauriEvents";
import { cn } from "../lib/utils";
import { ToastProvider } from "./Toast";
import { ConfirmProvider } from "./ConfirmDialog";


function StatusBar() {
  const { tabs, activeTabId, profiles, activeSessions, lastAction } = useAppStore(
    useShallow((state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      profiles: state.profiles,
      activeSessions: state.activeSessions,
      lastAction: state.lastAction,
    })),
  );
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const tabConnectionId =
    activeTab?.tableContext?.connectionId ??
    activeTab?.queryContext?.connectionId;
  const sessionId =
    (tabConnectionId ? activeSessions[tabConnectionId] : undefined) ??
    activeTab?.sessionId ??
    Object.values(activeSessions)[0];

  const connEntry = sessionId
    ? Object.entries(activeSessions).find(([, s]) => s === sessionId)
    : null;
  const connId = tabConnectionId ?? connEntry?.[0];
  const profile = connId ? profiles.find((p) => p.id === connId) : null;
  const database = activeTab?.tableContext?.database;

  const loadingTabs = tabs.filter((t) => t.isLoading);

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-5 px-3 border-t border-separator bg-sidebar text-[13px] text-tertiary shrink-0 select-none"
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
  "flex items-center gap-1.5 h-[26px] px-2 rounded-[var(--radius-control)] text-[13px] text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-hover hover:text-label active:bg-pressed select-none";

function LicenseBadge() {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { data: status } = useQuery({
    queryKey: LICENSE_STATUS_KEY,
    queryFn: licenseApi.getStatus,
    staleTime: 60_000,
  });
  const { addTab, tabs, setActiveTab, updateTabTitle } = useAppStore(
    useShallow((state) => ({
      addTab: state.addTab,
      tabs: state.tabs,
      setActiveTab: state.setActiveTab,
      updateTabTitle: state.updateTabTitle,
    })),
  );

  const tier = status?.tier ?? "Unlicensed";
  const isLicensed = tier === "Personal" || tier === "Commercial";

  function openLicenseSettings() {
    const existing = tabs.find((t) => t.type === "settings");
    if (existing) {
      updateTabTitle(existing.id, "Licensing");
      setActiveTab(existing.id);
    } else {
      addTab({ type: "settings", title: "Licensing" });
    }
    setPopoverOpen(false);
  }

  const badgeButton = (
    <button
      type="button"
      title={isLicensed ? `${tier} license active` : "No active license"}
      className={cn(
        "flex items-center gap-1.5 h-[22px] px-2.5 rounded-full border text-[12px] font-medium select-none transition-colors duration-[var(--motion-fast)]",
        isLicensed
          ? "border-success/30 bg-success/15 text-label hover:bg-success/25"
          : "border-warning/30 bg-warning/15 text-label hover:bg-warning/25",
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          isLicensed ? "bg-success" : "bg-warning",
        )}
      />
      {isLicensed ? tier : "Unlicensed"}
    </button>
  );

  if (!isLicensed) {
    return (
      <div
        role="button"
        tabIndex={-1}
        onClick={openLicenseSettings}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openLicenseSettings();
          }
        }}
        className="contents cursor-default"
      >
        {badgeButton}
      </div>
    );
  }

  const validThrough = status?.gracePeriodEnds
    ? new Date(status.gracePeriodEnds).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
      <Popover.Trigger asChild>{badgeButton}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 min-w-[180px] rounded-[var(--radius-popover)] border border-separator bg-raised px-3 py-2.5 shadow-[var(--shadow-popover)]",
            "text-[14px] text-label space-y-1",
            "animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2",
          )}
        >
          <p className="font-medium">{tier} license</p>
          <p className="text-tertiary">
            {validThrough ? `Valid through ${validThrough}` : "License active"}
          </p>
          <div className="pt-1 border-t border-separator mt-1">
            <button
              type="button"
              onClick={openLicenseSettings}
              className="text-accent hover:underline underline-offset-2 text-[13px]"
            >
              Manage license…
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function UpdateIndicator() {
  const { updateInfo } = useUpdateChecker();
  const setUpdateSheetOpen = useAppStore((s) => s.setUpdateSheetOpen);

  if (!updateInfo) return null;

  return (
    <button
      type="button"
      aria-label={`Update available — ${updateInfo.version}`}
      title={`Update available — ${updateInfo.version}`}
      onClick={() => setUpdateSheetOpen(true)}
      className="flex items-center justify-center h-[22px] w-[22px] rounded-full hover:bg-hover transition-colors duration-[var(--motion-fast)]"
    >
      <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
    </button>
  );
}

const menuItemClass =
  "flex items-center justify-between gap-6 px-3 py-1.5 text-[13px] text-label hover:bg-hover cursor-default outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-50";

function Toolbar() {
  const { addTab, tabs, setActiveTab, updateTabTitle, activeSessions, setCommandPaletteOpen } = useAppStore(
    useShallow((state) => ({
      addTab: state.addTab,
      tabs: state.tabs,
      setActiveTab: state.setActiveTab,
      updateTabTitle: state.updateTabTitle,
      activeSessions: state.activeSessions,
      setCommandPaletteOpen: state.setCommandPaletteOpen,
    })),
  );
  const { checking, checkNow } = useUpdateCheckAction();

  // Same behaviour the ⌘, shortcut and the app menu use: reuse the open
  // settings tab (retitled to the requested section) instead of stacking tabs.
  function openSettingsTab(title: string) {
    const existing = tabs.find((t) => t.type === "settings");
    if (existing) { updateTabTitle(existing.id, title); setActiveTab(existing.id); }
    else { addTab({ type: "settings", title }); }
  }

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
        <kbd className="text-[13px] text-tertiary/60 font-mono">⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={() => {
          const entries = Object.entries(activeSessions);
          const connectionId = entries[0]?.[0];
          const sessionId = entries[0]?.[1];
          addTab({ type: "query", title: "Query", sessionId, queryContext: connectionId ? { sql: "", connectionId } : undefined });
        }}
        className={toolbarBtnClass}
        title="New Query (⌘T)"
      >
        <SquarePen size={13} />
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={toolbarBtnClass}
            aria-label="Application menu"
            title="Settings and more"
          >
            <Settings size={13} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className={cn(
              "z-50 min-w-[200px] rounded-[var(--radius-popover)] overflow-hidden",
              "bg-raised border border-separator shadow-[var(--shadow-popover)] py-1",
              "animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2",
            )}
          >
            <DropdownMenu.Item
              onSelect={() => openSettingsTab("Appearance")}
              className={menuItemClass}
            >
              <span>Settings…</span>
              <kbd className="text-[12px] text-tertiary font-mono">⌘,</kbd>
            </DropdownMenu.Item>
            {isSelfUpdateAvailable() && (
              <DropdownMenu.Item
                disabled={checking}
                onSelect={() => { void checkNow(); }}
                className={menuItemClass}
              >
                <span>{checking ? "Checking for Updates…" : "Check for Updates…"}</span>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className="my-1 border-t border-separator" />
            <DropdownMenu.Item
              onSelect={() => openSettingsTab("About")}
              className={menuItemClass}
            >
              <span>About Esploro</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <UpdateIndicator />
      <LicenseBadge />
    </div>
  );
}

export function AppShell() {
  const {
    tabs,
    activeTabId,
    addTab,
    closeTab,
    setActiveTab,
    updateTabTitle,
    activeSessions,
    profiles,
    sidebarWidth,
    theme,
    setTheme,
    hydrateTheme,
    hydrateEditorAndGridPrefs,
    setCommandPaletteOpen,
    setPendingNewConnection,
  } = useAppStore(
    useShallow((state) => ({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      addTab: state.addTab,
      closeTab: state.closeTab,
      setActiveTab: state.setActiveTab,
      updateTabTitle: state.updateTabTitle,
      activeSessions: state.activeSessions,
      profiles: state.profiles,
      sidebarWidth: state.sidebarWidth,
      theme: state.theme,
      setTheme: state.setTheme,
      hydrateTheme: state.hydrateTheme,
      hydrateEditorAndGridPrefs: state.hydrateEditorAndGridPrefs,
      setCommandPaletteOpen: state.setCommandPaletteOpen,
      setPendingNewConnection: state.setPendingNewConnection,
    })),
  );
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const queryClient = useQueryClient();

  const { updateInfo } = useUpdateChecker();
  const { updateSheetOpen, setUpdateSheetOpen } = useAppStore(
    useShallow((state) => ({
      updateSheetOpen: state.updateSheetOpen,
      setUpdateSheetOpen: state.setUpdateSheetOpen,
    })),
  );

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

    settingsApi.getUiPreferences()
      .catch(() => defaultUiPreferences)
      .then((preferences) => {
        if (cancelled) return;
        const normalizedPreferences = normalizeUiPreferences(preferences);
        applyUiPreferencesToDocument(normalizedPreferences);
        cacheUiPreferencesForBootstrap(normalizedPreferences);
        hydrateTheme(normalizedPreferences.ui.theme);
        hydrateEditorAndGridPrefs(normalizedPreferences);
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
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Command palette: ⌘K (existing) and ⌘⇧P (VS Code style).
      if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // ⌘, → Settings (focus existing tab if open, else create one).
      if (!e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault();
        const existing = tabs.find((t) => t.type === "settings");
        if (existing) { updateTabTitle(existing.id, "Appearance"); setActiveTab(existing.id); }
        else { addTab({ type: "settings", title: "Appearance" }); }
        return;
      }

      // ⌘T → New query.
      if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        const entries = Object.entries(activeSessions);
        const connectionId = entries[0]?.[0];
        const sessionId = entries[0]?.[1];
        addTab({ type: "query", title: "Query", sessionId, queryContext: connectionId ? { sql: "", connectionId } : undefined });
        return;
      }

      // ⌘N → New connection.
      if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setPendingNewConnection(true);
        return;
      }

      // ⌘W → Close active tab.
      if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeTabId && activeTabId !== "welcome") closeTab(activeTabId);
        return;
      }

      // ⌘1..⌘8 → jump to tab N. ⌘9 → jump to last tab (browser convention).
      if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const digit = Number(e.key);
        const target = digit === 9 ? tabs[tabs.length - 1] : tabs[digit - 1];
        if (target) setActiveTab(target.id);
        return;
      }

      // Tab cycling. Use e.code so the ] / [ shortcuts work on non-US layouts
      // where Shift turns those keys into } / {.
      const isNextTab =
        (e.shiftKey && !e.altKey && e.code === "BracketRight") ||
        (e.altKey && !e.shiftKey && e.code === "ArrowRight");
      const isPrevTab =
        (e.shiftKey && !e.altKey && e.code === "BracketLeft") ||
        (e.altKey && !e.shiftKey && e.code === "ArrowLeft");

      if (isNextTab || isPrevTab) {
        e.preventDefault();
        if (tabs.length < 2 || !activeTabId) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (idx < 0) return;
        const nextIdx = isNextTab
          ? (idx + 1) % tabs.length
          : (idx - 1 + tabs.length) % tabs.length;
        setActiveTab(tabs[nextIdx].id);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    addTab,
    closeTab,
    setActiveTab,
    updateTabTitle,
    setCommandPaletteOpen,
    setPendingNewConnection,
    activeTabId,
    activeSessions,
    tabs,
  ]);

  useEffect(() => {
    return onMenuEvent("menu:open-settings", () => {
      const existing = tabs.find((t) => t.type === "settings");
      if (existing) { updateTabTitle(existing.id, "Appearance"); setActiveTab(existing.id); }
      else { addTab({ type: "settings", title: "Appearance" }); }
    });
  }, [addTab, setActiveTab, updateTabTitle, tabs]);

  useEffect(() => {
    return onMenuEvent("menu:open-about", () => {
      const existing = tabs.find((t) => t.type === "settings");
      if (existing) { updateTabTitle(existing.id, "About"); setActiveTab(existing.id); }
      else { addTab({ type: "settings", title: "About" }); }
    });
  }, [addTab, setActiveTab, updateTabTitle, tabs]);

  return (
    <ToastProvider>
    <ConfirmProvider>
    <div className="flex flex-col h-screen overflow-hidden">
      {/* macOS title-bar + toolbar */}
      <div
        data-tauri-drag-region
        className="flex h-[38px] shrink-0 bg-sidebar border-b border-separator"
      >
        <div data-tauri-drag-region className="shrink-0" style={{ width: sidebarWidth }} />
        <div data-tauri-drag-region className="flex flex-1 items-center justify-end">
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
              <QueryEditorTab key={activeTab.id} tab={activeTab} />
            )}
            {activeTab?.type === "table" && (
              <TableViewerTab key={activeTab.id} tab={activeTab} />
            )}
            {activeTab?.type === "settings" && (
              <SettingsView
                section={TITLE_TO_SECTION[activeTab.title] ?? "appearance"}
                onSectionChange={(s) =>
                  updateTabTitle(activeTab.id, NAV_ITEMS.find((n) => n.id === s)!.label)
                }
              />
            )}
            {activeTab?.type === "role" && (
              <RoleDetailPanel key={activeTab.id} tab={activeTab} />
            )}
            {activeTab?.type === "schema" && (
              <SchemaDetailPanel key={activeTab.id} tab={activeTab} />
            )}
          </main>

          <LicenseBanner />
          <StatusBar />
        </div>
      </div>

      <MenuUpdateCheckListener />
      <CommandPalette />
      <UsageTypeDialog />
      {updateInfo && (
        <UpdateSheet
          key={String(updateSheetOpen)}
          open={updateSheetOpen}
          currentVersion={__APP_VERSION__}
          updateVersion={updateInfo.version}
          notes={updateInfo.notes}
          onClose={() => setUpdateSheetOpen(false)}
        />
      )}
    </div>
    </ConfirmProvider>
    </ToastProvider>
  );
}
