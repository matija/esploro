import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useAppStore } from "../store";
import { SidebarSection } from "./SidebarSection";
import { ConnectionForm, ConnectionList } from "../features/connections";
import { connectionsApi } from "../features/connections";
import type { ConnectionProfile } from "../features/connections";
import { cn } from "../lib/utils";

export function Sidebar() {
  const {
    sidebarWidth,
    setSidebarWidth,
    profiles,
    setProfiles,
    pendingNewConnection,
    setPendingNewConnection,
  } = useAppStore();
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | undefined>();

  async function loadProfiles() {
    try {
      const data = await connectionsApi.list();
      setProfiles(data);
    } catch (e) {
      console.error("Failed to load connections", e);
    }
  }

  useEffect(() => {
    loadProfiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pendingNewConnection) {
      setPendingNewConnection(false);
      openCreate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewConnection]);

  function openCreate() {
    setEditingProfile(undefined);
    setFormOpen(true);
  }

  function openEdit(profile: ConnectionProfile) {
    setEditingProfile(profile);
    setFormOpen(true);
  }

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
    <>
      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          "relative flex flex-col h-full shrink-0",
          "bg-sidebar backdrop-blur-xl",
          "border-r border-separator",
        )}
      >
        <div className="flex-1 overflow-y-auto pt-2 pb-4">
          <SidebarSection
            title="Connections"
            action={
              <button
                onClick={openCreate}
                title="New connection"
                className="p-0.5 rounded text-secondary hover:text-label hover:bg-control transition-colors"
              >
                <Plus size={12} />
              </button>
            }
          >
            <ConnectionList
              profiles={profiles}
              onEdit={openEdit}
              onRefresh={loadProfiles}
            />
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

      <ConnectionForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        profile={editingProfile}
        onSaved={loadProfiles}
      />
    </>
  );
}
