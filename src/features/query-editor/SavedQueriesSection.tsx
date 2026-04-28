import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FileText, Folder, MoreHorizontal, Trash2 } from "lucide-react";
import { savedQueriesApi } from "./api";
import { useAppStore } from "../../store";
import { cn } from "../../lib/utils";

export function SavedQueriesSection() {
  const { addTab, activeSessions } = useAppStore();
  const qc = useQueryClient();

  const { data: queries = [] } = useQuery({
    queryKey: ["saved-queries"],
    queryFn: () => savedQueriesApi.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => savedQueriesApi.delete(id),
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
    },
    [addTab, activeSessions],
  );

  // Group by folder
  const folders = new Map<string, typeof queries>();
  const ungrouped: typeof queries = [];
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
      <div className="px-3 py-2 text-xs text-secondary">No saved queries</div>
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
        />
      ))}
      {ungrouped.map((q) => (
        <QueryRow
          key={q.id}
          id={q.id}
          name={q.name}
          onOpen={() => openQuery(q.id, q.name, q.sql)}
          onDelete={() => deleteMutation.mutate(q.id)}
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
}: {
  name: string;
  items: { id: string; name: string; sql: string }[];
  onOpen: (id: string, name: string, sql: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-xs text-label hover:bg-control transition-colors"
      >
        <Folder size={11} className="text-secondary shrink-0" />
        <span className="truncate flex-1 text-left">{name}</span>
      </button>
      {open &&
        items.map((q) => (
          <QueryRow
            key={q.id}
            id={q.id}
            name={q.name}
            onOpen={() => onOpen(q.id, q.name, q.sql)}
            onDelete={() => onDelete(q.id)}
            depth={1}
          />
        ))}
    </div>
  );
}

function QueryRow({
  name,
  onOpen,
  onDelete,
  depth,
}: {
  id?: string;
  name: string;
  onOpen: () => void;
  onDelete: () => void;
  depth: number;
}) {
  return (
    <DropdownMenu.Root>
      <div
        className="group flex items-center gap-1.5 px-3 py-1 text-xs text-label hover:bg-control transition-colors cursor-default select-none"
        style={{ paddingLeft: 12 + depth * 12 }}
        onDoubleClick={onOpen}
        onClick={onOpen}
      >
        <FileText size={11} className="text-secondary shrink-0" />
        <span className="truncate flex-1">{name}</span>
        <DropdownMenu.Trigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-control transition-opacity"
          >
            <MoreHorizontal size={11} className="text-secondary" />
          </button>
        </DropdownMenu.Trigger>
      </div>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            "z-50 min-w-[140px] rounded-lg overflow-hidden",
            "bg-content border border-separator shadow-lg py-1",
          )}
          sideOffset={4}
        >
          <DropdownMenu.Item
            onSelect={onDelete}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-control cursor-default outline-none"
          >
            <Trash2 size={11} />
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
