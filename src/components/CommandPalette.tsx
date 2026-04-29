import { useEffect, useRef, useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, Plus, Plug, Table2, FileCode, KeyRound, Sun, Moon, Monitor } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../store";
import { connectionsApi } from "../features/connections";
import { cn } from "../lib/utils";
import { fuzzyScore } from "../lib/fuzzy";
import type { SchemaObjects } from "../features/schema";
import type { SavedQuery } from "../features/query-editor";

interface Command {
  id: string;
  label: string;
  icon?: React.ReactNode;
  group?: string;
  onSelect: () => void;
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
    setTheme,
  } = useAppStore();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const queryClient = useQueryClient();

  // Build table commands from React Query cache (loaded schemas only)
  const tableCommands: Command[] = [];
  for (const [connectionId, sessionId] of Object.entries(activeSessions)) {
    const profile = profiles.find((p) => p.id === connectionId);
    const profileName = profile?.displayName ?? connectionId;

    // Collect all cached object results for this session
    const cache = queryClient.getQueryCache();
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
        tableCommands.push({
          id: `table-${connectionId}-${db}-${schema}-${table.name}`,
          label: `${schema}.${table.name}`,
          icon: <Table2 size={13} />,
          group: profileName,
          onSelect: () => {
            addTab({
              type: "table",
              title: `${schema}.${table.name}`,
              sessionId,
              tableContext: { database: db, schema, table: table.name, connectionId },
            });
          },
        });
      }
    }
  }

  // Saved query commands from React Query cache
  const savedQueryData =
    queryClient
      .getQueryCache()
      .getAll()
      .find(
        (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "saved-queries" &&
          q.state.status === "success",
      )?.state.data as SavedQuery[] | undefined;

  const savedQueryCommands: Command[] = (savedQueryData ?? []).map((sq) => ({
    id: `saved-query-${sq.id}`,
    label: `Open: ${sq.name}`,
    icon: <FileCode size={13} />,
    group: "Saved Queries",
    onSelect: () => {
      const sessionId = Object.values(activeSessions)[0];
      addTab({
        type: "query",
        title: sq.name,
        sessionId,
        queryContext: { sql: sq.sql, savedQueryId: sq.id },
      });
    },
  }));

  const allCommands: Command[] = [
    {
      id: "new-query",
      label: "New Query",
      icon: <FileCode size={13} />,
      group: "Queries",
      onSelect: () => {
        const sessionId = Object.values(activeSessions)[0];
        addTab({ type: "query", title: "Query", sessionId });
      },
    },
    {
      id: "open-license",
      label: "License Settings",
      icon: <KeyRound size={13} />,
      group: "Settings",
      onSelect: () => addTab({ type: "settings", title: "License" }),
    },
    {
      id: "theme-light",
      label: "Theme: Light",
      icon: <Sun size={13} />,
      group: "Appearance",
      onSelect: () => setTheme("tairiki-light"),
    },
    {
      id: "theme-dark",
      label: "Theme: Dark",
      icon: <Moon size={13} />,
      group: "Appearance",
      onSelect: () => setTheme("tairiki-dark"),
    },
    {
      id: "theme-system",
      label: "Theme: System",
      icon: <Monitor size={13} />,
      group: "Appearance",
      onSelect: () => setTheme("system"),
    },
    {
      id: "new-connection",
      label: "New Connection",
      icon: <Plus size={13} />,
      group: "Connections",
      onSelect: () => setPendingNewConnection(true),
    },
    ...profiles.map((p) => ({
      id: `connect-${p.id}`,
      label: `Connect to ${p.displayName}`,
      icon: <Plug size={13} />,
      group: "Connections",
      onSelect: async () => {
        try {
          const sessionId = await connectionsApi.connect(p.id);
          connectSession(p.id, sessionId);
        } catch (e) {
          console.error("Connect failed", e);
        }
      },
    })),
    ...tableCommands,
    ...savedQueryCommands,
  ];

  const filtered = query.trim()
    ? allCommands
        .map((c) => ({ cmd: c, score: fuzzyScore(c.label, query.trim()) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ cmd }) => cmd)
    : allCommands;

  // Reset selection when results change
  useEffect(() => {
    setSelectedIdx(0);
    itemRefs.current = [];
  }, [filtered.length, query]);

  // Scroll selected item into view
  useEffect(() => {
    itemRefs.current[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const handleSelect = useCallback(
    (cmd: Command) => {
      cmd.onSelect();
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

  return (
    <Dialog.Root open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-[20%] -translate-x-1/2 z-50",
            "w-[560px] max-w-[90vw] rounded-xl overflow-hidden",
            "bg-content border border-separator shadow-2xl",
          )}
          aria-label="Command palette"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          {/* Search input */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-separator">
            <Search size={15} className="text-secondary shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search commands, tables, connections…"
              className={cn(
                "flex-1 bg-transparent text-label text-sm outline-none",
                "placeholder:text-secondary",
              )}
            />
            <kbd className="text-[10px] text-secondary bg-control px-1.5 py-0.5 rounded font-mono shrink-0">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-72 overflow-y-auto py-2">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-secondary">
                {query ? "No results" : "No commands available"}
              </div>
            ) : (
              filtered.map((cmd, i) => (
                <button
                  key={cmd.id}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  onClick={() => handleSelect(cmd)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-4 py-2 text-sm",
                    "text-label transition-colors text-left",
                    i === selectedIdx ? "bg-accent/10" : "hover:bg-control",
                  )}
                >
                  {cmd.icon && (
                    <span className={cn("shrink-0", i === selectedIdx ? "text-accent" : "text-secondary")}>
                      {cmd.icon}
                    </span>
                  )}
                  {cmd.label}
                  {cmd.group && (
                    <span className="ml-auto text-xs text-secondary">
                      {cmd.group}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
