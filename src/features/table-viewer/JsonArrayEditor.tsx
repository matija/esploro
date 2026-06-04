import { useState, useEffect, useMemo, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "../../lib/utils";

export function JsonArrayEditor({
  kind,
  anchorEl,
  initialValue,
  onCommit,
  onCancel,
}: {
  kind: "json" | "array";
  anchorEl: Element | null;
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  const virtualRef = useRef({ getBoundingClientRect: () => anchorEl?.getBoundingClientRect() ?? new DOMRect() });
  useEffect(() => {
    virtualRef.current = { getBoundingClientRect: () => anchorEl?.getBoundingClientRect() ?? new DOMRect() };
  }, [anchorEl]);

  const validation = useMemo((): { ok: boolean; msg: string } => {
    if (draft.toLowerCase() === "null") return { ok: true, msg: "" };
    try {
      const parsed = JSON.parse(draft);
      if (kind === "array" && !Array.isArray(parsed)) {
        return { ok: false, msg: "Expected a JSON array" };
      }
      const count = kind === "array" && Array.isArray(parsed) ? ` — ${parsed.length} elements` : "";
      return { ok: true, msg: count };
    } catch (e) {
      return { ok: false, msg: e instanceof SyntaxError ? e.message : String(e) };
    }
  }, [draft, kind]);

  const format = () => {
    if (validation.ok && draft.toLowerCase() !== "null") {
      try {
        setDraft(JSON.stringify(JSON.parse(draft), null, 2));
      } catch { /* ignore */ }
    }
  };

  const commit = () => {
    if (!validation.ok) return;
    onCommit(draft);
  };

  return (
    <Popover.Root open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <Popover.Anchor virtualRef={virtualRef} />
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={2}
          onEscapeKeyDown={onCancel}
          onInteractOutside={commit}
          className="z-50 w-80 rounded-[var(--radius-popover)] border-2 border-[var(--ds-warning)] bg-raised shadow-[var(--shadow-popover)] flex flex-col gap-2 p-2"
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onCancel(); }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); commit(); }
            }}
            className="w-full font-mono text-xs text-label bg-control rounded-[var(--radius-control)] border border-separator p-2 resize-none outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            style={{ minHeight: 80, maxHeight: 240 }}
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex-1 text-[10px] font-mono truncate",
                validation.ok ? "text-success" : "text-query-failed",
              )}
            >
              {validation.ok ? `Valid${validation.msg}` : `Invalid: ${validation.msg}`}
            </span>
            <button
              onClick={format}
              disabled={!validation.ok || draft.toLowerCase() === "null"}
              className="px-2 py-0.5 rounded text-[10px] text-secondary hover:text-label hover:bg-control disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Format
            </button>
            <button
              onClick={commit}
              disabled={!validation.ok}
              className="px-2 py-0.5 rounded text-[10px] bg-accent text-inverse disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
            >
              OK
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
