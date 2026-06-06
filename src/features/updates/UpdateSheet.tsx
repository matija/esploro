import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { relaunch } from '@tauri-apps/plugin-process';
import { updatesApi } from './api';

interface ProgressPayload {
  downloaded: number;
  total?: number;
}

interface Props {
  open: boolean;
  currentVersion: string;
  updateVersion: string;
  notes: string | null;
  onClose: () => void;
}

export function UpdateSheet({ open, currentVersion, updateVersion, notes, onClose }: Props) {
  const [phase, setPhase] = useState<'idle' | 'installing' | 'done' | 'restarting' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setProgress(0);
      setError(null);
    }
  }, [open]);

  async function handleInstall() {
    setPhase('installing');
    setProgress(0);
    setError(null);

    const unlisten = await listen<ProgressPayload>('update:progress', ({ payload }) => {
      if (payload.total) {
        setProgress(Math.round((payload.downloaded / payload.total) * 100));
      }
    });

    try {
      await updatesApi.installUpdate();
      setProgress(100);
      setPhase('done');
    } catch (e) {
      setError(String(e));
      setPhase('error');
    } finally {
      unlisten();
    }
  }

  async function handleRelaunch() {
    setPhase('restarting');
    setError(null);

    try {
      await relaunch();
    } catch (e) {
      setError(`Failed to restart: ${String(e)}`);
      setPhase('done');
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => !v && phase !== 'installing' && phase !== 'restarting' && onClose()}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          className="fixed right-0 top-0 h-full w-80 z-50 flex flex-col
            bg-content border-l border-separator shadow-2xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-separator">
            <Dialog.Title className="text-sm font-semibold text-label">
              Update Available
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="p-1 rounded text-secondary hover:text-label hover:bg-control transition-colors disabled:opacity-40"
                title="Close"
                disabled={phase === 'installing' || phase === 'restarting'}
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-4 p-5 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-label">
              <span className="text-secondary">{currentVersion}</span>
              <span className="text-tertiary">→</span>
              <span>{updateVersion}</span>
            </div>

            {notes && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-secondary font-medium">Release notes</p>
                <p className="text-xs text-label leading-relaxed whitespace-pre-line line-clamp-6">
                  {notes.slice(0, 500)}
                </p>
              </div>
            )}

            {(phase === 'installing' || phase === 'done') && (
              <div className="flex flex-col gap-1.5">
                <div className="w-full h-1.5 rounded-full bg-control overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300 rounded-full"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-tertiary">{progress}%</p>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex gap-2 mt-auto">
              {phase === 'done' || phase === 'restarting' ? (
                <button
                  onClick={() => void handleRelaunch()}
                  disabled={phase === 'restarting'}
                  className="flex-1 px-4 py-2 rounded text-sm font-medium bg-accent text-inverse
                    disabled:opacity-40 hover:bg-accent-hover active:opacity-80 transition-colors"
                >
                  {phase === 'restarting' ? 'Restarting…' : 'Restart to Apply'}
                </button>
              ) : (
                <button
                  onClick={() => void handleInstall()}
                  disabled={phase === 'installing'}
                  className="flex-1 px-4 py-2 rounded text-sm font-medium bg-accent text-inverse
                    disabled:opacity-40 hover:bg-accent-hover active:opacity-80 transition-colors"
                >
                  {phase === 'installing' ? 'Installing…' : 'Download & Install'}
                </button>
              )}
              {phase !== 'done' && (
                <button
                  onClick={onClose}
                  disabled={phase === 'installing'}
                  className="px-4 py-2 rounded text-sm font-medium text-secondary
                    hover:text-label hover:bg-control disabled:opacity-40 transition-colors"
                >
                  Later
                </button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
