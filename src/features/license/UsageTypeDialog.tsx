import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { licenseApi, LICENSE_STATUS_KEY } from './api';

export function UsageTypeDialog() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: LICENSE_STATUS_KEY,
    queryFn: licenseApi.getStatus,
    staleTime: 60_000,
  });
  const [answer, setAnswer] = useState<'personal' | 'commercial'>('personal');
  const [loading, setLoading] = useState(false);

  const open = status?.showUsageDialog ?? false;

  async function handleContinue() {
    setLoading(true);
    try {
      const newStatus = await licenseApi.answerUsageDialog(answer);
      queryClient.setQueryData(LICENSE_STATUS_KEY, newStatus);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-96 bg-content rounded-xl border border-separator shadow-2xl p-6
            flex flex-col gap-5"
        >
          <div>
            <Dialog.Title className="text-base font-semibold text-label">
              How are you using Esploro?
            </Dialog.Title>
            <p className="mt-1 text-xs text-secondary">
              This helps us apply the right license terms.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-3 cursor-default group">
              <input
                type="radio"
                name="usage"
                value="personal"
                checked={answer === 'personal'}
                onChange={() => setAnswer('personal')}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium text-label">
                  Personal / hobby projects
                </div>
                <div className="text-xs text-secondary">Free forever</div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-default group">
              <input
                type="radio"
                name="usage"
                value="commercial"
                checked={answer === 'commercial'}
                onChange={() => setAnswer('commercial')}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium text-label">
                  Work / client projects
                </div>
                <div className="text-xs text-secondary">
                  Commercial license required
                </div>
              </div>
            </label>
          </div>

          <button
            type="button"
            onClick={handleContinue}
            disabled={loading}
            className="px-4 py-2 rounded text-sm font-medium bg-accent text-inverse
              disabled:opacity-40 hover:bg-accent-hover transition-colors"
          >
            Continue
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
