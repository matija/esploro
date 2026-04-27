import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

interface SidebarSectionProps {
  title: string;
  children?: React.ReactNode;
  defaultOpen?: boolean;
}

export function SidebarSection({
  title,
  children,
  defaultOpen = true,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-1 px-3 py-1",
          "text-xs font-semibold uppercase tracking-wide text-secondary",
          "hover:text-label transition-colors",
          "select-none",
        )}
      >
        <ChevronRight
          size={12}
          className={cn("transition-transform", open && "rotate-90")}
        />
        {title}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
