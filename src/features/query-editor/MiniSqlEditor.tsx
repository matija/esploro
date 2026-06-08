import { useCallback, useEffect, useImperativeHandle, useRef, useMemo, type Ref } from "react";
// MiniSqlEditor is lazy-loaded by TableViewerTab; the bundler code-splits CodeMirror out of the initial bundle.
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import
import { Decoration, EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import
import { EditorState, StateEffect, type Transaction } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import {
  acceptCompletion,
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { sql, type SQLConfig } from "@codemirror/lang-sql";
import { tairikiTheme } from "./tairikiTheme";

const SQL_SPECIAL_CHARS = new Set(["'", '"', "`", "=", ">", "<", "(", ")"]);

type SqlDriver = "postgres" | "mysql";

interface WhereColumn {
  name: string;
  dataType?: string;
}

interface MiniSqlEditorProps {
  value: string;
  onChange: (v: string) => void;
  onApply: (v: string) => void;
  onClear: () => void;
  schemaCompletions?: SQLConfig["schema"];
  whereColumns?: readonly WhereColumn[];
  sqlDriver?: SqlDriver;
  placeholder?: string;
}

export interface MiniSqlEditorHandle {
  apply: () => void;
  getNormalizedValue: () => string;
}

const SQL_RESERVED_WORDS = new Set([
  "all",
  "and",
  "as",
  "asc",
  "between",
  "by",
  "case",
  "desc",
  "distinct",
  "else",
  "end",
  "false",
  "from",
  "group",
  "having",
  "in",
  "is",
  "like",
  "limit",
  "not",
  "null",
  "or",
  "order",
  "select",
  "then",
  "true",
  "when",
  "where",
]);

const NUMERIC_TYPES = new Set([
  "int",
  "int2",
  "int4",
  "int8",
  "integer",
  "bigint",
  "smallint",
  "tinyint",
  "mediumint",
  "serial",
  "bigserial",
  "float",
  "float4",
  "float8",
  "double",
  "decimal",
  "numeric",
  "real",
  "money",
]);

const WHERE_OPERATORS = [
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "LIKE",
  "ILIKE",
  "IS NULL",
  "IS NOT NULL",
] as const;

const OPERATOR_PATTERN = /\bIS\s+NOT\s+NULL\b|\bIS\s+NULL\b|!=|<>|>=|<=|=|>|<|\bILIKE\b|\bLIKE\b/gi;

interface OperatorSpan {
  from: number;
  to: number;
  text: string;
}

function isSafeIdentifier(name: string, driver: SqlDriver): boolean {
  const pattern = driver === "mysql"
    ? /^[A-Za-z_][A-Za-z0-9_$]*$/
    : /^[a-z_][a-z0-9_$]*$/;
  return pattern.test(name) && !SQL_RESERVED_WORDS.has(name.toLowerCase());
}

function formatSqlIdentifier(name: string, driver: SqlDriver): string {
  if (isSafeIdentifier(name, driver)) return name;
  if (driver === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function columnTypeBase(dataType: string | undefined): string {
  return (dataType ?? "").toLowerCase().replace(/\(.*\)$/, "").trim();
}

function shouldKeepBareValue(value: string, column: WhereColumn | undefined): boolean {
  const lower = value.toLowerCase();
  const baseType = columnTypeBase(column?.dataType);
  if (lower === "null" || lower === "true" || lower === "false") return true;
  if (/^-?\d+(\.\d+)?$/.test(value) && NUMERIC_TYPES.has(baseType)) return true;
  return false;
}

function isInsideSingleQuotedString(text: string): boolean {
  let inside = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "'") continue;
    if (inside && text[i + 1] === "'") {
      i++;
      continue;
    }
    inside = !inside;
  }
  return inside;
}

function expectsColumnCompletion(prefix: string): boolean {
  const trimmed = prefix.trimEnd();
  if (trimmed === "") return true;
  return /\(\s*$/.test(trimmed) || /(^|[\s(])(and|or|where)\s*$/i.test(trimmed);
}

function normalizeOperatorText(text: string): string {
  return text.trim().toUpperCase().replace(/\s+/g, " ");
}

function findOperatorAtPosition(input: string, pos: number): OperatorSpan | null {
  OPERATOR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OPERATOR_PATTERN.exec(input)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (isInsideSingleQuotedString(input.slice(0, from))) continue;
    if (pos >= from && pos <= to) {
      return { from, to, text: match[0] };
    }
  }
  return null;
}

const operatorBadgeMark = Decoration.mark({ class: "cm-where-operator-badge" });

const whereOperatorBadges = EditorView.decorations.compute(["doc"], (state) => {
  const input = state.doc.toString();
  const ranges = [];
  OPERATOR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OPERATOR_PATTERN.exec(input)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (isInsideSingleQuotedString(input.slice(0, from))) continue;
    ranges.push(operatorBadgeMark.range(from, to));
  }
  return Decoration.set(ranges, true);
});

function isLogicalBoundaryToken(token: SqlToken): boolean {
  if (token.text === ")") return true;
  if (token.kind !== "atom") return false;
  const lower = token.text.toLowerCase();
  return lower === "and" || lower === "or";
}

function findFollowingValueRange(input: string, operatorEnd: number): { from: number; to: number } | null {
  const afterOperator = input.slice(operatorEnd);
  const tokens = tokenizeWhereClause(afterOperator);
  const valueIndex = nextMeaningfulToken(tokens, 0);
  if (valueIndex === null) return null;

  const valueToken = tokens[valueIndex];
  if (isLogicalBoundaryToken(valueToken)) return null;

  const to = valueToken.to ?? valueToken.text.length;
  const followingIndex = nextMeaningfulToken(tokens, valueIndex + 1);
  if (valueToken.text === "(" && followingIndex !== null) return null;
  if (followingIndex !== null) {
    const following = tokens[followingIndex];
    if (!isLogicalBoundaryToken(following)) return null;
  }

  return { from: operatorEnd, to: operatorEnd + to };
}

function makeWhereOperatorCompletionSource(): CompletionSource {
  return (context: CompletionContext) => {
    if (!context.explicit) return null;

    const input = context.state.doc.toString();
    const span = findOperatorAtPosition(input, context.pos);
    if (!span) return null;

    const currentOperator = normalizeOperatorText(span.text);
    const options: Completion[] = WHERE_OPERATORS.map((operator) => ({
      label: operator,
      type: "keyword",
      detail: operator === currentOperator ? "current" : undefined,
      apply: (view, completion, from, to) => {
        const selectedOperator = completion.label;
        const selectedIsNullCheck = selectedOperator === "IS NULL" || selectedOperator === "IS NOT NULL";
        const currentIsNullCheck = currentOperator === "IS NULL" || currentOperator === "IS NOT NULL";

        if (selectedIsNullCheck) {
          const valueRange = findFollowingValueRange(view.state.doc.toString(), to);
          view.dispatch({
            changes: valueRange
              ? [
                  { from, to, insert: selectedOperator },
                  { from: valueRange.from, to: valueRange.to, insert: "" },
                ]
              : { from, to, insert: selectedOperator },
            selection: { anchor: from + selectedOperator.length },
            scrollIntoView: true,
            userEvent: "input.complete",
          });
          return;
        }

        const insert = currentIsNullCheck ? `${selectedOperator} ''` : selectedOperator;
        const cursor = currentIsNullCheck ? from + insert.length - 1 : from + insert.length;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: cursor },
          scrollIntoView: true,
          userEvent: "input.complete",
        });
      },
    }));

    return { from: span.from, to: span.to, options, filter: false };
  };
}

