import { Code2, WrapText } from "lucide-react";
import { useAppStore } from "../../store";
import { cn } from "../../lib/utils";
import { editorTabSizeValues, type EditorTabSize } from "./preferences";

const TAB_SIZE_LABELS: Record<EditorTabSize, string> = {
  2: "2",
  4: "4",
  8: "8",
};

export function EditorSettings() {
  const { editorTabSize, setEditorTabSize, editorWordWrap, setEditorWordWrap } =
    useAppStore();

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h3 className="text-[12px] font-medium text-secondary uppercase mb-1">
          Editor
        </h3>
        <p className="text-[13px] text-tertiary">
          Behaviour settings for the SQL query editor.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-secondary">
          <span className="text-accent">
            <Code2 size={13} />
          </span>
          Tab size
        </div>
        <div className="flex w-fit gap-1 rounded-[var(--radius-control)] bg-control p-1 shadow-[var(--shadow-hairline)]">
          {editorTabSizeValues.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setEditorTabSize(size)}
              className={cn(
                "h-7 w-10 rounded-[var(--radius-control)] text-[13px]",
                "transition-colors duration-[var(--motion-fast)]",
                editorTabSize === size
                  ? "bg-content text-label shadow-sm font-medium"
                  : "text-secondary hover:bg-subtle hover:text-label active:bg-active",
              )}
            >
              {TAB_SIZE_LABELS[size]}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-tertiary">
          Width of a tab character and the indent inserted when you press Tab.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-secondary">
            <span className="text-accent">
              <WrapText size={13} />
            </span>
            Word wrap
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={editorWordWrap}
            onClick={() => setEditorWordWrap(!editorWordWrap)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-default rounded-full border-2 border-transparent",
              "transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
              editorWordWrap ? "bg-accent" : "bg-control shadow-[var(--shadow-hairline)]",
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm",
                "transition-transform duration-[var(--motion-fast)]",
                editorWordWrap ? "translate-x-4" : "translate-x-0",
              )}
            />
          </button>
        </div>
        <p className="text-[12px] text-tertiary">
          Wrap long lines at the editor boundary instead of scrolling
          horizontally.
        </p>
      </div>
    </section>
  );
}
