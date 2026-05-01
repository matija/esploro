import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

interface SidebarSectionProps {
  title: string;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}

export function SidebarSection({
  title,
  children,
  defaultOpen = true,
  action,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <div className="flex items-center px-3 py-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex flex-1 items-center gap-1",
            "text-xs font-semibold uppercase tracking-wide text-secondary",
            "hover:text-label transition-colors select-none",
          )}
        >
          <ChevronRight
            size={12}
            className={cn(
              "transition-transform duration-[var(--motion-base)] ease-out",
              open && "rotate-90",
            )}
          />
          {title}
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {/* CSS grid row trick: animates from 0fr → 1fr for smooth disclosure */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 160ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}
