import { type CellValue, getEnumBadgeClass } from "../table-viewer/types";
import { cn } from "../../lib/utils";

export function CellRenderer({ cell, isEnum = false }: { cell: CellValue; isEnum?: boolean }) {
  if (cell.t === "null") {
    return (
      <span className="inline-flex shrink-0 font-mono text-[9px] font-medium px-1.5 py-px rounded bg-control text-tertiary leading-none tracking-widest border border-separator/50">
        NULL
      </span>
    );
  }

  if (cell.t === "bool") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 font-mono text-[9px] font-semibold px-1.5 py-px rounded bg-control border border-separator/50 leading-none tracking-wide",
          cell.v ? "text-label" : "text-tertiary",
        )}
      >
        {cell.v ? "true" : "false"}
      </span>
    );
  }

  if (cell.t === "int" || cell.t === "float") {
    return (
      <span className="font-mono text-xs text-label tabular-nums truncate block text-right w-full">
        {String(cell.v)}
      </span>
    );
  }

  if (cell.t === "json") {
    const raw = JSON.stringify(cell.v);
    const preview = raw.length > 100 ? raw.slice(0, 100) + "…" : raw;
    return (
      <span className="font-mono text-[12px] text-secondary truncate block" title={raw}>
        {preview}
      </span>
    );
  }

  // text / other
  const raw = cell.v;
  if (raw === "") {
    return (
      <span className="inline-flex shrink-0 font-mono text-[9px] font-medium px-1.5 py-px rounded bg-control text-tertiary leading-none italic border border-separator/50">
        {"''"}
      </span>
    );
  }

  if (isEnum) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center text-[11px] font-medium px-2 py-0.5 rounded-full leading-none max-w-full font-mono",
          getEnumBadgeClass(raw),
        )}
        title={raw}
      >
        <span className="truncate">{raw}</span>
      </span>
    );
  }

  const display = raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
  return (
    <span
      className="font-mono text-xs text-label truncate block"
      title={raw.length > 300 ? raw : undefined}
    >
      {display}
    </span>
  );
}
