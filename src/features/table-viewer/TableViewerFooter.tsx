import type { TableQueryResult } from "./types";

function formatStatus({
  data,
  totalCount,
  isEstimate,
}: {
  data: TableQueryResult | undefined;
  totalCount: number | null;
  isEstimate: boolean;
}): string {
  if (!data) return "";
  if (totalCount === 0) return "No rows";

  const start = data.page * data.pageSize + 1;
  const end = data.page * data.pageSize + data.rows.length;

  if (totalCount === null) {
    return `Showing ${start.toLocaleString()}–${end.toLocaleString()} rows`;
  }

  const formattedTotal = totalCount.toLocaleString();
  const totalLabel = isEstimate ? `~${formattedTotal}` : formattedTotal;
  return `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${totalLabel} rows`;
}

export function TableViewerFooter({
  data,
  totalCount,
  isEstimate,
  hasPrev,
  hasNext,
  onPreviousPage,
  onNextPage,
}: {
  data: TableQueryResult | undefined;
  totalCount: number | null;
  isEstimate: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-separator bg-sidebar/50 text-xs text-secondary">
      <span>
        {formatStatus({ data, totalCount, isEstimate })}
        {data && data.executionMs > 0 && (
          <span className="ml-2 text-secondary/60">{data.executionMs} ms</span>
        )}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={onPreviousPage}
          disabled={!hasPrev}
          className="px-2 py-0.5 rounded hover:bg-control disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <button
          onClick={onNextPage}
          disabled={!hasNext}
          className="px-2 py-0.5 rounded hover:bg-control disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
