import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
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

  return (
    <>
      <div className={cn(
        "shrink-0 flex items-center gap-3 px-4 py-2 border-t text-label",
        status?.revalidationRequired ? "bg-warning/10 border-warning/30" : "bg-sidebar border-separator",
      )}>
        <span className="min-w-0 flex-1 text-xs text-secondary">
          {status?.revalidationRequired
            ? "License re-validation required — connect to the internet to continue using Esploro commercially."
            : "Personal use is free. Commercial use requires a license."}
        </span>
        {!status?.revalidationRequired && (
          <button
            type="button"
            onClick={() => licenseApi.openPricingPage()}
            className="shrink-0 rounded px-2 py-1 text-xs text-accent hover:bg-hover transition-colors"
          >
            Purchase license
          </button>
        )}
        <button
          type="button"
          onClick={() => setActivationOpen(true)}
          className="shrink-0 px-2.5 py-1 rounded-[var(--radius-control)] border border-separator bg-content text-xs text-label hover:bg-hover transition-colors"
        >
          {status?.revalidationRequired ? "Re-enter key" : "Activate license"}
        </button>
        {!status?.revalidationRequired && (
          <button
            type="button"
            onClick={handleDismiss}
            className="shrink-0 p-1 rounded text-secondary hover:bg-hover hover:text-label transition-colors"
            title="Dismiss"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <LicenseActivationSheet
        open={activationOpen}
        onClose={() => setActivationOpen(false)}
      />
    </>
  );
}