function makeWhereColumnCompletionSource(
  columns: readonly WhereColumn[],
  driver: SqlDriver,
): CompletionSource {
  return (context: CompletionContext) => {
    const beforeCursor = context.state.sliceDoc(0, context.pos);
    if (isInsideSingleQuotedString(beforeCursor)) return null;

    const token = beforeCursor.match(/["`]?[A-Za-z0-9_$]*$/);
    if (!token) return null;

    const typed = token[0].replace(/^["`]/, "");
    if (!context.explicit && typed.length === 0) return null;

    const from = context.pos - token[0].length;
    if (!expectsColumnCompletion(beforeCursor.slice(0, from))) return null;

    const query = typed.toLowerCase();
    const options: Completion[] = columns
      .filter((column) => {
        if (query === "") return true;
        return column.name.toLowerCase().includes(query);
      })
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(query);
        const bStarts = b.name.toLowerCase().startsWith(query);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((column) => ({
        label: column.name,
        detail: column.dataType,
        type: "property",
        apply: (view, _completion, applyFrom, applyTo) => {
          const insert = `${formatSqlIdentifier(column.name, driver)} = ''`;
          const cursor = applyFrom + insert.length - 1;
          view.dispatch({
            changes: { from: applyFrom, to: applyTo, insert },
            selection: { anchor: cursor },
            scrollIntoView: true,
            userEvent: "input.complete",
          });
        },
      }));

    if (options.length === 0) return null;
    return { from, options, filter: false };
  };
}

type TokenKind =
  | "space"
  | "atom"
  | "singleString"
  | "doubleQuoted"
  | "backtickQuoted"
  | "operator"
  | "paren";

interface SqlToken {
  kind: TokenKind;
  text: string;
  value?: string;
  from?: number;
  to?: number;
}

function readQuoted(input: string, start: number, quote: "'" | "\"" | "`"): SqlToken {
  let i = start + 1;
  let value = "";
  while (i < input.length) {
    const ch = input[i];
    if (ch === quote) {
      if (input[i + 1] === quote) {
        value += quote;
        i += 2;
        continue;
      }
      i++;
      break;
    }
    value += ch;
    i++;
  }
  return {
    kind: quote === "'" ? "singleString" : quote === "\"" ? "doubleQuoted" : "backtickQuoted",
    text: input.slice(start, i),
    value,
    from: start,
    to: i,
  };
}

function tokenizeWhereClause(input: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      let end = i + 1;
      while (end < input.length && /\s/.test(input[end])) end++;
      tokens.push({ kind: "space", text: input.slice(i, end), from: i, to: end });
      i = end;
      continue;
    }
    if (ch === "'" || ch === "\"" || ch === "`") {
      const token = readQuoted(input, i, ch);
      tokens.push(token);
      i += token.text.length;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === "!=" || two === "<>" || two === ">=" || two === "<=") {
      tokens.push({ kind: "operator", text: two, from: i, to: i + 2 });
      i += 2;
      continue;
    }
    if (ch === "=" || ch === ">" || ch === "<") {
      tokens.push({ kind: "operator", text: ch, from: i, to: i + 1 });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", text: ch, from: i, to: i + 1 });
      i++;
      continue;
    }
    let end = i + 1;
    while (
      end < input.length &&
      !/\s/.test(input[end]) &&
      !SQL_SPECIAL_CHARS.has(input[end])
    ) {
      if (input[end] === "!" && input[end + 1] === "=") break;
      end++;
    }
    tokens.push({ kind: "atom", text: input.slice(i, end), value: input.slice(i, end), from: i, to: end });
    i = end;
  }
  return tokens;
}

function nextMeaningfulToken(tokens: readonly SqlToken[], start: number): number | null {
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].kind !== "space") return i;
  }
  return null;
}

