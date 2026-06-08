import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Search, Plus, Plug, Table2, FileCode, KeyRound, Sun, Moon, Monitor,
  Settings, Loader2, Zap, Eye, Palette, Code2, Database, AlignJustify, Info,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import { connectionsApi } from "../features/connections/api";
import { cn } from "../lib/utils";
import { fuzzyScore } from "../lib/fuzzy";
import type { SchemaObjects } from "../features/schema/types";
import type { SavedQuery } from "../features/query-editor/types";

type CommandGroup = "Connections" | "Schema" | "Queries" | "Commands" | "Settings";

const GROUP_ORDER: CommandGroup[] = ["Commands", "Connections", "Schema", "Queries", "Settings"];
const MAX_SEARCH_RESULTS = 80;

interface CommandResult {
  id: string;
  group: CommandGroup;
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  shortcut?: string;
  action: () => void;
}

type RenderItem =
  | { type: "header"; group: CommandGroup }
  | { type: "item"; cmd: CommandResult; idx: number };

function buildRenderList(commands: CommandResult[]): RenderItem[] {
  const items: RenderItem[] = [];
  let lastGroup: CommandGroup | null = null;
  commands.forEach((cmd, idx) => {
    if (cmd.group !== lastGroup) {
      items.push({ type: "header", group: cmd.group });
      lastGroup = cmd.group;
    }
    items.push({ type: "item", cmd, idx });
  });
  return items;
}

