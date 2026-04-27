import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import { SidebarSection } from "./SidebarSection";
import { cn } from "../lib/utils";

export function Sidebar() {
  const { sidebarWidth, setSidebarWidth } = useAppStore();
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = sidebarWidth;
      setIsResizing(true);
    },
    [sidebarWidth],
  );

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      setSidebarWidth(startWidthRef.current + delta);
    };
    const onMouseUp = () => setIsResizing(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <aside
      style={{ width: sidebarWidth }}
      className={cn(
        "relative flex flex-col h-full shrink-0",
        "bg-sidebar backdrop-blur-xl",
        "border-r border-separator",
      )}
    >
      {/* Connections section */}
      <div className="flex-1 overflow-y-auto pt-2 pb-4">
        <SidebarSection title="Connections">
          <div className="px-3 py-2 text-sm text-secondary">
            No connections yet
          </div>
        </SidebarSection>

        <SidebarSection title="Saved Queries">
          <div className="px-3 py-2 text-sm text-secondary">
            No saved queries
          </div>
        </SidebarSection>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className={cn(
          "absolute top-0 right-0 w-1 h-full cursor-col-resize z-10",
          isResizing && "bg-accent/30",
        )}
      />
    </aside>
  );
}
