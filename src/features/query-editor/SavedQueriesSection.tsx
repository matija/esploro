import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronRight, FileText, Folder, MoreHorizontal, Trash2, Copy, Pencil, ExternalLink } from "lucide-react";
import { savedQueriesApi } from "./api";
import { useAppStore } from "../../store";
import { cn } from "../../lib/utils";
import type { SavedQuery } from "./types";

export function SavedQueriesSection() {
  const { addTab, activeSessions, addRecentObject } = useAppStore();
  const qc = useQueryClient();

  const { data: queries = [] } = useQuery({
    queryKey: ["saved-queries"],
    queryFn: () => savedQueriesApi.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => savedQueriesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-queries"] }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name, sql, folder }: { id: string; name: string; sql: string; folder?: string | null }) =>
      savedQueriesApi.save({ id, name, sql, folder: folder ?? undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-queries"] }),
  });

  const duplicateMutation = useMutation({
    mutationFn: ({ name, sql, folder }: { name: string; sql: string; folder?: string | null }) =>
      savedQueriesApi.save({ name: `${name} (copy)`, sql, folder: folder ?? undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-queries"] }),
  });

  const openQuery = useCallback(
    (id: string, name: string, sql: string) => {
      const sessionId = Object.values(activeSessions)[0];
      addTab({
        type: "query",
        title: name,
        sessionId,
        queryContext: { sql, savedQueryId: id },
      });
      addRecentObject({
        type: "query",
        title: name,
        savedQueryId: id,
        sql,
        sessionId,
      });
    },
    [addTab, activeSessions, addRecentObject],
  );

  // Group by folder
  const folders = new Map<string, SavedQuery[]>();
  const ungrouped: SavedQuery[] = [];
  for (const q of queries) {
    if (q.folder) {
      if (!folders.has(q.folder)) folders.set(q.folder, []);
      folders.get(q.folder)!.push(q);
    } else {
      ungrouped.push(q);
    }
  }

  if (queries.length === 0) {
    return (
      <div className="px-3 py-3 text-center">
        <p className="text-xs text-secondary leading-snug">
          No saved queries yet.
        </p>
        <p className="text-[12px] text-tertiary mt-0.5 leading-snug">
          Run a query and press Save (⌘S).
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 pb-1">
      {Array.from(folders.entries()).map(([folderName, items]) => (
        <FolderGroup
          key={folderName}
          name={folderName}
          items={items}
          onOpen={openQuery}
          onDelete={(id) => deleteMutation.mutate(id)}
          onRename={(q, name) => renameMutation.mutate({ id: q.id, name, sql: q.sql, folder: q.folder })}
          onDuplicate={(q) => duplicateMutation.mutate({ name: q.name, sql: q.sql, folder: q.folder })}
        />
      ))}
      {ungrouped.map((q) => (
        <QueryRow
          key={q.id}
          query={q}
          onOpen={() => openQuery(q.id, q.name, q.sql)}
          onDelete={() => deleteMutation.mutate(q.id)}
          onRename={(name) => renameMutation.mutate({ id: q.id, name, sql: q.sql, folder: q.folder })}
          onDuplicate={() => duplicateMutation.mutate({ name: q.name, sql: q.sql, folder: q.folder })}
          depth={0}
        />
      ))}
    </div>
  );
}

function FolderGroup({
  name,
  items,
  onOpen,
  onDelete,
  onRename,
  onDuplicate,
}: {
  name: string;
  items: SavedQuery[];
  onOpen: (id: string, name: string, sql: string) => void;
  onDelete: (id: string) => void;
  onRename: (q: SavedQuery, name: string) => void;
  onDuplicate: (q: SavedQuery) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-xs text-secondary hover:bg-hover transition-colors duration-[var(--motion-fast)]"
      >
        <ChevronRight
          size={11}
          className={cn('shrink-0 transition-transform duration-[var(--motion-base)] ease-out', open && 'rotate-90')}
        />
        <Folder size={11} className="shrink-0" />
        <span className="truncate flex-1 text-left text-label">{name}</span>
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 160ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          {items.map((q) => (
            <QueryRow
              key={q.id}
              query={q}
              onOpen={() => onOpen(q.id, q.name, q.sql)}
              onDelete={() => onDelete(q.id)}
              onRename={(name) => onRename(q, name)}
              onDuplicate={() => onDuplicate(q)}
              depth={1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function QueryRow({
  query,
  onOpen,
  onDelete,
  onRename,
  onDuplicate,
  depth,
}: {
  query: SavedQuery;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  depth: number;
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const prevIsRenamingRef = useRef(false);

  // Render-time adjustment: sync rename value when entering rename mode
  if (isRenaming && !prevIsRenamingRef.current) {
    setRenameValue(query.name);
  }
  prevIsRenamingRef.current = isRenaming;

  // Select text when the rename input appears
  useEffect(() => {
    if (isRenaming) {
      const tid = setTimeout(() => inputRef.current?.select(), 0);
      return () => clearTimeout(tid);
    }
  }, [isRenaming]);

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== query.name) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { setIsRenaming(false); }
  }

  return (
    <DropdownMenu.Root>
      <div
        className="group flex items-center gap-1.5 py-1 text-xs text-label hover:bg-hover transition-colors duration-[var(--motion-fast)] cursor-default select-none"
        style={{ paddingLeft: 12 + depth * 12, paddingRight: 8 }}
        onDoubleClick={() => { if (!isRenaming) onOpen(); }}
        onClick={() => { if (!isRenaming) onOpen(); }}
      >
        <FileText size={11} className="text-secondary shrink-0" />
        {isRenaming ? (
          <input
            aria-label="Rename query"
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-control border border-border-focus rounded px-1 text-xs text-label outline-none"
          />
        ) : (
          <span className="truncate flex-1">{query.name}</span>
        )}
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity duration-[var(--motion-fast)]',
              'hover:bg-pressed text-secondary hover:text-label',
              'focus-visible:opacity-100 focus-visible:outline-none',
            )}
          >
            <MoreHorizontal size={11} />
          </button>
        </DropdownMenu.Trigger>
      </div>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            "z-50 min-w-[160px] rounded-[var(--radius-popover)] overflow-hidden",
            "bg-raised border border-separator shadow-[var(--shadow-popover)] py-1",
          )}
          sideOffset={4}
        >
          <DropdownMenu.Item
            onSelect={onOpen}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover cursor-default outline-none"
          >
            <ExternalLink size={11} className="text-secondary" />
            Open
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => setIsRenaming(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover cursor-default outline-none"
          >
            <Pencil size={11} className="text-secondary" />
            Rename
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onDuplicate}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover cursor-default outline-none"
          >
            <Copy size={11} className="text-secondary" />
            Duplicate
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 border-t border-separator" />
          <DropdownMenu.Item
            onSelect={onDelete}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-hover cursor-default outline-none"
          >
            <Trash2 size={11} />
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
