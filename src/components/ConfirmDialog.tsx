import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "../lib/utils";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

// `window.confirm()` is disabled in Tauri 2 webviews (it always returns false),
// so any code path gated on it would silently no-op. Use this hook instead.
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx.confirm;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (result: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const handleResolve = useCallback(
    (result: boolean) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending],
  );

  const opts = pending?.options;

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog.Root
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) handleResolve(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
          <Dialog.Content
            className={cn(
              "fixed left-1/2 top-[28%] -translate-x-1/2 z-50",
              "w-[400px] max-w-[92vw] rounded-xl overflow-hidden",
              "bg-[var(--surface-overlay,var(--color-bg-base))] border border-[var(--border-default,var(--color-border))]",
              "shadow-[var(--shadow-popover,0_12px_30px_rgba(0,0,0,0.18))]",
            )}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              confirmBtnRef.current?.focus();
            }}
          >
            <div className="px-5 pt-5 pb-2">
              <Dialog.Title className="text-sm font-semibold text-label">
                {opts?.title}
              </Dialog.Title>
              {opts?.description && (
                <Dialog.Description className="mt-1.5 text-xs text-secondary leading-relaxed">
                  {opts.description}
                </Dialog.Description>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4">
              <button
                type="button"
                onClick={() => handleResolve(false)}
                className={cn(
                  "px-3 py-1.5 rounded-[var(--radius-control,6px)] text-xs",
                  "bg-control text-label hover:bg-hover active:bg-pressed transition-colors",
                  "border border-separator",
                )}
              >
                {opts?.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={() => handleResolve(true)}
                className={cn(
                  "px-3 py-1.5 rounded-[var(--radius-control,6px)] text-xs font-medium",
                  "transition-colors",
                  opts?.destructive
                    ? "bg-destructive text-inverse hover:opacity-90 active:opacity-80"
                    : "bg-accent text-inverse hover:bg-accent-hover active:opacity-80",
                )}
              >
                {opts?.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  );
}
