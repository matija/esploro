import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile } from "../features/connections/types";
import {
  defaultUiPreferences,
  normalizeTheme,
  type UiTheme,
} from "../features/settings/preferences";

export type TabType = "welcome" | "table" | "query" | "settings";

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  sessionId?: string;
  tableContext?: {
    database: string;
    schema: string;
    table: string;
    connectionId: string;
  };
  queryContext?: {
    sql: string;
    savedQueryId?: string;
  };
}

export type Theme = UiTheme;

interface AppState {
  // UI — persisted
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;

  // UI — ephemeral
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // Tabs — ephemeral
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Omit<Tab, "id">) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  // Connections
  profiles: ConnectionProfile[];
  setProfiles: (profiles: ConnectionProfile[]) => void;
  /** connectionId -> sessionId */
  activeSessions: Record<string, string>;
  connectSession: (connectionId: string, sessionId: string) => void;
  disconnectSession: (connectionId: string) => void;
  /** Set to true by CommandPalette; Sidebar consumes and resets it */
  pendingNewConnection: boolean;
  setPendingNewConnection: (v: boolean) => void;

  // Schema browser — persisted: node key -> true
  expandedNodes: Record<string, true>;
  toggleNode: (key: string) => void;
}

const WELCOME_TAB: Tab = { id: "welcome", type: "welcome", title: "Welcome" };

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // UI
      sidebarWidth: 240,
      setSidebarWidth: (w) =>
        set({ sidebarWidth: Math.min(320, Math.max(180, w)) }),
      theme: defaultUiPreferences.ui.theme,
      setTheme: (theme) => {
        const nextTheme = normalizeTheme(theme);
        set({ theme: nextTheme });
        invoke("set_ui_pref", { key: "ui.theme", value: nextTheme }).catch(console.error);
      },

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      // Tabs
      tabs: [WELCOME_TAB],
      activeTabId: WELCOME_TAB.id as string | null,

      addTab: (tabInfo) => {
        const id = crypto.randomUUID();
        set((s) => ({
          tabs: [...s.tabs, { ...tabInfo, id }],
          activeTabId: id,
        }));
        return id;
      },

      closeTab: (id) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== id);
          const activeTabId: string | null =
            s.activeTabId === id
              ? (tabs[tabs.length - 1]?.id ?? null)
              : s.activeTabId;
          return { tabs, activeTabId };
        }),

      setActiveTab: (id) => set({ activeTabId: id }),

      // Connections
      profiles: [],
      setProfiles: (profiles) => set({ profiles }),
      activeSessions: {},
      connectSession: (connectionId, sessionId) =>
        set((s) => ({
          activeSessions: { ...s.activeSessions, [connectionId]: sessionId },
        })),
      disconnectSession: (connectionId) =>
        set((s) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [connectionId]: _removed, ...rest } = s.activeSessions;
          return { activeSessions: rest };
        }),
      pendingNewConnection: false,
      setPendingNewConnection: (v) => set({ pendingNewConnection: v }),

      // Schema browser
      expandedNodes: {},
      toggleNode: (key) =>
        set((s) => {
          if (s.expandedNodes[key]) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [key]: _removed, ...rest } = s.expandedNodes;
            return { expandedNodes: rest as Record<string, true> };
          }
          return { expandedNodes: { ...s.expandedNodes, [key]: true } };
        }),
    }),
    {
      name: "esploro-ui",
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        expandedNodes: state.expandedNodes,
        theme: state.theme,
      }),
    },
  ),
);