export function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    profiles,
    activeSessions,
    connectSession,
    setPendingNewConnection,
    addTab,
    addRecentObject,
    setTheme,
  } = useAppStore(
    useShallow((state) => ({
      commandPaletteOpen: state.commandPaletteOpen,
      setCommandPaletteOpen: state.setCommandPaletteOpen,
      profiles: state.profiles,
      activeSessions: state.activeSessions,
      connectSession: state.connectSession,
      setPendingNewConnection: state.setPendingNewConnection,
      addTab: state.addTab,
      addRecentObject: state.addRecentObject,
      setTheme: state.setTheme,
    })),
  );
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const queryClient = useQueryClient();
  const prevOpenRef = useRef(commandPaletteOpen);

  // Check if any schema queries are in-flight
  const isSchemaLoading = useMemo(
    () =>
      commandPaletteOpen &&
      Object.keys(activeSessions).length > 0 &&
      queryClient
        .getQueryCache()
        .getAll()
        .some(
          (q) =>
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === "objects" &&
            q.state.fetchStatus === "fetching",
        ),
    [activeSessions, commandPaletteOpen, queryClient],
  );

  // Reset selection on palette open (render-time, no stale intermediate render)
  if (commandPaletteOpen && !prevOpenRef.current) {
    setSelectedIdx(0);
    itemRefs.current = [];
  }
  prevOpenRef.current = commandPaletteOpen;

  // Build table commands from React Query cache (loaded schemas only)
  const tableCommands = useMemo(() => {
    if (!commandPaletteOpen) return [];

    const commands: CommandResult[] = [];
    const cache = queryClient.getQueryCache();

    for (const [connectionId, sessionId] of Object.entries(activeSessions)) {
      const profile = profiles.find((p) => p.id === connectionId);
      const profileName = profile?.displayName ?? connectionId;
      const host = profile ? `${profile.host ?? "localhost"}:${profile.port}` : "";

      const objectQueries = cache
        .getAll()
        .filter(
          (q) =>
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === "objects" &&
            q.queryKey[1] === sessionId &&
            q.state.status === "success",
        );

      for (const oq of objectQueries) {
        const [, , db, schema] = oq.queryKey as string[];
        const data = oq.state.data as SchemaObjects;
        if (!data) continue;

        for (const table of data.tables) {
          commands.push({
            id: `table-${connectionId}-${db}-${schema}-${table.name}`,
            group: "Schema",
            icon: <Table2 size={13} />,
            title: `${schema}.${table.name}`,
            subtitle: `${profileName} · ${host}`,
            action: () => {
              addTab({
                type: "table",
                title: `${schema}.${table.name}`,
                sessionId,
                tableContext: { database: db, schema, table: table.name, connectionId },
              });
              addRecentObject({
                type: "table",
                title: `${schema}.${table.name}`,
                schema,
                table: table.name,
                database: db,
                connectionId,
                sessionId,
              });
            },
          });
        }

        for (const viewName of data.views) {
          commands.push({
            id: `view-${connectionId}-${db}-${schema}-${viewName}`,
            group: "Schema",
            icon: <Eye size={13} />,
            title: `${schema}.${viewName}`,
            subtitle: `${profileName} · ${host} · view`,
            action: () => {
              addTab({
                type: "table",
                title: `${schema}.${viewName}`,
                sessionId,
                tableContext: { database: db, schema, table: viewName, connectionId },
              });
              addRecentObject({
                type: "view",
                title: `${schema}.${viewName}`,
                schema,
                table: viewName,
                database: db,
                connectionId,
                sessionId,
              });
            },
          });
        }
      }
    }

    return commands;
  }, [activeSessions, addRecentObject, addTab, commandPaletteOpen, profiles, queryClient]);

  // Saved query commands
  const savedQueryData = useMemo(() => {
    if (!commandPaletteOpen) return undefined;
    return queryClient
      .getQueryCache()
      .getAll()
      .find(
        (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "saved-queries" &&
          q.state.status === "success",
      )?.state.data as SavedQuery[] | undefined;
  }, [commandPaletteOpen, queryClient]);

  const savedQueryCommands: CommandResult[] = useMemo(() => (savedQueryData ?? []).map((sq) => ({
    id: `saved-query-${sq.id}`,
    group: "Queries",
    icon: <FileCode size={13} />,
    title: sq.name,
    subtitle: sq.folder ?? undefined,
    action: () => {
      const sessionId = Object.values(activeSessions)[0];
      addTab({
        type: "query",
        title: sq.name,
        sessionId,
        queryContext: { sql: sq.sql, savedQueryId: sq.id },
      });
      addRecentObject({
        type: "query",
        title: sq.name,
        savedQueryId: sq.id,
        sql: sq.sql,
        sessionId,
      });
    },
  })), [activeSessions, addRecentObject, addTab, savedQueryData]);

  const connectionCommands: CommandResult[] = useMemo(() => profiles.map((p) => ({
    id: `connect-${p.id}`,
    group: "Connections",
    icon: <Plug size={13} />,
    title: p.displayName,
    subtitle: `${p.username}@${p.host ?? "localhost"}:${p.port}/${p.database}`,
    action: async () => {
      try {
        const sessionId = await connectionsApi.connect(p.id);
        connectSession(p.id, sessionId);
      } catch (e) {
        console.error("Connect failed", e);
      }
    },
  })), [connectSession, profiles]);

  const coreCommands: CommandResult[] = useMemo(() => [
    {
      id: "new-query",
      group: "Commands",
      icon: <FileCode size={13} />,
      title: "New Query",
      shortcut: "⌘T",
      action: () => {
        const sessionId = Object.values(activeSessions)[0];
        addTab({ type: "query", title: "Query", sessionId });
      },
    },
    {
      id: "new-connection",
      group: "Connections",
      icon: <Plus size={13} />,
      title: "New Connection",
      shortcut: "⌘N",
      action: () => setPendingNewConnection(true),
    },
    {
      id: "open-appearance",
      group: "Settings",
      icon: <Palette size={13} />,
      title: "Appearance Settings",
      shortcut: "⌘,",
      action: () => addTab({ type: "settings", title: "Appearance" }),
    },
    {
      id: "open-editor-settings",
      group: "Settings",
      icon: <Code2 size={13} />,
      title: "Editor Settings",
      action: () => addTab({ type: "settings", title: "Editor" }),
    },
    {
      id: "open-grid-settings",
      group: "Settings",
      icon: <AlignJustify size={13} />,
      title: "Data Grid Settings",
      action: () => addTab({ type: "settings", title: "Data Grid" }),
    },
    {
      id: "open-connections-settings",
      group: "Settings",
      icon: <Database size={13} />,
      title: "Connections Settings",
      action: () => addTab({ type: "settings", title: "Connections" }),
    },
    {
      id: "open-license",
      group: "Settings",
      icon: <KeyRound size={13} />,
      title: "License Settings",
      action: () => addTab({ type: "settings", title: "License" }),
    },
    {
      id: "open-advanced-settings",
      group: "Settings",
      icon: <Settings size={13} />,
      title: "Advanced Settings",
      action: () => addTab({ type: "settings", title: "Advanced" }),
    },
    {
      id: "open-about",
      group: "Settings",
      icon: <Info size={13} />,
      title: "About",
      action: () => addTab({ type: "settings", title: "About" }),
    },
    {
      id: "theme-light",
      group: "Settings",
      icon: <Sun size={13} />,
      title: "Theme: Tairiki Light",
      action: () => setTheme("tairiki-light"),
    },
    {
      id: "theme-dark",
      group: "Settings",
      icon: <Moon size={13} />,
      title: "Theme: Tairiki Dark",
      action: () => setTheme("tairiki-dark"),
    },
    {
      id: "theme-system",
      group: "Settings",
      icon: <Monitor size={13} />,
      title: "Theme: System",
      action: () => setTheme("system"),
    },
    {
      id: "theme-tokyo-night",
      group: "Settings",
      icon: <Moon size={13} />,
      title: "Theme: Tokyo Night",
      action: () => setTheme("tokyo-night"),
    },
    {
      id: "theme-tokyo-night-day",
      group: "Settings",
      icon: <Sun size={13} />,
      title: "Theme: Tokyo Night Day",
      action: () => setTheme("tokyo-night-day"),
    },
    {
      id: "theme-github-dark",
      group: "Settings",
      icon: <Moon size={13} />,
      title: "Theme: GitHub Dark",
      action: () => setTheme("github-dark"),
    },
    {
      id: "theme-github-light",
      group: "Settings",
      icon: <Sun size={13} />,
      title: "Theme: GitHub Light",
      action: () => setTheme("github-light"),
    },
    {
      id: "theme-catppuccin-mocha",
      group: "Settings",
      icon: <Moon size={13} />,
      title: "Theme: Catppuccin Mocha",
      action: () => setTheme("catppuccin-mocha"),
    },
    {
      id: "theme-catppuccin-macchiato",
      group: "Settings",
      icon: <Moon size={13} />,
      title: "Theme: Catppuccin Macchiato",
      action: () => setTheme("catppuccin-macchiato"),
    },
    {
      id: "theme-catppuccin-frappe",
      group: "Settings",
      icon: <Moon size={13} />,
      title: "Theme: Catppuccin Frappé",
      action: () => setTheme("catppuccin-frappe"),
    },
    {
      id: "theme-catppuccin-latte",
      group: "Settings",
      icon: <Sun size={13} />,
      title: "Theme: Catppuccin Latte",
      action: () => setTheme("catppuccin-latte"),
    },
    {
      id: "theme-rose-pine",
      group: "Settings",
      icon: <Moon size={13} />,
      title: "Theme: Rosé Pine",
      action: () => setTheme("rose-pine"),
    },
    {
      id: "theme-rose-pine-moon",
      group: "Settings",
      icon: <Moon size={13} />,
      title: "Theme: Rosé Pine Moon",
      action: () => setTheme("rose-pine-moon"),
    },
    {
      id: "theme-rose-pine-dawn",
      group: "Settings",
      icon: <Sun size={13} />,
      title: "Theme: Rosé Pine Dawn",
      action: () => setTheme("rose-pine-dawn"),
    },
  ], [activeSessions, addTab, setPendingNewConnection, setTheme]);

  const allCommands: CommandResult[] = useMemo(() => [
    ...coreCommands,
    ...connectionCommands,
    ...tableCommands,
    ...savedQueryCommands,
  ], [connectionCommands, coreCommands, savedQueryCommands, tableCommands]);

  // Default commands shown when query is empty (curated, no tables)
  const defaultCommands: CommandResult[] = useMemo(() => [
    ...coreCommands.filter((c) => c.id === "new-query"),
    ...connectionCommands,
    ...coreCommands.filter((c) => c.id === "new-connection"),
    ...savedQueryCommands.slice(0, 6),
    ...coreCommands.filter((c) => c.id !== "new-query" && c.id !== "new-connection"),
  ].reduce<CommandResult[]>((acc, cmd) => {
    if (!acc.find((c) => c.id === cmd.id)) acc.push(cmd);
    return acc;
  }, []), [connectionCommands, coreCommands, savedQueryCommands]);

  // Sort default commands by GROUP_ORDER
  const sortedDefaultCommands = useMemo(
    () =>
      [...defaultCommands].sort(
        (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
      ),
    [defaultCommands],
  );

  const filtered: CommandResult[] = useMemo(() => {
    const trimmedQuery = query.trim();
    return trimmedQuery
      ? allCommands
        .reduce((acc, c) => {
          const score = fuzzyScore(c.title, trimmedQuery);
          if (score > 0) acc.push({ cmd: c, score });
          return acc;
        }, [] as { cmd: CommandResult; score: number }[])
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return GROUP_ORDER.indexOf(a.cmd.group) - GROUP_ORDER.indexOf(b.cmd.group);
        })
        .map(({ cmd }) => cmd)
        .slice(0, MAX_SEARCH_RESULTS)
      : sortedDefaultCommands;
  }, [allCommands, query, sortedDefaultCommands]);

  // Scroll selected item into view
  useEffect(() => {
    itemRefs.current[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const handleSelect = useCallback(
    (cmd: CommandResult) => {
      cmd.action();
      setCommandPaletteOpen(false);
    },
    [setCommandPaletteOpen],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selectedIdx];
      if (cmd) handleSelect(cmd);
    }
  };

  useEffect(() => {
    if (!commandPaletteOpen) setQuery("");
  }, [commandPaletteOpen]);

  const renderItems = useMemo(() => buildRenderList(filtered), [filtered]);

  return (
    <Dialog.Root open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-[18%] -translate-x-1/2 z-50",
            "w-[580px] max-w-[92vw] rounded-xl overflow-hidden",
            "bg-[var(--surface-overlay,var(--color-bg-base))] border border-[var(--border-default,var(--color-border))]",
            "shadow-[var(--shadow-popover,0_12px_30px_rgba(0,0,0,0.18))]",
          )}
          aria-label="Command palette"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          {/* Search input */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border-subtle,var(--color-border))]">
            <Search size={15} className="text-[var(--text-secondary,var(--color-text-secondary))] shrink-0" />
            <input
              ref={inputRef}
              aria-label="Search commands, tables, connections"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); itemRefs.current = []; }}
              onKeyDown={handleKeyDown}
              placeholder="Search commands, tables, connections…"
              className={cn(
                "flex-1 bg-transparent text-[var(--text-primary,var(--color-text-primary))] text-sm outline-none",
                "placeholder:text-[var(--text-tertiary,var(--color-text-secondary))]",
              )}
            />
            {isSchemaLoading && (
              <Loader2 size={12} className="text-[var(--text-tertiary,var(--color-text-secondary))] animate-spin shrink-0" />
            )}
            <kbd className="text-[11px] text-[var(--text-tertiary,var(--color-text-secondary))] bg-[var(--surface-inset,var(--color-bg-subtle))] px-1.5 py-0.5 rounded font-mono shrink-0 border border-[var(--border-subtle,var(--color-border))]">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-80 overflow-y-auto py-1.5">
            {filtered.length === 0 ? (
              <NoResults
                query={query}
                onNewQuery={() => {
                  const sessionId = Object.values(activeSessions)[0];
                  addTab({ type: "query", title: "Query", sessionId });
                  setCommandPaletteOpen(false);
                }}
                onNewConnection={() => {
                  setPendingNewConnection(true);
                  setCommandPaletteOpen(false);
                }}
              />
            ) : (
              renderItems.map((item, renderIdx) => {
                if (item.type === "header") {
                  return (
                    <GroupHeader key={`header-${item.group}-${renderIdx}`} label={item.group} />
                  );
                }
                const { cmd, idx } = item;
                const isSelected = idx === selectedIdx;
                return (
                  <button
                    type="button"
                    key={cmd.id}
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    onClick={() => handleSelect(cmd)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-1.5 text-sm text-left",
                      "transition-colors duration-[var(--motion-fast,100ms)]",
                      "focus:outline-none",
                      isSelected
                        ? "bg-[var(--color-accent,#4a7cf6)]/10"
                        : "hover:bg-[var(--surface-hover,var(--color-bg-subtle))]",
                    )}
                  >
                    {cmd.icon && (
                      <span
                        className={cn(
                          "shrink-0 w-5 flex items-center justify-center",
                          isSelected
                            ? "text-[var(--color-accent,#4a7cf6)]"
                            : "text-[var(--text-tertiary,var(--color-text-secondary))]",
                        )}
                      >
                        {cmd.icon}
                      </span>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-[var(--text-primary,var(--color-text-primary))] truncate leading-tight">
                        {cmd.title}
                      </span>
                      {cmd.subtitle && (
                        <span className="block text-xs text-[var(--text-tertiary,var(--color-text-secondary))] truncate mt-0.5 leading-tight">
                          {cmd.subtitle}
                        </span>
                      )}
                    </span>
                    {cmd.shortcut && (
                      <kbd className="ml-auto shrink-0 text-[11px] text-[var(--text-tertiary,var(--color-text-secondary))] font-mono">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer hint */}
          <div className="flex items-center gap-3 px-4 py-2 border-t border-[var(--border-subtle,var(--color-border))]">
            <span className="text-[11px] text-[var(--text-tertiary,var(--color-text-secondary))]">
              <kbd className="font-mono">↑↓</kbd> navigate
            </span>
            <span className="text-[11px] text-[var(--text-tertiary,var(--color-text-secondary))]">
              <kbd className="font-mono">↵</kbd> select
            </span>
            <span className="text-[11px] text-[var(--text-tertiary,var(--color-text-secondary))]">
              <kbd className="font-mono">ESC</kbd> close
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function GroupHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary,var(--color-text-secondary))] leading-none">
        {label}
      </span>
      <div className="flex-1 h-px bg-[var(--border-subtle,var(--color-border))]" />
    </div>
  );
}

function NoResults({
  query,
  onNewQuery,
  onNewConnection,
}: {
  query: string;
  onNewQuery: () => void;
  onNewConnection: () => void;
}) {
  return (
    <div className="px-4 py-5 flex flex-col items-center gap-4">
      <div className="text-center">
        <p className="text-sm text-[var(--text-secondary,var(--color-text-secondary))]">
          No results for <span className="font-medium text-[var(--text-primary,var(--color-text-primary))]">&ldquo;{query}&rdquo;</span>
        </p>
        <p className="text-xs text-[var(--text-tertiary,var(--color-text-secondary))] mt-1">
          Try a connection name, table, or command.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onNewQuery}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-control,6px)] text-xs",
            "bg-[var(--surface-inset,var(--color-bg-subtle))] border border-[var(--border-default,var(--color-border))]",
            "text-[var(--text-primary,var(--color-text-primary))] hover:bg-[var(--surface-hover,var(--color-bg-active))] transition-colors",
          )}
        >
          <Zap size={11} />
          New Query
        </button>
        <button
          type="button"
          onClick={onNewConnection}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-control,6px)] text-xs",
            "bg-[var(--surface-inset,var(--color-bg-subtle))] border border-[var(--border-default,var(--color-border))]",
            "text-[var(--text-primary,var(--color-text-primary))] hover:bg-[var(--surface-hover,var(--color-bg-active))] transition-colors",
          )}
        >
          <Plus size={11} />
          New Connection
        </button>
      </div>
    </div>
  );
}
