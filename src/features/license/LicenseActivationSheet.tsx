import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { licenseApi, LICENSE_STATUS_KEY } from './api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LicenseActivationSheet({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activated, setActivated] = useState(false);

  function handleClose() {
    onClose();
    setKey('');
    setError(null);
    setActivated(false);
  }

  async function handleActivate() {
    if (!key.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const status = await licenseApi.activate(key.trim());
      queryClient.setQueryData(LICENSE_STATUS_KEY, status);
      setActivated(true);
      setTimeout(handleClose, 1200);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          className="fixed right-0 top-0 h-full w-80 z-50 flex flex-col
            bg-content border-l border-separator shadow-2xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-separator">
            <Dialog.Title className="text-sm font-semibold text-label">
              Activate License
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="p-1 rounded text-secondary hover:text-label hover:bg-control transition-colors"
                title="Close"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-4 p-5 flex-1">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-secondary">License Key</label>
              <textarea
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleActivate();
                  }
                }}
                placeholder="Paste your license key from the email…"
                className="w-full h-20 px-3 py-2 text-xs font-mono rounded
                  bg-control border border-separator text-label
                  placeholder:text-secondary resize-none
                  focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
            {activated && (
              <p className="text-xs text-success">
                License activated successfully!
              </p>
            )}

            <button
              onClick={handleActivate}
              disabled={!key.trim() || loading || activated}
              className="px-4 py-2 rounded text-sm font-medium bg-accent text-inverse
                disabled:opacity-40 hover:bg-accent-hover active:opacity-80 transition-colors"
            >
              {loading ? 'Activating…' : 'Activate'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
