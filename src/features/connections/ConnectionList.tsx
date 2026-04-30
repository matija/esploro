import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plug, PlugZap, Pencil, Trash2, Copy, ChevronRight, Folder, Plus, Loader2, ServerCrash } from 'lucide-react';
import { cn } from '../../lib/utils';
import { connectionsApi } from './api';
import type { ConnectionProfile, ConnectionInput } from './types';
import { useAppStore } from '../../store';

interface Props {
  profiles: ConnectionProfile[];
  onEdit: (profile: ConnectionProfile) => void;
  onRefresh: () => void;
  onNewConnection?: () => void;
  renderExpansion?: (connectionId: string, sessionId: string) => React.ReactNode;
}

type NavItem =
  | { kind: 'connection'; profile: ConnectionProfile }
  | { kind: 'folder'; name: string };

function navKey(item: NavItem): string {
  return item.kind === 'connection' ? `conn:${item.profile.id}` : `folder:${item.name}`;
}

// ─── Context menu ─────────────────────────────────────────────────────────────

type ContextMenuState = {
  profile: ConnectionProfile;
  isActive: boolean;
  x: number;
  y: number;
};

function ConnectionContextMenu({
  menu,
  onClose,
  onConnect,
  onDisconnect,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const onMouseDown = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className={cn(
        'fixed z-50 min-w-[180px] rounded-lg overflow-hidden',
        'bg-raised border border-separator shadow-lg py-1',
      )}
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menu.isActive ? (
        <button
          onClick={onDisconnect}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors"
        >
          <PlugZap size={11} className="text-secondary" />
          Disconnect
        </button>
      ) : (
        <button
          onClick={onConnect}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors"
        >
          <Plug size={11} className="text-success" />
          Connect
        </button>
      )}
      <button
        onClick={onEdit}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors"
      >
        <Pencil size={11} className="text-secondary" />
        Edit…
      </button>
      <button
        onClick={onDuplicate}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-label hover:bg-hover transition-colors"
      >
        <Copy size={11} className="text-secondary" />
        Duplicate
      </button>
      <div className="my-1 border-t border-separator" />
      <button
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-hover transition-colors"
      >
        <Trash2 size={11} />
        Delete
      </button>
    </div>,
    document.body,
  );
}

// ─── Connection row ───────────────────────────────────────────────────────────

