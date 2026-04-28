import { useState } from 'react';
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

export function ConnectionList({ profiles, onEdit, onRefresh, renderExpansion }: Props) {
  const { activeSessions, connectSession, disconnectSession } = useAppStore();

  const [connecting, setConnecting] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  function toggleFolder(folder: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  const activeConnectionIds = new Set(Object.keys(activeSessions));

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

  if (profiles.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-secondary">No connections yet</div>
    );
  }

  const ungrouped = profiles.filter((p) => !p.folder);
  const folderMap = new Map<string, ConnectionProfile[]>();
  for (const p of profiles) {
    if (p.folder) {
      if (!folderMap.has(p.folder)) folderMap.set(p.folder, []);
      folderMap.get(p.folder)!.push(p);
    }
  }
  const folderNames = Array.from(folderMap.keys()).sort();

  function renderConnection(p: ConnectionProfile, indented = false) {
    const isActive = activeConnectionIds.has(p.id);
    const isConnecting = !!connecting[p.id];
    const sessionId = activeSessions[p.id];

    return (
      <div key={p.id}>
        <div
          className={cn(
            'group flex items-center gap-2 py-1.5 hover:bg-control transition-colors',
            indented ? 'pl-6 pr-3' : 'px-3',
          )}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0 border"
            style={{
              backgroundColor: isActive ? '#34C759' : 'transparent',
              borderColor: p.color ?? '#8E8E93',
            }}
          />

          <span className="flex-1 text-sm text-label truncate">{p.displayName}</span>

          <div
            className={cn(
              'flex items-center gap-0.5 transition-opacity',
              'opacity-0 group-hover:opacity-100',
              isActive && 'opacity-100',
            )}
          >
            {isActive ? (
              <button
                onClick={() => handleDisconnect(p.id)}
                title="Disconnect"
                className="p-1 rounded hover:bg-separator text-secondary hover:text-label transition-colors"
              >
                <PlugZap size={12} />
              </button>
            ) : (
              <button
                onClick={() => handleConnect(p.id)}
                disabled={isConnecting}
                title="Connect"
                className="p-1 rounded hover:bg-separator text-secondary hover:text-label transition-colors disabled:opacity-50"
              >
                <Plug size={12} />
              </button>
            )}
            <button
              onClick={() => onEdit(p)}
              title="Edit"
              className="p-1 rounded hover:bg-separator text-secondary hover:text-label transition-colors"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => handleDelete(p.id)}
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
    <div>
      {ungrouped.map((p) => renderConnection(p))}

      {folderNames.map((folder) => {
        const isCollapsed = collapsedFolders.has(folder);
        const children = folderMap.get(folder)!;

        return (
          <div key={folder}>
            <button
              onClick={() => toggleFolder(folder)}
              className="w-full flex items-center gap-1.5 px-3 py-1 hover:bg-control transition-colors text-secondary"
            >
              <ChevronRight
                size={11}
                className={cn('shrink-0 transition-transform', !isCollapsed && 'rotate-90')}
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