function columnNameFromToken(
  token: SqlToken,
  columnByLowerName: ReadonlyMap<string, WhereColumn>,
): WhereColumn | undefined {
  if (token.kind !== "atom" && token.kind !== "doubleQuoted" && token.kind !== "backtickQuoted") {
    return undefined;
  }
  const raw = token.value ?? token.text;
  return columnByLowerName.get(raw.toLowerCase());
}

function isComparisonOperator(token: SqlToken): boolean {
  if (token.kind === "operator") return true;
  if (token.kind !== "atom") return false;
  const lower = token.text.toLowerCase();
  return lower === "like" || lower === "ilike";
}

function normalizeValueToken(
  tokens: SqlToken[],
  valueIndex: number,
  column: WhereColumn | undefined,
  columnByLowerName: ReadonlyMap<string, WhereColumn>,
  driver: SqlDriver,
) {
  const token = tokens[valueIndex];
  const following = nextMeaningfulToken(tokens, valueIndex + 1);
  if (following !== null && tokens[following].text === "(") return;

  if (token.kind === "singleString") return;

  if (token.kind === "doubleQuoted" || token.kind === "backtickQuoted") {
    const content = token.value ?? "";
    const referencedColumn = columnByLowerName.get(content.toLowerCase());
    token.text = referencedColumn
      ? formatSqlIdentifier(referencedColumn.name, driver)
      : quoteSqlString(content);
    return;
  }

  if (token.kind !== "atom") return;
  if (shouldKeepBareValue(token.text, column)) return;
  token.text = quoteSqlString(token.text);
}

