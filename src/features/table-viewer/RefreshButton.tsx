import { RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";

export function RefreshButton({ dataUpdatedAt, isFetching, isLoading, onRefresh }: {
  dataUpdatedAt: number;
  isFetching: boolean;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const updatedAt = dataUpdatedAt > 0 ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isLoading || isFetching}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-secondary transition-colors hover:bg-hover hover:text-label disabled:opacity-40"
      aria-label="Refresh table data"
      title={`Refresh table data (⌘R)${updatedAt ? ` · Updated at ${updatedAt}` : ""}`}
    >
      <RefreshCw size={13} className={cn(isFetching && !isLoading && "animate-spin")} />
    </button>
  );
}
