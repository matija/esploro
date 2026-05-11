import { useState } from 'react';
import { X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { licenseApi, LICENSE_STATUS_KEY } from './api';
import { LicenseActivationSheet } from './LicenseActivationSheet';

export function LicenseBanner() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: LICENSE_STATUS_KEY,
    queryFn: licenseApi.getStatus,
    staleTime: 60_000,
  });
  const [activationOpen, setActivationOpen] = useState(false);

  const showBanner = status?.bannerVisible || status?.revalidationRequired;
  if (!showBanner) return null;

  async function handleDismiss() {
    await licenseApi.dismissBanner();
    queryClient.invalidateQueries({ queryKey: LICENSE_STATUS_KEY });
  }

  if (status?.revalidationRequired) {
    return (
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5
        bg-amber-50 dark:bg-amber-950/50
        border-t border-amber-200 dark:border-amber-800
        text-amber-900 dark:text-amber-100">
        <span className="flex-1 text-xs">
          License re-validation required — connect to the internet to continue using Esploro commercially.
        </span>
        <button
          onClick={() => setActivationOpen(true)}
          className="shrink-0 px-2.5 py-1 rounded text-xs font-medium
            bg-amber-200 dark:bg-amber-800
            hover:bg-amber-300 dark:hover:bg-amber-700 transition-colors"
        >
          Re-enter key
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5
        bg-amber-50 dark:bg-amber-950/50
        border-t border-amber-200 dark:border-amber-800
        text-amber-900 dark:text-amber-100">
        <span className="flex-1 text-xs">
          Esploro is free for personal use. Commercial use requires a license.
        </span>
        <button
          onClick={() => licenseApi.openPricingPage()}
          className="shrink-0 px-2.5 py-1 rounded text-xs font-medium
            bg-amber-200 dark:bg-amber-800
            hover:bg-amber-300 dark:hover:bg-amber-700 transition-colors"
        >
          Purchase license
        </button>
        <button
          onClick={() => setActivationOpen(true)}
          className="shrink-0 px-2.5 py-1 rounded text-xs font-medium
            bg-amber-200 dark:bg-amber-800
            hover:bg-amber-300 dark:hover:bg-amber-700 transition-colors"
        >
          I have a license key
        </button>
        <button
          onClick={handleDismiss}
          className="shrink-0 p-1 rounded
            hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
          title="Dismiss"
        >
          <X size={13} />
        </button>
      </div>

      <LicenseActivationSheet
        open={activationOpen}
        onClose={() => setActivationOpen(false)}
      />
    </>
  );
}
