import { memo } from "react";
import { type CellValue, getEnumBadgeClass } from "../table-viewer/types";
import { cn } from "../../lib/utils";

function cellValuesEqual(a: CellValue, b: CellValue): boolean {
  if (a.t !== b.t) return false;
  if (a.t === "truncated" && b.t === "truncated") {
    return (
      a.v.value === b.v.value &&
      a.v.truncated === b.v.truncated &&
      a.v.originalBytes === b.v.originalBytes
    );
  }
  if (a.t === "json" && b.t === "json") {
    return JSON.stringify(a.v) === JSON.stringify(b.v);
  }
  if (a.t === "null") return true;
  // bool / int / float / text / other all carry a primitive `v`
  return (a as { v?: unknown }).v === (b as { v?: unknown }).v;
}

function CellRendererImpl({ cell, isEnum = false }: { cell: CellValue; isEnum?: boolean }) {
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

  if (cell.t === "truncated") {
    const preview = cell.v.value.length > 300 ? cell.v.value.slice(0, 300) : cell.v.value;
    return (
      <span
        className="font-mono text-xs text-label truncate block"
        title={`Value truncated — showing ${cell.v.value.length} of ${cell.v.originalBytes} bytes`}
      >
        {preview}
        <span className="ml-1 text-tertiary">… (truncated)</span>
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
          "inline-flex shrink-0 items-center text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-control)] leading-none max-w-full font-mono",
          getEnumBadgeClass(raw),
        )}
        title={raw}
      >
        <span className="relative -top-px truncate">{raw}</span>
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

type CellRendererProps = { cell: CellValue; isEnum?: boolean };

export function cellRendererPropsAreEqual(prev: CellRendererProps, next: CellRendererProps): boolean {
  return prev.isEnum === next.isEnum && cellValuesEqual(prev.cell, next.cell);
}

export const CellRenderer = memo(CellRendererImpl, cellRendererPropsAreEqual);
