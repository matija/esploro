import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TabType = "welcome" | "table" | "query";

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  sessionId?: string;
}

interface AppState {
  // UI — persisted
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;

  // UI — ephemeral
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // Tabs — ephemeral
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Omit<Tab, "id">) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
}

const WELCOME_TAB_ID = "welcome";

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // UI
      sidebarWidth: 240,
      setSidebarWidth: (w) =>
        set({ sidebarWidth: Math.min(320, Math.max(180, w)) }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      // Tabs
      tabs: [{ id: WELCOME_TAB_ID, type: "welcome", title: "Welcome" }],
      activeTabId: WELCOME_TAB_ID,

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
          const activeTabId =
            s.activeTabId === id
              ? (tabs[tabs.length - 1]?.id ?? null)
              : s.activeTabId;
          return { tabs, activeTabId };
        }),

      setActiveTab: (id) => set({ activeTabId: id }),
    }),
    {
      name: "esploro-ui",
      partialize: (state) => ({ sidebarWidth: state.sidebarWidth }),
    },
  ),
);
