import { useAppStore } from "../../store";
import { cn } from "../../lib/utils";
import { editorTabSizeValues } from "./preferences";
import { SettingsSection, SettingSwitch } from "./SettingsSection";

export function EditorSettings() {
  const { editorTabSize, setEditorTabSize, editorWordWrap, setEditorWordWrap } = useAppStore();

  return (
    <SettingsSection title="Editor">
      <div className="flex items-center justify-between gap-4">
        <span id="tab-size-label" className="text-label">Tab size</span>
        <div role="group" aria-labelledby="tab-size-label" className="flex gap-1 rounded-[var(--radius-control)] bg-control p-1 shadow-[var(--shadow-hairline)]">
          {editorTabSizeValues.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={editorTabSize === size}
              onClick={() => setEditorTabSize(size)}
              className={cn(
                "h-7 w-10 rounded-[var(--radius-control)] transition-colors duration-[var(--motion-fast)]",
                editorTabSize === size
                  ? "bg-content text-label shadow-sm font-medium"
                  : "text-secondary hover:bg-subtle hover:text-label active:bg-active",
              )}
            >
              {size}
            </button>
          ))}
        </div>
      </div>
      <SettingSwitch label="Word wrap" checked={editorWordWrap} onChange={setEditorWordWrap} />
    </SettingsSection>
  );
}
