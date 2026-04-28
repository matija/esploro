import { useEffect, useRef, useMemo } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState, StateEffect } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { lintKeymap, setDiagnostics } from "@codemirror/lint";
import { sql, type SQLConfig } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import type { QueryError } from "./types";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: (sql: string) => void;
  error: QueryError | null;
  schemaCompletions?: SQLConfig["schema"];
  isDark?: boolean;
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  error,
  schemaCompletions,
  isDark,
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onRunRef = useRef(onRun);
  const onChangeRef = useRef(onChange);
  onRunRef.current = onRun;
  onChangeRef.current = onChange;

  const extensions = useMemo(
    () => [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      history(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      sql({ schema: schemaCompletions }),
      ...(isDark ? [oneDark] : []),
      EditorView.theme({
        "&": { fontFamily: "var(--font-mono, ui-monospace)", fontSize: "13px" },
        ".cm-content": { padding: "12px 0" },
        ".cm-gutters": { border: "none" },
      }),
      keymap.of([
        {
          key: "Mod-Enter",
          run: (view) => {
            onRunRef.current(view.state.doc.toString());
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...lintKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ],
    [isDark, schemaCompletions],
  );

  // Mount the editor once
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally mount-only; value/extensions synced by subsequent effects

  // Reconfigure extensions when they change (dark mode / schema completions)
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: StateEffect.reconfigure.of(extensions),
    });
  }, [extensions]);

  // Sync external value changes into the editor (e.g. opening a saved query)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Show/clear error diagnostics
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (error?.position != null) {
      const pos = Math.min(error.position, view.state.doc.length);
      view.dispatch(
        setDiagnostics(view.state, [
          {
            from: pos,
            to: Math.min(pos + 1, view.state.doc.length),
            severity: "error",
            message: error.message,
          },
        ]),
      );
    } else {
      view.dispatch(setDiagnostics(view.state, []));
    }
  }, [error]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-auto cm-host"
    />
  );
}

