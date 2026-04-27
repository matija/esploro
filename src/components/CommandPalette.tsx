import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { useAppStore } from "../store";
import { cn } from "../lib/utils";

interface Command {
  id: string;
  label: string;
  onSelect: () => void;
}

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useAppStore();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Built-in commands (stub — more added in later phases)
  const allCommands: Command[] = [];

  const filtered = query.trim()
    ? allCommands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()),
      )
    : allCommands;

  // Reset query on close
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
                    "flex w-full items-center gap-2 px-4 py-2 text-sm",
                    "text-label hover:bg-control transition-colors text-left",
                  )}
                >
                  {cmd.label}
                </button>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
