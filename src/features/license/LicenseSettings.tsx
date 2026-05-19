import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BUILD_FLAVOR_KEY,
  IAP_ENTITLEMENT_KEY,
  LICENSE_STATUS_KEY,
  licenseApi,
} from './api';
import { LicenseActivationSheet } from './LicenseActivationSheet';
import { PurchaseSheet } from './PurchaseSheet';
import { useToast } from '../../components/Toast';

const PRODUCT_LABELS: Record<string, string> = {
  'app.esploro.personal.lifetime': 'Personal — Lifetime',
  'app.esploro.personal.annual': 'Personal — Annual',
  'app.esploro.business.annual': 'Business — Annual',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function LicenseSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activationOpen, setActivationOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: LICENSE_STATUS_KEY,
    queryFn: licenseApi.getStatus,
    staleTime: 60_000,
  });
  const { data: buildFlavor } = useQuery({
    queryKey: BUILD_FLAVOR_KEY,
    queryFn: licenseApi.getBuildFlavor,
    staleTime: Infinity,
  });
  const isMas = buildFlavor === 'mas';

  // MAS only — gives us the active product ID + expiry for the licensed
  // panel. Skipped on the Direct build because the Dodo path has no entitlement
  // command and would 404 at runtime.
  const { data: entitlement } = useQuery({
    queryKey: IAP_ENTITLEMENT_KEY,
    queryFn: licenseApi.checkEntitlement,
    enabled: isMas,
    staleTime: 60_000,
  });

  async function handleRemove() {
    const newStatus = await licenseApi.deactivate();
    queryClient.setQueryData(LICENSE_STATUS_KEY, newStatus);
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      const result = await licenseApi.restore();
      const [s, e] = await Promise.all([
        licenseApi.getStatus(),
        licenseApi.checkEntitlement(),
      ]);
      queryClient.setQueryData(LICENSE_STATUS_KEY, s);
      queryClient.setQueryData(IAP_ENTITLEMENT_KEY, e);
      toast(
        result.restored
          ? 'Purchases restored.'
          : 'No previous purchases found on this Apple ID.',
        result.restored ? 'success' : 'info',
      );
    } catch (err) {
      toast(`Restore failed: ${String(err)}`, 'error');
    } finally {
      setRestoring(false);
    }
  }

  if (isLoading) return null;

  // ---- MAS — Commercial / licensed user
  if (isMas && status?.tier === 'Commercial') {
    const planLabel = entitlement?.productId
      ? (PRODUCT_LABELS[entitlement.productId] ?? entitlement.productId)
      : 'Commercial';
    const isLifetime = entitlement?.expiresAt == null;

    return (
      <section>
        <h3 className="text-[12px] font-medium text-secondary uppercase tracking-[0.06em] mb-3">
          License
        </h3>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm font-medium text-label">{planLabel}</span>
          </div>
          {entitlement?.expiresAt && (
            <p className="text-sm text-secondary">
              Renews on {formatDate(entitlement.expiresAt)}
            </p>
          )}
          {isLifetime && entitlement?.productId && (
            <p className="text-sm text-secondary">One-time purchase</p>
          )}
          <div className="flex flex-wrap gap-2 mt-1">
            {!isLifetime && (
              <button
                onClick={() => licenseApi.openManageSubscription()}
                className="px-3 py-1.5 text-xs rounded bg-control text-label
                  hover:bg-control/80 transition-colors"
              >
                Manage subscription
              </button>
            )}
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="px-3 py-1.5 text-xs rounded bg-control text-label
                hover:bg-control/80 transition-colors disabled:opacity-50
                flex items-center gap-1.5"
            >
              {restoring && <Loader2 size={11} className="animate-spin" />}
              Restore purchases
            </button>
          </div>
        </div>
      </section>
    );
  }

  // ---- MAS — Personal / unlicensed user
  if (isMas) {
    return (
      <section>
        <h3 className="text-[12px] font-medium text-secondary uppercase tracking-[0.06em] mb-3">
          License
        </h3>
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
          <div className="flex flex-wrap gap-2 mt-1">
            <button
              onClick={() => setPurchaseOpen(true)}
              className="px-3 py-1.5 text-xs rounded bg-accent text-white
                hover:bg-accent/90 transition-colors"
            >
              Get a license
            </button>
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="px-3 py-1.5 text-xs rounded bg-control text-label
                hover:bg-control/80 transition-colors disabled:opacity-50
                flex items-center gap-1.5"
            >
              {restoring && <Loader2 size={11} className="animate-spin" />}
              Restore purchases
            </button>
          </div>
        </div>
        <PurchaseSheet
          open={purchaseOpen}
          onClose={() => setPurchaseOpen(false)}
        />
      </section>
    );
  }

  // ---- Direct build (existing UI)
  return (
    <section>
      <h3 className="text-[12px] font-medium text-secondary uppercase tracking-[0.06em] mb-3">
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
              onClick={() => licenseApi.openPricingPage()}
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
    </section>
  );
}