function normalizeWhereClause(
  input: string,
  columns: readonly WhereColumn[] | undefined,
  driver: SqlDriver,
): string {
  const withoutWhere = input.trim().replace(/^where\s+/i, "");
  if (!columns || columns.length === 0) return withoutWhere;

  const columnByLowerName = new Map(columns.map((column) => [column.name.toLowerCase(), column]));
  const tokens = tokenizeWhereClause(withoutWhere);

  for (let i = 0; i < tokens.length; i++) {
    const column = columnNameFromToken(tokens[i], columnByLowerName);
    if (!column) continue;

    const operatorIndex = nextMeaningfulToken(tokens, i + 1);
    if (operatorIndex === null || !isComparisonOperator(tokens[operatorIndex])) continue;

    tokens[i].text = formatSqlIdentifier(column.name, driver);

    const valueIndex = nextMeaningfulToken(tokens, operatorIndex + 1);
    if (valueIndex !== null) {
      normalizeValueToken(tokens, valueIndex, column, columnByLowerName, driver);
    }
  }

  return tokens.map((token) => token.text).join("");
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
  whereColumns,
  sqlDriver = "postgres",
  placeholder,
  ref,
}: MiniSqlEditorProps & { ref?: Ref<MiniSqlEditorHandle> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onApplyRef = useRef(onApply);
  const onClearRef = useRef(onClear);
  const wasNonEmptyRef = useRef(value.trim().length > 0);
  onChangeRef.current = onChange;
  onApplyRef.current = onApply;
  onClearRef.current = onClear;

  const operatorCompletionSource = useMemo(() => makeWhereOperatorCompletionSource(), []);

  const whereCompletionSource = useMemo(
    () =>
      whereColumns && whereColumns.length > 0
        ? makeWhereColumnCompletionSource(whereColumns, sqlDriver)
        : null,
    [whereColumns, sqlDriver],
  );

  const getNormalizedValue = useCallback(() => {
    const current = viewRef.current?.state.doc.toString() ?? value;
    return normalizeWhereClause(current, whereColumns, sqlDriver);
  }, [value, whereColumns, sqlDriver]);

  useImperativeHandle(
    ref as React.Ref<MiniSqlEditorHandle>,
    () => ({
      apply: () => onApplyRef.current(getNormalizedValue()),
      getNormalizedValue,
    }),
    [getNormalizedValue],
  );

  const extensions = useMemo(
    () => [
      history(),
      bracketMatching(),
      closeBrackets(),
      whereCompletionSource
        ? autocompletion({
            override: [operatorCompletionSource, whereCompletionSource],
            activateOnTyping: true,
            activateOnTypingDelay: 0,
          })
        : autocompletion({ override: [operatorCompletionSource] }),
      singleLineFilter,
      whereOperatorBadges,
      sql({ schema: schemaCompletions }),
      tairikiTheme,
      placeholder ? placeholderExt(placeholder) : [],
      keymap.of([
        {
          key: "Enter",
          run: (view) => {
            if (acceptCompletion(view)) return true;
            onApplyRef.current(
              normalizeWhereClause(view.state.doc.toString(), whereColumns, sqlDriver),
            );
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
      EditorView.domEventHandlers({
        click: (event, view) => {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return false;

          const span = findOperatorAtPosition(view.state.doc.toString(), pos);
          if (!span) return false;

          view.dispatch({
            selection: { anchor: span.to },
            scrollIntoView: true,
          });
          startCompletion(view);
          return true;
        },
      }),
    ],
    [schemaCompletions, placeholder, operatorCompletionSource, whereCompletionSource, whereColumns, sqlDriver],
  );

  // Mount once (subsequent schema/placeholder/value changes synced by dedicated effects).
  // Initial doc/extensions are read through refs so this effect can have empty deps:
  // re-running it would destroy the view on cleanup without recreating it, leaving the
  // editor non-editable when `extensions` changes after the table's columns load.
  const initialValueRef = useRef(value);
  const extensionsRef = useRef(extensions);
  extensionsRef.current = extensions;
  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({ doc: initialValueRef.current, extensions: extensionsRef.current });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Reconfigure when schema/placeholder change
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({ effects: StateEffect.reconfigure.of(extensions) });
  }, [extensions]);

  // Sync external value changes (e.g. clearing via the chip ×).
  // This is controlled-component value sync, not event logic: the CodeMirror
  // view is an uncontrolled DOM editor that must stay in sync with the React
  // prop. External changes occur via parent events (e.g. clear-chip click).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    // react-doctor-disable-next-line react-doctor/no-event-handler
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
      wasNonEmptyRef.current = value.trim().length > 0;
    }
  }, [value]);

  return <div ref={containerRef} className="cm-mini-host w-full" />;
}
