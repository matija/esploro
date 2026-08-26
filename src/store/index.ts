import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ConnectionProfile } from "../features/connections/types";
import {
  applyUiPreferencesToDocument,
  cacheUiPreferencesForBootstrap,
  defaultUiPreferences,
  normalizeUiPreferences,
  normalizeTheme,
  type UiPreferences,
  type UiTheme,
  type EditorTabSize,
  type RowDensity,
  type GridPageSize,
} from "../features/settings/preferences";
import { settingsApi } from "../features/settings/api";

export type TabType = "welcome" | "table" | "query" | "settings" | "role" | "schema";

export interface RecentObject {
  type: "table" | "view" | "query";
  title: string;
  schema?: string;
  table?: string;
  database?: string;
  connectionId?: string;
  sessionId?: string;
  savedQueryId?: string;
  sql?: string;
  timestamp: number;
}

const MAX_RECENT_OBJECTS = 50;

/**
 * Cap on persisted schema-browser expansion state. `expandedNodes` grows
 * unboundedly as users browse large schemas across many connections; without
 * a cap the persisted blob (and localStorage write on every toggle) grows
 * without limit. Object key insertion order is used as the recency signal:
 * re-expanding a key moves it to the end, and the oldest (least-recently-used)
 * keys are evicted first once the cap is exceeded.
 */
const MAX_EXPANDED_NODES = 200;

function trimExpandedNodes(nodes: Record<string, true>): Record<string, true> {
  const keys = Object.keys(nodes);
  if (keys.length <= MAX_EXPANDED_NODES) return nodes;
  const trimmed: Record<string, true> = {};
  for (const key of keys.slice(keys.length - MAX_EXPANDED_NODES)) {
    trimmed[key] = true;
  }
  return trimmed;
}

export interface LastAction {
  label: string;
  durationMs: number;
  rowCount?: number;
  timestamp: number;
}

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
    estimatedRows?: number | null;
    isView?: boolean;
  };
  tableState?: {
    rawWhereInput?: string;
    appliedRawWhere?: string;
  };
  queryContext?: {
    sql: string;
    savedQueryId?: string;
    connectionId?: string;
  };
  roleContext?: {
    roleName: string;
    connectionId: string;
  };
  schemaContext?: {
    schema: string;
    database: string;
    connectionId: string;
  };
  isDirty?: boolean;
  isLoading?: boolean;
  isError?: boolean;
}

export type Theme = UiTheme;

interface AppState {
  // UI — persisted
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  hydrateTheme: (theme: Theme) => void;

  // Editor config — hydrated from Tauri prefs, not persisted in Zustand
  editorTabSize: EditorTabSize;
  setEditorTabSize: (size: EditorTabSize) => void;
  editorWordWrap: boolean;
  setEditorWordWrap: (wrap: boolean) => void;

  // Grid config — hydrated from Tauri prefs, not persisted in Zustand
  gridRowDensity: RowDensity;
  setGridRowDensity: (density: RowDensity) => void;
  gridPageSize: GridPageSize;
  setGridPageSize: (size: GridPageSize) => void;
  showTotalCount: boolean;
  setShowTotalCount: (show: boolean) => void;

  // Full prefs — hydrated from Tauri on startup; kept in sync by setters
  uiPreferences: UiPreferences;

  hydrateEditorAndGridPrefs: (prefs: UiPreferences) => void;

  // UI — ephemeral
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  updateSheetOpen: boolean;
  setUpdateSheetOpen: (open: boolean) => void;

  lastAction: LastAction | null;
  setLastAction: (action: LastAction) => void;

