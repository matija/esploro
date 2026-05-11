import { invoke } from "@tauri-apps/api/core";
import { RotateCcw } from "lucide-react";
import { useAppStore } from "../../store";
import { useConfirm } from "../../components/ConfirmDialog";
import {
  applyUiPreferencesToDocument,
  cacheUiPreferencesForBootstrap,
  defaultUiPreferences,
} from "./preferences";

export function AdvancedSettings() {
  const { hydrateTheme, hydrateEditorAndGridPrefs } = useAppStore();
  const confirm = useConfirm();

  async function handleResetAll() {
    const ok = await confirm({
      title: "Reset all preferences?",
      description: "Theme, fonts, editor behaviour, and grid settings will all return to their factory defaults. This cannot be undone.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    applyUiPreferencesToDocument(defaultUiPreferences);
    cacheUiPreferencesForBootstrap(defaultUiPreferences);
    hydrateTheme(defaultUiPreferences.ui.theme);
    hydrateEditorAndGridPrefs(
      defaultUiPreferences.editor.tabSize,
      defaultUiPreferences.editor.wordWrap,
      defaultUiPreferences.grid.rowDensity,
      defaultUiPreferences.grid.pageSize,
      defaultUiPreferences.grid.showTotalCount,
    );
    try {
      await invoke("set_ui_preferences", { preferences: defaultUiPreferences });
    } catch (error) {
      console.error("Failed to reset preferences:", error);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h3 className="text-[11px] font-medium text-secondary uppercase mb-1">
          Advanced
        </h3>
        <p className="text-[12px] text-tertiary">
          Maintenance and diagnostic options.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4 rounded-[var(--radius-panel)] border border-separator bg-sidebar p-4">
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-label">Reset all preferences</p>
            <p className="text-[12px] text-tertiary leading-relaxed">
              Restores theme, fonts, editor behaviour, and grid settings to
              their factory defaults.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleResetAll()}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-separator bg-content px-2.5 text-[12px] text-secondary shadow-[var(--shadow-hairline)] transition-colors duration-[var(--motion-fast)] hover:border-destructive hover:text-destructive active:bg-destructive/8"
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}
