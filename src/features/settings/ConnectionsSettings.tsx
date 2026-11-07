import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { useAppStore } from "../../store";
import { ConnectionList } from "../connections/ConnectionList";
import { ConnectionForm } from "../connections/ConnectionForm";
import { connectionsApi } from "../connections/api";
import type { ConnectionProfile } from "../connections/types";
import { SettingsSection } from "./SettingsSection";

export function ConnectionsSettings() {
  const { profiles, setProfiles, setPendingNewConnection } = useAppStore();
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile>();
  const loadProfiles = useCallback(async () => {
    setProfiles(await connectionsApi.list());
  }, [setProfiles]);

  return (
    <SettingsSection title="Connections" action={
      <button
        type="button"
        onClick={() => setPendingNewConnection(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] bg-control px-2.5 text-secondary shadow-[var(--shadow-hairline)] transition-colors hover:bg-hover hover:text-label"
      >
        <Plus size={13} aria-hidden />
        New connection
      </button>
    }>
      {profiles.length > 0 ? (
        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-separator py-1">
          <ConnectionList profiles={profiles} onEdit={setEditingProfile} onRefresh={loadProfiles} />
        </div>
      ) : (
        <p className="text-tertiary">No connections</p>
      )}
      <ConnectionForm
        open={!!editingProfile}
        profile={editingProfile}
        onClose={() => setEditingProfile(undefined)}
        onSaved={loadProfiles}
      />
    </SettingsSection>
  );
}
