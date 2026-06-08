import { useEffect, useRef, useMemo } from "react";
// SqlEditor is lazy-loaded by QueryEditorTab; the bundler code-splits CodeMirror out of the initial bundle.
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from "@codemirror/view";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import
import { EditorState, StateEffect } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentUnit } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { lintKeymap, setDiagnostics } from "@codemirror/lint";
import { sql, type SQLConfig } from "@codemirror/lang-sql";
import { useShallow } from "zustand/react/shallow";
import { tairikiTheme } from "./tairikiTheme";
import type { QueryError } from "./types";
import { useAppStore } from "../../store";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: (sql: string) => void;
  error: QueryError | null;
  schemaCompletions?: SQLConfig["schema"];
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  error,
  schemaCompletions,
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onRunRef = useRef(onRun);
  const onChangeRef = useRef(onChange);
  onRunRef.current = onRun;
  onChangeRef.current = onChange;

  const { editorTabSize, editorWordWrap } = useAppStore(
    useShallow((state) => ({
      editorTabSize: state.editorTabSize,
      editorWordWrap: state.editorWordWrap,
    })),
  );

  const extensions = useMemo(
    () => [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      history(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      indentUnit.of(" ".repeat(editorTabSize)),
      ...(editorWordWrap ? [EditorView.lineWrapping] : []),
      sql({ schema: schemaCompletions }),
      tairikiTheme,
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
    [schemaCompletions, editorTabSize, editorWordWrap],
  );

  // Mount the editor once (extension changes synced by the dedicated reconfigure effect below).
  // Initial doc/extensions are read through refs so this effect can have empty deps: re-running
  // it would destroy the view on cleanup without recreating it, leaving the editor non-editable
  // once `extensions` changes (e.g. schema completions load or editor settings change).
  const initialValueRef = useRef(value);
  const extensionsRef = useRef(extensions);
  extensionsRef.current = extensions;
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: extensionsRef.current,
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Reconfigure extensions when they change (dark mode / schema completions)
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: StateEffect.reconfigure.of(extensions),
    });
  }, [extensions]);

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
