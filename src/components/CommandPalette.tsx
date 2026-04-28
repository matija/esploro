import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, Plus, Plug, Table2, FileCode, KeyRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../store";
import { connectionsApi } from "../features/connections";
import { cn } from "../lib/utils";
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
  } = useAppStore();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
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
    ? allCommands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()),
      )
    : allCommands;

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
          <div className="max-h-72 overflow-y-auto py-2">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-secondary">
                {query ? "No results" : "No commands available"}
              </div>
            ) : (
              filtered.map((cmd) => (
                <button
                  key={cmd.id}
                  onClick={() => {
                    cmd.onSelect();
                    setCommandPaletteOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-4 py-2 text-sm",
                    "text-label hover:bg-control transition-colors text-left",
                  )}
                >
                  {cmd.icon && (
                    <span className="text-secondary shrink-0">{cmd.icon}</span>
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
