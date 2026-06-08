// tairikiTheme is lazy-loaded via SqlEditor/MiniSqlEditor; the bundler code-splits CodeMirror out of the initial bundle.
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const tairikiEditorTheme = EditorView.theme({
  "&": {
    fontFamily: "var(--font-editor)",
    fontSize: "var(--font-editor-size)",
    lineHeight: "var(--font-editor-line-height)",
    color: "var(--text-primary)",
    backgroundColor: "var(--surface-base)",
    fontVariantLigatures: "common-ligatures",
    fontFeatureSettings: '"liga", "calt"',
  },
  ".cm-content": {
    caretColor: "var(--text-primary)",
    padding: "12px 0",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--text-primary)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--ds-accent) 24%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--surface-hover)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--ds-accent) 15%, transparent)",
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--ds-accent) 20%, transparent)",
  },
  ".cm-gutters": {
    fontFamily: "var(--font-editor)",
    fontSize: "var(--font-editor-size)",
    backgroundColor: "var(--surface-base)",
    color: "var(--text-tertiary)",
    borderRight: "1px solid var(--border-subtle)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--surface-hover)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--text-tertiary)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--ds-warning) 30%, transparent)",
    outline: "1px solid var(--ds-warning)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--ds-warning) 50%, transparent)",
  },
  ".cm-panels": {
    backgroundColor: "var(--surface-sidebar)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-ui-size)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border-default)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border-default)" },
  ".cm-tooltip": {
    backgroundColor: "var(--surface-sidebar)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-popover)",
    boxShadow: "var(--shadow-popover)",
    fontFamily: "var(--font-editor)",
    fontSize: "var(--font-editor-size)",
  },
  ".cm-tooltip .cm-tooltip-arrow:after": {
    borderTopColor: "var(--surface-sidebar)",
    borderBottomColor: "var(--surface-sidebar)",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul": {
      fontFamily: "var(--font-editor)",
      fontSize: "var(--font-editor-size)",
    },
    "& > ul > li": {
      padding: "4px 10px",
    },
    "& > ul > li:hover": {
      backgroundColor: "var(--surface-hover)",
    },
    "& > ul > li[aria-selected]": {
      backgroundColor: "color-mix(in srgb, var(--ds-accent) 20%, transparent)",
      color: "var(--text-primary)",
    },
  },
  ".cm-completionLabel": {
    color: "var(--text-primary)",
  },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: "600",
  },
  ".cm-completionIcon": {
    display: "none",
  },
  ".cm-completionDetail": {
    color: "var(--text-tertiary)",
    fontStyle: "normal",
  },
  ".cm-diagnostic": {
    padding: "3px 6px",
    borderLeft: "3px solid transparent",
    fontFamily: "var(--font-editor)",
    fontSize: "var(--font-editor-size)",
  },
  ".cm-diagnostic-error": {
    borderLeftColor: "var(--ds-destructive)",
    backgroundColor: "color-mix(in srgb, var(--ds-destructive) 8%, transparent)",
  },
  ".cm-diagnostic-warning": {
    borderLeftColor: "var(--ds-warning)",
    backgroundColor: "color-mix(in srgb, var(--ds-warning) 8%, transparent)",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--ds-destructive)",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--ds-warning)",
  },
});

const tairikiHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.definitionKeyword, tags.controlKeyword],
    color: "var(--editor-syntax-keyword)",
    fontWeight: "500",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName)), tags.labelName],
    color: "var(--editor-syntax-function)",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.character, tags.attributeValue],
    color: "var(--editor-syntax-string)",
  },
  {
    tag: [tags.number, tags.integer, tags.float],
    color: "var(--editor-syntax-function)",
  },
  {
    tag: [tags.typeName, tags.className, tags.typeOperator, tags.namespace],
    color: "var(--editor-syntax-type)",
  },
  {
    tag: [tags.constant(tags.name), tags.standard(tags.name)],
    color: "var(--editor-syntax-constant)",
  },
  {
    tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket, tags.angleBracket, tags.squareBracket, tags.paren],
    color: "var(--editor-syntax-operator)",
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--editor-syntax-comment)",
    fontStyle: "italic",
  },
  {
    tag: [tags.bool, tags.null, tags.regexp],
    color: "var(--ds-syntax-special)",
  },
  {
    tag: [tags.self, tags.atom],
    color: "var(--ds-syntax-special)",
  },
  {
    tag: tags.invalid,
    color: "var(--editor-syntax-error)",
    textDecoration: "underline wavy",
  },
  {
    tag: [tags.variableName, tags.propertyName, tags.attributeName],
    color: "var(--text-primary)",
  },
]);

export const tairikiTheme: Extension = [
  tairikiEditorTheme,
  syntaxHighlighting(tairikiHighlightStyle),
];
