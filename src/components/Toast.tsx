import {
  useState,
  useCallback,
  useMemo,
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "../lib/utils";

type ToastVariant = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const ICONS: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 size={14} />,
  error: <AlertCircle size={14} />,
  warning: <AlertTriangle size={14} />,
  info: <Info size={14} />,
};

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success:
    "bg-query-succeeded/10 border-query-succeeded/30 text-query-succeeded",
  error: "bg-query-failed/10 border-query-failed/30 text-query-failed",
  warning:
    "bg-state-warning/10 border-state-warning/30 text-state-warning",
  info: "bg-accent/10 border-accent/30 text-accent",
};

function ToastItem({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3200);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={cn(
        "flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-control)] border shadow-[var(--shadow-popover)]",
        "text-xs leading-snug max-w-[360px] pointer-events-auto",
        "animate-[toast-enter_160ms_cubic-bezier(0.16,1,0.3,1)_both]",
        VARIANT_STYLES[item.variant],
      )}
    >
      <span className="shrink-0 mt-px">{ICONS[item.variant]}</span>
      <span className="flex-1 min-w-0">{item.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 opacity-50 hover:opacity-100 transition-opacity duration-[var(--motion-fast)]"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const MAX_VISIBLE = 2;

  const toast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = crypto.randomUUID();
    setItems((prev) => {
      const next = [...prev, { id, message, variant }];
      return next.length <= MAX_VISIBLE ? next : next.slice(next.length - MAX_VISIBLE);
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-10 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {items.map((item) => (
          <ToastItem key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
