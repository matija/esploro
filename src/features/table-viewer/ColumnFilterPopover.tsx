import { useState, useEffect, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import { ChevronDown as SelectChevron, Check } from "lucide-react";
import {
  type FilterOperator,
  type ResultColumn,
  OP_LABELS,
  getTypeFamily,
  getOperatorsForFamily,
  typeFamilyBadgeClass,
} from "./types";
import { cn } from "../../lib/utils";

export interface FilterEntry {
  operator: FilterOperator;
  value: string;
}

export function ColumnFilterPopover({
  col,
  anchorEl,
  open,
  onOpenChange,
  entry,
  onApply,
}: {
  col: ResultColumn;
  anchorEl: Element | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: FilterEntry | undefined;
  onApply: (entry: FilterEntry | null) => void;
}) {
  const family = getTypeFamily(col.dataType);
  const ops = getOperatorsForFamily(family);
  const [draft, setDraft] = useState<FilterEntry>(
    entry ?? { operator: ops[0], value: "" },
  );

  // Build a stable virtual ref wrapping the live anchor element
  const virtualRef = useRef({ getBoundingClientRect: () => anchorEl?.getBoundingClientRect() ?? new DOMRect() });
  useEffect(() => {
    virtualRef.current = { getBoundingClientRect: () => anchorEl?.getBoundingClientRect() ?? new DOMRect() };
  }, [anchorEl]);

  const noValue = draft.operator === "IsNull" || draft.operator === "IsNotNull";
  const hasExisting = !!entry;

  const apply = () => {
    onApply(draft);
    onOpenChange(false);
  };

  const clear = () => {
    onApply(null);
    onOpenChange(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor virtualRef={virtualRef} />
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          onEscapeKeyDown={() => onOpenChange(false)}
          onInteractOutside={() => onOpenChange(false)}
          className="z-50 w-64 rounded-[var(--radius-popover)] border border-separator bg-raised shadow-[var(--shadow-popover)] p-3 flex flex-col gap-2.5"
        >
          {/* Column name + type badge */}
          <div className="flex items-center gap-2 pb-1 border-b border-separator">
            <span className="text-xs font-semibold text-label truncate flex-1">{col.name}</span>
            <span className={cn("text-[9px] font-mono px-1 py-px rounded shrink-0", typeFamilyBadgeClass(family))}>
              {col.dataType}
            </span>
          </div>

          {/* Operator selector */}
          <Select.Root
            value={draft.operator}
            onValueChange={(v) => setDraft((d) => ({ ...d, operator: v as FilterOperator }))}
          >
            <Select.Trigger className="flex items-center justify-between w-full px-2 py-1.5 rounded-[var(--radius-control)] bg-control border border-separator text-xs text-label hover:bg-hover transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
              <Select.Value />
              <Select.Icon>
                <SelectChevron size={12} className="text-secondary" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content
                position="popper"
                sideOffset={4}
                className="z-[60] min-w-[var(--radix-select-trigger-width)] rounded-[var(--radius-popover)] border border-separator bg-raised shadow-[var(--shadow-popover)] py-1 text-xs"
              >
                <Select.Viewport>
                  {ops.map((op) => (
                    <Select.Item
                      key={op}
                      value={op}
                      className="flex items-center justify-between px-3 py-1.5 text-label hover:bg-hover cursor-default outline-none data-[highlighted]:bg-hover"
                    >
                      <Select.ItemText>{OP_LABELS[op]}</Select.ItemText>
                      <Select.ItemIndicator>
                        <Check size={10} className="text-accent" />
                      </Select.ItemIndicator>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>

          {/* Value input */}
          {!noValue && (
            <input
              aria-label="Filter value"
              type="text"
              value={draft.value}
              onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              placeholder="value…"
              ref={(el) => { el?.focus(); }}
              className="w-full px-2 py-1.5 rounded-[var(--radius-control)] bg-control border border-separator text-xs text-label placeholder:text-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            />
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              onClick={apply}
              className="flex-1 px-2 py-1.5 rounded-[var(--radius-control)] bg-accent text-inverse text-xs font-medium hover:bg-accent-hover transition-colors"
            >
              Apply
            </button>
            {hasExisting && (
              <button
                type="button"
                onClick={clear}
                className="px-2 py-1.5 rounded-[var(--radius-control)] bg-control text-secondary text-xs hover:bg-hover hover:text-destructive transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
