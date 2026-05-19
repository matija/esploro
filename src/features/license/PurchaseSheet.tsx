import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IAP_ENTITLEMENT_KEY,
  IAP_PRODUCTS_KEY,
  LICENSE_STATUS_KEY,
  licenseApi,
} from './api';
import { useToast } from '../../components/Toast';

interface Props {
  open: boolean;
  onClose: () => void;
}

/// Right-side sheet that lists the three IAP products fetched live from
/// `iap_get_products` and routes per-card purchases through `iap_purchase`.
/// Only rendered in the MAS build (`buildFlavor === 'mas'`); the Direct build
/// uses `LicenseActivationSheet` instead.
///
/// Restore Purchases is mounted both here (App Review precedent) and in
/// `LicenseSettings`, so a user who already paid on another machine can recover
/// their entitlement without ever opening this sheet.
export function PurchaseSheet({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const {
    data: products,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: IAP_PRODUCTS_KEY,
    queryFn: licenseApi.getProducts,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  async function refreshLicenseState() {
    const [status, entitlement] = await Promise.all([
      licenseApi.getStatus(),
      licenseApi.checkEntitlement(),
    ]);
    queryClient.setQueryData(LICENSE_STATUS_KEY, status);
    queryClient.setQueryData(IAP_ENTITLEMENT_KEY, entitlement);
  }

  async function handlePurchase(productId: string) {
    setBusyProductId(productId);
    try {
      const result = await licenseApi.purchase(productId);
      if (result.status === 'purchased') {
        await refreshLicenseState();
        toast('License activated. Welcome aboard!', 'success');
        onClose();
      } else if (result.status === 'cancelled') {
        // No toast — user dismissed the sheet themselves.
      } else {
        toast('Purchase failed. Please try again.', 'error');
      }
    } catch (e) {
      toast(`Purchase failed: ${String(e)}`, 'error');
    } finally {
      setBusyProductId(null);
    }
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      const result = await licenseApi.restore();
      await refreshLicenseState();
      if (result.restored) {
        toast('Purchases restored.', 'success');
        onClose();
      } else {
        toast('No previous purchases found on this Apple ID.', 'info');
      }
    } catch (e) {
      toast(`Restore failed: ${String(e)}`, 'error');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          className="fixed right-0 top-0 h-full w-[360px] z-50 flex flex-col
            bg-content border-l border-separator shadow-2xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-separator">
            <Dialog.Title className="text-sm font-semibold text-label">
              Get a license
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

          <div className="flex flex-col gap-3 p-5 flex-1 overflow-auto">
            <p className="text-xs text-secondary">
              Esploro is free for personal use. Choose a plan below for
              commercial use.
            </p>

            {isLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-secondary">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-xs">Loading plans…</span>
              </div>
            )}

            {error && (
              <div className="flex flex-col gap-2 rounded border border-separator bg-control/40 p-3">
                <p className="text-xs text-destructive">
                  Couldn't load plans from the App Store.
                </p>
                <button
                  onClick={() => refetch()}
                  className="self-start text-xs text-accent hover:underline"
                >
                  Try again
                </button>
              </div>
            )}

            {products?.map((product) => {
              const busy = busyProductId === product.id;
              const anyBusy = busyProductId !== null || restoring;
              return (
                <div
                  key={product.id}
                  className="flex flex-col gap-2 rounded-lg border border-separator
                    bg-raised p-4"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium text-label">
                      {product.title}
                    </h3>
                    <span className="text-sm font-semibold text-label tabular-nums">
                      {product.price}
                    </span>
                  </div>
                  <p className="text-xs text-secondary leading-snug">
                    {product.description}
                  </p>
                  <button
                    onClick={() => handlePurchase(product.id)}
                    disabled={anyBusy}
                    className="mt-1 px-3 py-1.5 rounded text-xs font-medium
                      bg-accent text-white
                      disabled:opacity-40 hover:bg-accent/90 active:bg-accent/80
                      transition-colors flex items-center justify-center gap-1.5"
                  >
                    {busy ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Processing…
                      </>
                    ) : (
                      'Buy'
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="border-t border-separator px-5 py-3">
            <button
              onClick={handleRestore}
              disabled={restoring || busyProductId !== null}
              className="text-xs text-accent hover:underline
                disabled:opacity-40 disabled:no-underline
                flex items-center gap-1.5"
            >
              {restoring && <Loader2 size={11} className="animate-spin" />}
              Restore purchases
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
