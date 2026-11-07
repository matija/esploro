import type { ReactNode } from "react";
import { KeyRound, Link } from "lucide-react";
import type { ResultColumn } from "../table-viewer/types";

export function ColumnLabel({ col, children }: { col: ResultColumn; children?: ReactNode }) {
  const description = [
    col.dataType,
    col.isPrimaryKey && "Primary key",
    col.isForeignKey && "Foreign key",
    col.isNullable ? "Nullable" : "Not null",
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden" title={`${col.name}\n${description}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        {col.isPrimaryKey && <KeyRound size={10} className="shrink-0 text-schema-key" aria-label="Primary key" />}
        {col.isForeignKey && !col.isPrimaryKey && <Link size={10} className="shrink-0 text-schema-foreign-key" aria-label="Foreign key" />}
        <span className="min-w-0 truncate text-xs font-medium text-label" title={col.name}>{col.name}</span>
        {children}
      </div>
      <span className="block truncate font-mono text-[10px] leading-tight text-secondary" title={description}>
        {col.dataType}
      </span>
    </div>
  );
}
