import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useAppStore } from "../store";
import { SidebarSection } from "./SidebarSection";
import { ConnectionForm, ConnectionList } from "../features/connections";
import { connectionsApi } from "../features/connections";
import type { ConnectionProfile } from "../features/connections";
import { SchemaTree } from "../features/schema";
import { SavedQueriesSection } from "../features/query-editor";
import { RecentObjectsSection } from "../features/sidebar/RecentObjectsSection";
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
  const [initialConnectionUrl, setInitialConnectionUrl] = useState<string | undefined>();

  const openCreate = useCallback(() => {
    setEditingProfile(undefined);
    setInitialConnectionUrl(undefined);
    setFormOpen(true);
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const data = await connectionsApi.list();
      setProfiles(data);
    } catch (e) {
      console.error("Failed to load connections", e);
    }
  }, [setProfiles]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  // When pendingNewConnection transitions true, open the create form.
  // Adjust state during render (with a prevRef guard) instead of in an
  // effect to avoid the stale intermediate render.
  const prevPendingRef = useRef(pendingNewConnection);
  if (pendingNewConnection && !prevPendingRef.current) {
    setPendingNewConnection(false);
    setEditingProfile(undefined);
    setInitialConnectionUrl(undefined);
    setFormOpen(true);
  }
  prevPendingRef.current = pendingNewConnection;

  function openEdit(profile: ConnectionProfile) {
    setEditingProfile(profile);
    setInitialConnectionUrl(undefined);
    setFormOpen(true);
  }

  async function openCreateFromClipboard() {
    setEditingProfile(undefined);
    try {
      setInitialConnectionUrl(await navigator.clipboard.readText());
    } catch (e) {
      console.error("Failed to read connection URL from clipboard", e);
      setInitialConnectionUrl(undefined);
    }
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

  const onResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = 10;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSidebarWidth(sidebarWidth - step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSidebarWidth(sidebarWidth + step);
      }
    },
    [sidebarWidth, setSidebarWidth],
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
        {/* No drag region here — the 38px title bar in AppShell handles window
         * dragging. Marking the scrollable body as a drag region steals
         * scrollbar drags (Tauri intercepts them as window drags). */}
        <div className="flex-1 overflow-y-auto pt-2 pb-4">
          <SidebarSection
            title="Connections"
            action={
              <button
                type="button"
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
              onNewConnection={openCreate}
              onPasteConnectionUrl={openCreateFromClipboard}
              renderExpansion={(connectionId, sessionId) => (
                <SchemaTree sessionId={sessionId} connectionId={connectionId} />
              )}
            />
          </SidebarSection>

          <SidebarSection title="Saved Queries">
            <SavedQueriesSection />
          </SidebarSection>

          <SidebarSection title="Recent">
            <RecentObjectsSection />
          </SidebarSection>
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={onMouseDown}
          onKeyDown={onResizeKeyDown}
          tabIndex={0}
          role="separator"
          aria-label="Sidebar resize handle"
          aria-valuenow={sidebarWidth}
          aria-valuemin={180}
          aria-valuemax={320}
          className={cn(
            "absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-10",
            "transition-colors duration-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-inset",
            isResizing ? "bg-accent/40" : "hover:bg-accent/20",
          )}
        />
      </aside>

      <ConnectionForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        profile={editingProfile}
        initialUrl={initialConnectionUrl}
        onSaved={loadProfiles}
      />
    </>
  );
}