function ConnectionRow({
  profile,
  isActive,
  isConnecting,
  isFocused,
  indented,
  onFocus,
  onConnect,
  onDisconnect,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  profile: ConnectionProfile;
  isActive: boolean;
  isConnecting: boolean;
  isFocused: boolean;
  indented: boolean;
  onFocus: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const hostLabel = profile.socketPath
    ? 'socket'
    : `${profile.host ?? 'localhost'}:${profile.port}`;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ profile, isActive, x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        data-nav-key={`conn:${profile.id}`}
        onClick={onFocus}
        onContextMenu={handleContextMenu}
        className={cn(
          'group flex items-start gap-2 py-1.5 transition-colors',
          'border-l-2 border-transparent',
          indented ? 'pl-6 pr-2' : 'px-2 pr-2',
          isFocused
            ? 'bg-selected border-l-accent'
            : 'hover:bg-hover',
        )}
      >
        {/* Status dot */}
        <div className="mt-[3px] shrink-0 relative">
          {isConnecting ? (
            <Loader2 size={10} className="text-accent animate-spin" />
          ) : (
            <span
              className="block w-2 h-2 rounded-full border"
              style={{
                backgroundColor: isActive ? 'var(--ds-success)' : 'transparent',
                borderColor: profile.color ?? 'var(--border-default)',
              }}
            />
          )}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-label truncate leading-[1.4]">
            {profile.displayName}
          </div>
          <div className="text-[10px] text-tertiary truncate leading-[1.4]">
            {profile.username}@{hostLabel}/{profile.database}
          </div>
        </div>

        {/* Hover actions */}
        <div
          className={cn(
            'flex items-center gap-0.5 mt-[1px] transition-opacity shrink-0',
            'opacity-0 group-hover:opacity-100',
            (isActive || isFocused) && 'opacity-100',
          )}
        >
          {isActive ? (
            <button
              onClick={(e) => { e.stopPropagation(); onDisconnect(); }}
              title="Disconnect"
              className="p-1 rounded hover:bg-pressed text-secondary hover:text-label transition-colors"
            >
              <PlugZap size={11} />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onConnect(); }}
              disabled={isConnecting}
              title="Connect"
              className="p-1 rounded hover:bg-pressed text-secondary hover:text-success transition-colors disabled:opacity-40"
            >
              <Plug size={11} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            title="Edit"
            className="p-1 rounded hover:bg-pressed text-secondary hover:text-label transition-colors"
          >
            <Pencil size={11} />
          </button>
        </div>
      </div>

      {contextMenu && (
        <ConnectionContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onConnect={() => { onConnect(); setContextMenu(null); }}
          onDisconnect={() => { onDisconnect(); setContextMenu(null); }}
          onEdit={() => { onEdit(); setContextMenu(null); }}
          onDuplicate={() => { onDuplicate(); setContextMenu(null); }}
          onDelete={() => { onDelete(); setContextMenu(null); }}
        />
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ConnectionList({ profiles, onEdit, onRefresh, onNewConnection, renderExpansion }: Props) {
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

  async function handleDuplicate(profile: ConnectionProfile) {
    const input: ConnectionInput = {
      displayName: `${profile.displayName} (copy)`,
      color: profile.color,
      folder: profile.folder,
      host: profile.host,
      port: profile.port,
      socketPath: profile.socketPath,
      database: profile.database,
      username: profile.username,
      sslMode: profile.sslMode,
    };
    try {
      await connectionsApi.create(input, '');
      onRefresh();
    } catch (e) {
      console.error('Duplicate failed', e);
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
      <div className="px-4 py-4 flex flex-col items-center gap-3 text-center">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
        >
          <ServerCrash size={17} className="text-accent" />
        </div>
        <div>
          <p className="text-xs font-medium text-label">No connections</p>
          <p className="text-[11px] text-tertiary mt-0.5 leading-snug">
            Add a PostgreSQL database to get started
          </p>
        </div>
        {onNewConnection && (
          <button
            onClick={onNewConnection}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md',
              'text-xs font-medium bg-accent text-white',
              'hover:opacity-90 active:opacity-80 transition-opacity',
            )}
          >
            <Plus size={11} />
            New Connection
          </button>
        )}
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
      {ungrouped.map((p) => {
        const isActive = activeConnectionIds.has(p.id);
        const sessionId = activeSessions[p.id];
        return (
          <div key={p.id}>
            <ConnectionRow
              profile={p}
              isActive={isActive}
              isConnecting={!!connecting[p.id]}
              isFocused={focusedKey === `conn:${p.id}`}
              indented={false}
              onFocus={() => setFocusedKey(`conn:${p.id}`)}
              onConnect={() => handleConnect(p.id)}
              onDisconnect={() => handleDisconnect(p.id)}
              onEdit={() => onEdit(p)}
              onDuplicate={() => handleDuplicate(p)}
              onDelete={() => handleDelete(p.id)}
            />
            {isActive && sessionId && renderExpansion?.(p.id, sessionId)}
          </div>
        );
      })}

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
                'w-full flex items-center gap-1.5 px-2 py-1 transition-colors text-secondary',
                'border-l-2 border-transparent',
                isFocused ? 'bg-selected border-l-accent' : 'hover:bg-hover',
              )}
            >
              <ChevronRight
                size={11}
                className={cn('shrink-0 transition-transform duration-150 ease-out', !isCollapsed && 'rotate-90')}
              />
              <Folder size={11} className="shrink-0" />
              <span className="text-xs font-medium truncate">{folder}</span>
            </button>
            {!isCollapsed && children.map((p) => {
              const isActive = activeConnectionIds.has(p.id);
              const sessionId = activeSessions[p.id];
              return (
                <div key={p.id}>
                  <ConnectionRow
                    profile={p}
                    isActive={isActive}
                    isConnecting={!!connecting[p.id]}
                    isFocused={focusedKey === `conn:${p.id}`}
                    indented
                    onFocus={() => setFocusedKey(`conn:${p.id}`)}
                    onConnect={() => handleConnect(p.id)}
                    onDisconnect={() => handleDisconnect(p.id)}
                    onEdit={() => onEdit(p)}
                    onDuplicate={() => handleDuplicate(p)}
                    onDelete={() => handleDelete(p.id)}
                  />
                  {isActive && sessionId && renderExpansion?.(p.id, sessionId)}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
