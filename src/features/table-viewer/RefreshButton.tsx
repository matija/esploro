import { useState, useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";

export function RefreshButton({
  dataUpdatedAt,
  isFetching,
  isLoading,
  onRefresh,
}: {
  dataUpdatedAt: number;
  isFetching: boolean;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const shouldTick = dataUpdatedAt > 0 && !isFetching;
  const prevShouldTick = useRef(shouldTick);

  // Reset the clock in render when transitioning to the "ticking" state.
  // Doing this during render avoids the extra stale intermediate render
  // that a useEffect-based approach would cause.
  if (shouldTick && !prevShouldTick.current) {
    setNow(Date.now());
  }
  prevShouldTick.current = shouldTick;

  useEffect(() => {
    if (!shouldTick) return;
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, [shouldTick]);

  const ageMs = dataUpdatedAt > 0 ? now - dataUpdatedAt : null;
  const isStale = ageMs !== null && ageMs > 30_000;
  const ageLabel = ageMs === null || isFetching
    ? null
    : ageMs < 60_000
      ? `${Math.floor(ageMs / 1000)}s ago`
      : `${Math.floor(ageMs / 60_000)}m ago`;

  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isLoading || isFetching}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors shrink-0",
        isStale
          ? "text-label bg-control hover:bg-subtle active:bg-subtle"
          : "text-secondary hover:bg-control hover:text-label active:bg-subtle",
        "disabled:opacity-40 disabled:cursor-not-allowed",
      )}
      title="Refresh table data (⌘R)"
    >
      <RefreshCw
        size={12}
        className={cn(isFetching && !isLoading && "animate-spin")}
      />
      {ageLabel ? <span>{ageLabel}</span> : <span>Refresh</span>}
    </button>
  );
}
