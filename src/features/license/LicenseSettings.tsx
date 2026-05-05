import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { licenseApi, LICENSE_STATUS_KEY } from './api';
import { LicenseActivationSheet } from './LicenseActivationSheet';
import { PlanPickerDialog } from './PlanPickerDialog';

export function LicenseSettings() {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: LICENSE_STATUS_KEY,
    queryFn: licenseApi.getStatus,
    staleTime: 60_000,
  });
  const [activationOpen, setActivationOpen] = useState(false);
  const [planPickerOpen, setPlanPickerOpen] = useState(false);

  async function handleRemove() {
    const newStatus = await licenseApi.deactivate();
    queryClient.setQueryData(LICENSE_STATUS_KEY, newStatus);
  }

  if (isLoading) return null;

  return (
    <section>
      <h3 className="text-[11px] font-medium text-secondary uppercase tracking-[0.06em] mb-3">
        License
      </h3>

      {status?.tier === 'Commercial' ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm font-medium text-label">Commercial</span>
          </div>
          <button
            onClick={() => licenseApi.openCustomerPortal()}
            className="self-start text-sm text-accent hover:underline"
          >
            Manage subscription / Find my key →
          </button>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => setActivationOpen(true)}
              className="px-3 py-1.5 text-xs rounded bg-control text-label
                hover:bg-control/80 transition-colors"
            >
              Enter a different key
            </button>
            <button
              onClick={handleRemove}
              className="px-3 py-1.5 text-xs rounded text-destructive
                hover:bg-control transition-colors"
            >
              Remove license
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-secondary/50" />
            <span className="text-sm font-medium text-label">
              {status?.tier === 'Personal' ? 'Personal (free)' : 'No license'}
            </span>
          </div>
          <p className="text-sm text-secondary">
            Commercial use requires a license.
          </p>
          <div className="flex flex-col gap-2 mt-1">
            <button
              onClick={() => setPlanPickerOpen(true)}
              className="self-start text-sm text-accent hover:underline"
            >
              Purchase license →
            </button>
            <button
              onClick={() => setActivationOpen(true)}
              className="self-start text-sm text-secondary hover:text-label transition-colors"
            >
              Activate a license key
            </button>
          </div>
        </div>
      )}

      <LicenseActivationSheet
        open={activationOpen}
        onClose={() => setActivationOpen(false)}
      />
      <PlanPickerDialog
        open={planPickerOpen}
        onClose={() => setPlanPickerOpen(false)}
      />
    </section>
  );
}