  // Tabs — ephemeral
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Omit<Tab, "id">) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabDirty: (id: string, isDirty: boolean) => void;
  setTabLoading: (id: string, isLoading: boolean) => void;
  setTabError: (id: string, isError: boolean) => void;
  updateTableTabState: (id: string, tableState: NonNullable<Tab["tableState"]>) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  updateTabTitle: (id: string, title: string) => void;

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

  // Recent objects — persisted
  recentObjects: RecentObject[];
  addRecentObject: (obj: Omit<RecentObject, "timestamp">) => void;
  clearRecentObjects: () => void;

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
        set((state) => {
          const next = normalizeUiPreferences({ ...state.uiPreferences, ui: { ...state.uiPreferences.ui, theme: nextTheme } });
          applyUiPreferencesToDocument(next);
          cacheUiPreferencesForBootstrap(next);
          settingsApi.setUiPreferences(next).catch(console.error);
          return { theme: nextTheme, uiPreferences: next };
        });
      },
      hydrateTheme: (theme) => set({ theme: normalizeTheme(theme) }),

      editorTabSize: defaultUiPreferences.editor.tabSize,
      setEditorTabSize: (tabSize) => {
        set((state) => {
          const next = normalizeUiPreferences({ ...state.uiPreferences, editor: { ...state.uiPreferences.editor, tabSize } });
          cacheUiPreferencesForBootstrap(next);
          settingsApi.setUiPreferences(next).catch(console.error);
          return { editorTabSize: tabSize, uiPreferences: next };
        });
      },

      editorWordWrap: defaultUiPreferences.editor.wordWrap,
      setEditorWordWrap: (wordWrap) => {
        set((state) => {
          const next = normalizeUiPreferences({ ...state.uiPreferences, editor: { ...state.uiPreferences.editor, wordWrap } });
          cacheUiPreferencesForBootstrap(next);
          settingsApi.setUiPreferences(next).catch(console.error);
          return { editorWordWrap: wordWrap, uiPreferences: next };
        });
      },

      gridRowDensity: defaultUiPreferences.grid.rowDensity,
      setGridRowDensity: (rowDensity) => {
        set((state) => {
          const next = normalizeUiPreferences({ ...state.uiPreferences, grid: { ...state.uiPreferences.grid, rowDensity } });
          cacheUiPreferencesForBootstrap(next);
          settingsApi.setUiPreferences(next).catch(console.error);
          return { gridRowDensity: rowDensity, uiPreferences: next };
        });
      },

      gridPageSize: defaultUiPreferences.grid.pageSize,
      setGridPageSize: (pageSize) => {
        set((state) => {
          const next = normalizeUiPreferences({ ...state.uiPreferences, grid: { ...state.uiPreferences.grid, pageSize } });
          cacheUiPreferencesForBootstrap(next);
          settingsApi.setUiPreferences(next).catch(console.error);
          return { gridPageSize: pageSize, uiPreferences: next };
        });
      },

      showTotalCount: defaultUiPreferences.grid.showTotalCount,
      setShowTotalCount: (showTotalCount) => {
        set((state) => {
          const next = normalizeUiPreferences({ ...state.uiPreferences, grid: { ...state.uiPreferences.grid, showTotalCount } });
          cacheUiPreferencesForBootstrap(next);
          settingsApi.setUiPreferences(next).catch(console.error);
          return { showTotalCount, uiPreferences: next };
        });
      },

      uiPreferences: defaultUiPreferences,
      hydrateEditorAndGridPrefs: (prefs) =>
        set({
          uiPreferences: prefs,
          editorTabSize: prefs.editor.tabSize,
          editorWordWrap: prefs.editor.wordWrap,
          gridRowDensity: prefs.grid.rowDensity,
          gridPageSize: prefs.grid.pageSize,
          showTotalCount: prefs.grid.showTotalCount,
        }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      updateSheetOpen: false,
      setUpdateSheetOpen: (open) => set({ updateSheetOpen: open }),

      lastAction: null,
      setLastAction: (action) => set({ lastAction: action }),

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

      setTabDirty: (id, isDirty) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, isDirty } : t)),
        })),

      setTabLoading: (id, isLoading) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, isLoading } : t)),
        })),

      setTabError: (id, isError) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, isError } : t)),
        })),

      updateTableTabState: (id, tableState) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id
              ? { ...t, tableState: { ...t.tableState, ...tableState } }
              : t,
          ),
        })),

      closeOtherTabs: (id) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id === id);
          if (tabs.length === 0) return s;
          return { tabs, activeTabId: id };
        }),

      closeTabsToRight: (id) =>
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          if (idx < 0) return s;
          const tabs = s.tabs.slice(0, idx + 1);
          const activeTabId = tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : id;
          return { tabs, activeTabId };
        }),

      updateTabTitle: (id, title) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
        })),

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
          const prefix = `${connectionId}:`;
          const expandedNodes = Object.fromEntries(
            Object.entries(s.expandedNodes).filter(([k]) => !k.startsWith(prefix)),
          ) as Record<string, true>;
          return { activeSessions: rest, expandedNodes };
        }),
      pendingNewConnection: false,
      setPendingNewConnection: (v) => set({ pendingNewConnection: v }),

      // Recent objects
      recentObjects: [],
      addRecentObject: (obj) =>
        set((s) => {
          const entry: RecentObject = { ...obj, timestamp: Date.now() };
          const deduped = s.recentObjects.filter(
            (r) =>
              !(r.type === entry.type && r.title === entry.title && r.connectionId === entry.connectionId),
          );
          return { recentObjects: [entry, ...deduped].slice(0, MAX_RECENT_OBJECTS) };
        }),
      clearRecentObjects: () => set({ recentObjects: [] }),

      // Schema browser
      expandedNodes: {},
      toggleNode: (key) =>
        set((s) => {
          if (s.expandedNodes[key]) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [key]: _removed, ...rest } = s.expandedNodes;
            return { expandedNodes: rest as Record<string, true> };
          }
          // Re-inserting moves `key` to the end so it reads as most-recently-used.
          return { expandedNodes: trimExpandedNodes({ ...s.expandedNodes, [key]: true }) };
        }),
    }),
    {
      name: "esploro-ui",
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        expandedNodes: trimExpandedNodes(state.expandedNodes),
        theme: state.theme,
        recentObjects: state.recentObjects,
      }),
      // Re-trim on rehydration so the cap holds even if the persisted blob
      // predates MAX_EXPANDED_NODES or was written by an older build.
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AppState> | null | undefined;
        const merged = { ...currentState, ...persisted };
        return {
          ...merged,
          expandedNodes: trimExpandedNodes(merged.expandedNodes ?? {}),
        };
      },
    },
  ),
);
