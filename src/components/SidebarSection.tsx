import { useId, useState } from "react";
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
  const contentId = useId();

  return (
    <div className="mb-4">
      <div className="flex items-center px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={contentId}
          className={cn(
            "flex flex-1 items-center gap-1",
            "text-[12px] font-medium text-secondary",
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
        id={contentId}
        inert={!open}
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
