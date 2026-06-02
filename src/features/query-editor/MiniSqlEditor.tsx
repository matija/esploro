import { useEffect, useRef, useMemo } from "react";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { EditorState, StateEffect, type Transaction } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { sql, type SQLConfig } from "@codemirror/lang-sql";
import { tairikiTheme } from "./tairikiTheme";

interface MiniSqlEditorProps {
  value: string;
  onChange: (v: string) => void;
  onApply: (v: string) => void;
  onClear: () => void;
  schemaCompletions?: SQLConfig["schema"];
  placeholder?: string;
}

// Strips any inserted newlines so the editor stays single-line: pressing Enter
// no longer inserts a line break (Enter is captured by the keymap below to
// trigger onApply instead).
const singleLineFilter = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.docChanged) return tr;
  if (!tr.newDoc.toString().includes("\n")) return tr;
  const stripped: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    stripped.push({ from: fromA, to: toA, insert: inserted.toString().replace(/\n/g, "") });
  });
  return { changes: stripped, scrollIntoView: true };
});

// A stripped-down single-line CodeMirror used for the table viewer WHERE bar:
// no line numbers, fold gutter, or lint; quotes auto-close; column names
// autocomplete from the provided schema. Enter applies, Escape (or emptying a
// non-empty input) clears.
export function MiniSqlEditor({
  value,
  onChange,
  onApply,
  onClear,
  schemaCompletions,
  placeholder,
}: MiniSqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onApplyRef = useRef(onApply);
  const onClearRef = useRef(onClear);
  const wasNonEmptyRef = useRef(value.trim().length > 0);
  onChangeRef.current = onChange;
  onApplyRef.current = onApply;
  onClearRef.current = onClear;

  const extensions = useMemo(
    () => [
      history(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      singleLineFilter,
      sql({ schema: schemaCompletions }),
      tairikiTheme,
      placeholder ? placeholderExt(placeholder) : [],
      keymap.of([
        {
          key: "Enter",
          run: (view) => {
            onApplyRef.current(view.state.doc.toString());
            return true;
          },
        },
        {
          key: "Escape",
          run: () => {
            onClearRef.current();
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const next = update.state.doc.toString();
          onChangeRef.current(next);
          const nextNonEmpty = next.trim().length > 0;
          if (wasNonEmptyRef.current && !nextNonEmpty) {
            onClearRef.current();
          }
          wasNonEmptyRef.current = nextNonEmpty;
        }
      }),
    ],
    [schemaCompletions, placeholder],
  );

  // Mount once
  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconfigure when schema/placeholder change
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({ effects: StateEffect.reconfigure.of(extensions) });
  }, [extensions]);

  // Sync external value changes (e.g. clearing via the chip ×)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
      wasNonEmptyRef.current = value.trim().length > 0;
    }
  }, [value]);

  return <div ref={containerRef} className="cm-mini-host w-full" />;
}
