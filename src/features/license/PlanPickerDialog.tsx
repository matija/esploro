import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { licenseApi } from './api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PlanPickerDialog({ open, onClose }: Props) {
  function handleCheckout(plan: 'lifetime' | 'annual') {
    licenseApi.openCheckoutUrl(plan);
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[480px] bg-content rounded-xl border border-separator shadow-2xl p-6
            flex flex-col gap-5"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between">
            <div>
              <Dialog.Title className="text-base font-semibold text-label">
                Purchase Esploro
              </Dialog.Title>
              <p className="mt-1 text-xs text-secondary">
                Choose the plan that fits how you work. You'll receive your license key by email.
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                className="p-1 rounded text-secondary hover:text-label hover:bg-control transition-colors"
                title="Close"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <PlanCard
              name="Esploro Lifetime"
              price="$99.99"
              period="one-time"
              description="Pay once, use forever."
              badge="Best value"
              onSelect={() => handleCheckout('lifetime')}
            />
            <PlanCard
              name="Esploro Annual"
              price="$39.99"
              period="per year"
              description="Auto-renews, always up-to-date."
              onSelect={() => handleCheckout('annual')}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface PlanCardProps {
  name: string;
  price: string;
  period: string;
  description: string;
  badge?: string;
  onSelect: () => void;
}

function PlanCard({ name, price, period, description, badge, onSelect }: PlanCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-separator bg-subtle p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-label">{name}</span>
        {badge && (
          <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded
            bg-accent/10 text-accent">
            {badge}
          </span>
        )}
      </div>
      <div>
        <span className="text-xl font-semibold text-label">{price}</span>
        <span className="ml-1 text-xs text-secondary">{period}</span>
      </div>
      <p className="text-xs text-secondary">{description}</p>
      <button
        onClick={onSelect}
        className="mt-auto px-3 py-1.5 rounded text-sm font-medium bg-accent text-white
          hover:bg-accent/90 active:bg-accent/80 transition-colors"
      >
        Continue to checkout
      </button>
    </div>
  );
}
