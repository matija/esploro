import { useState, useEffect, useRef } from 'react';
import { Plug, PlugZap, Pencil, Trash2, ChevronRight, Folder } from 'lucide-react';
import { cn } from '../../lib/utils';
import { connectionsApi } from './api';
import type { ConnectionProfile } from './types';
import { useAppStore } from '../../store';

interface Props {
  profiles: ConnectionProfile[];
  onEdit: (profile: ConnectionProfile) => void;
  onRefresh: () => void;
  renderExpansion?: (connectionId: string, sessionId: string) => React.ReactNode;
}

type NavItem =
  | { kind: 'connection'; profile: ConnectionProfile }
  | { kind: 'folder'; name: string };

function navKey(item: NavItem): string {
  return item.kind === 'connection' ? `conn:${item.profile.id}` : `folder:${item.name}`;
}

export function ConnectionList({ profiles, onEdit, onRefresh, renderExpansion }: Props) {
  const { activeSessions, connectSession, disconnectSession } = useAppStore();

  const [connecting, setConnecting] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function toggleFolder(folder: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  const activeConnectionIds = new Set(Object.keys(activeSessions));

  const ungrouped = profiles.filter((p) => !p.folder);
  const folderMap = new Map<string, ConnectionProfile[]>();
  for (const p of profiles) {
    if (p.folder) {
      if (!folderMap.has(p.folder)) folderMap.set(p.folder, []);
      folderMap.get(p.folder)!.push(p);
    }
  }
  const folderNames = Array.from(folderMap.keys()).sort();

  // Flat list of navigable items (respects collapsed folders)
  const navItems: NavItem[] = [];
  for (const p of ungrouped) navItems.push({ kind: 'connection', profile: p });
  for (const folder of folderNames) {
    navItems.push({ kind: 'folder', name: folder });
    if (!collapsedFolders.has(folder)) {
      for (const p of folderMap.get(folder)!) {
        navItems.push({ kind: 'connection', profile: p });
      }
    }
  }

  const focusedIndex = focusedKey !== null
    ? navItems.findIndex((item) => navKey(item) === focusedKey)
    : -1;

  useEffect(() => {
    if (!focusedKey || !containerRef.current) return;
    const el = containerRef.current.querySelector(
      `[data-nav-key="${CSS.escape(focusedKey)}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedKey]);

  async function handleConnect(id: string) {
    setConnecting((prev) => ({ ...prev, [id]: true }));
    try {
      const sessionId = await connectionsApi.connect(id);
      connectSession(id, sessionId);
    } catch (e) {
      console.error('Connect failed', e);
    } finally {
      setConnecting((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function handleDisconnect(id: string) {
    const sessionId = activeSessions[id];
    if (!sessionId) return;
    try {
      await connectionsApi.disconnect(sessionId);
      disconnectSession(id);
    } catch (e) {
      console.error('Disconnect failed', e);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this connection?')) return;
    try {
      await connectionsApi.delete(id);
      disconnectSession(id);
      onRefresh();
    } catch (e) {
      console.error('Delete failed', e);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (navItems.length === 0) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex < 0) {
          setFocusedKey(navKey(navItems[0]));
        } else if (focusedIndex < navItems.length - 1) {
          setFocusedKey(navKey(navItems[focusedIndex + 1]));
        }
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex > 0) {
          setFocusedKey(navKey(navItems[focusedIndex - 1]));
        }
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex < 0) break;
        const item = navItems[focusedIndex];
        if (item.kind === 'folder' && collapsedFolders.has(item.name)) {
          toggleFolder(item.name);
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex < 0) break;
        const item = navItems[focusedIndex];
        if (item.kind === 'folder' && !collapsedFolders.has(item.name)) {
          toggleFolder(item.name);
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        e.stopPropagation();
        if (focusedIndex < 0) break;
        const item = navItems[focusedIndex];
        if (item.kind === 'folder') {
          toggleFolder(item.name);
        } else {
          const { id } = item.profile;
          if (activeConnectionIds.has(id)) {
            handleDisconnect(id);
          } else {
            handleConnect(id);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  if (profiles.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-secondary">No connections yet</div>
    );
  }

  function renderConnection(p: ConnectionProfile, indented = false) {
    const isActive = activeConnectionIds.has(p.id);
    const isConnecting = !!connecting[p.id];
    const sessionId = activeSessions[p.id];
    const isFocused = focusedKey === `conn:${p.id}`;

    return (
      <div key={p.id}>
        <div
          data-nav-key={`conn:${p.id}`}
          onClick={() => setFocusedKey(`conn:${p.id}`)}
          className={cn(
            'group flex items-center gap-2 py-1.5 hover:bg-subtle transition-colors',
            'border-l-2 border-transparent',
            indented ? 'pl-6 pr-3' : 'px-3',
            isFocused && 'bg-active border-accent',
          )}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0 border"
            style={{
              backgroundColor: isActive ? 'var(--ds-success)' : 'transparent',
              borderColor: p.color ?? '#8E8E93',
            }}
          />

          <span className="flex-1 text-sm text-label truncate">{p.displayName}</span>

          <div
            className={cn(
              'flex items-center gap-0.5 transition-opacity',
              'opacity-0 group-hover:opacity-100',
              (isActive || isFocused) && 'opacity-100',
            )}
          >
            {isActive ? (
              <button
                onClick={(e) => { e.stopPropagation(); handleDisconnect(p.id); }}
                title="Disconnect"
                className="p-1 rounded hover:bg-separator text-secondary hover:text-label transition-colors"
              >
                <PlugZap size={12} />
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); handleConnect(p.id); }}
                disabled={isConnecting}
                title="Connect"
                className="p-1 rounded hover:bg-separator text-secondary hover:text-label transition-colors disabled:opacity-50"
              >
                <Plug size={12} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(p); }}
              title="Edit"
              className="p-1 rounded hover:bg-separator text-secondary hover:text-label transition-colors"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
              title="Delete"
              className="p-1 rounded hover:bg-separator text-secondary hover:text-destructive transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {isActive && sessionId && renderExpansion?.(p.id, sessionId)}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="outline-none"
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          setFocusedKey(null);
        }
      }}
    >
      {ungrouped.map((p) => renderConnection(p))}

      {folderNames.map((folder) => {
        const isCollapsed = collapsedFolders.has(folder);
        const isFocused = focusedKey === `folder:${folder}`;
        const children = folderMap.get(folder)!;

        return (
          <div key={folder}>
            <button
              data-nav-key={`folder:${folder}`}
              onClick={() => { toggleFolder(folder); setFocusedKey(`folder:${folder}`); }}
              className={cn(
                'w-full flex items-center gap-1.5 px-3 py-1 hover:bg-subtle transition-colors text-secondary',
                'border-l-2 border-transparent',
                isFocused && 'bg-active border-accent',
              )}
            >
              <ChevronRight
                size={11}
                className={cn('shrink-0 transition-transform duration-150 ease-out', !isCollapsed && 'rotate-90')}
              />
              <Folder size={11} className="shrink-0" />
              <span className="text-xs font-medium truncate">{folder}</span>
            </button>
            {!isCollapsed && children.map((p) => renderConnection(p, true))}
          </div>
        );
      })}
    </div>
  );
}
