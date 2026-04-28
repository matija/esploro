import { useState } from 'react';
import { Plug, PlugZap, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { connectionsApi } from './api';
import type { ConnectionProfile } from './types';
import { useAppStore } from '../../store';

interface Props {
  profiles: ConnectionProfile[];
  onEdit: (profile: ConnectionProfile) => void;
  onRefresh: () => void;
}

export function ConnectionList({ profiles, onEdit, onRefresh }: Props) {
  const { activeSessions, connectSession, disconnectSession } = useAppStore();

  // connectionId -> true while connecting
  const [connecting, setConnecting] = useState<Record<string, boolean>>({});

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

  return (
    <div>
      {profiles.map((p) => {
        const isActive = activeConnectionIds.has(p.id);
        const isConnecting = !!connecting[p.id];

        return (
          <div
            key={p.id}
            className="group flex items-center gap-2 px-3 py-1.5 hover:bg-control transition-colors"
          >
            {/* Color dot */}
            <span
              className="w-2 h-2 rounded-full shrink-0 border"
              style={{
                backgroundColor: isActive ? '#34C759' : 'transparent',
                borderColor: p.color ?? '#8E8E93',
              }}
            />

            {/* Name */}
            <span className="flex-1 text-sm text-label truncate">{p.displayName}</span>

            {/* Actions (visible on hover or when active) */}
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
        );
      })}
    </div>
  );
}
