import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const tairikiEditorTheme = EditorView.theme({
  "&": {
    color: "var(--ds-label)",
    backgroundColor: "var(--ds-content-bg)",
  },
  ".cm-content": {
    caretColor: "var(--ds-label)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--ds-label)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--ds-accent-subtle)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--ds-bg-subtle) 40%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--ds-accent) 15%, transparent)",
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--ds-accent) 20%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--ds-content-bg)",
    color: "var(--ds-secondary)",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--ds-bg-subtle) 40%, transparent)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--ds-secondary)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--ds-warning) 30%, transparent)",
    outline: "1px solid var(--ds-warning)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--ds-warning) 50%, transparent)",
  },
  ".cm-panels": {
    backgroundColor: "var(--ds-sidebar-bg)",
    color: "var(--ds-label)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--ds-separator)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--ds-separator)" },
  ".cm-tooltip": {
    backgroundColor: "var(--ds-sidebar-bg)",
    border: "1px solid var(--ds-separator)",
    borderRadius: "6px",
  },
  ".cm-tooltip .cm-tooltip-arrow:after": {
    borderTopColor: "var(--ds-sidebar-bg)",
    borderBottomColor: "var(--ds-sidebar-bg)",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "var(--ds-accent)",
      color: "var(--ds-text-inverse)",
    },
  },
});

const tairikiHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.definitionKeyword, tags.controlKeyword],
    color: "var(--ds-syntax-keyword)",
    fontWeight: "500",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName)), tags.labelName],
    color: "var(--ds-syntax-number)",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.character, tags.attributeValue],
    color: "var(--ds-syntax-string)",
  },
  {
    tag: [tags.number, tags.integer, tags.float],
    color: "var(--ds-syntax-number)",
  },
  {
    tag: [tags.typeName, tags.className, tags.typeOperator, tags.namespace],
    color: "var(--ds-syntax-type)",
  },
  {
    tag: [tags.constant(tags.name), tags.standard(tags.name)],
    color: "var(--ds-syntax-enum)",
  },
  {
    tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket, tags.angleBracket, tags.squareBracket, tags.paren],
    color: "var(--ds-syntax-operator)",
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--ds-syntax-comment)",
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
    color: "var(--ds-destructive)",
    textDecoration: "underline wavy",
  },
  {
    tag: [tags.variableName, tags.propertyName, tags.attributeName],
    color: "var(--ds-label)",
  },
]);

export const tairikiTheme: Extension = [
  tairikiEditorTheme,
  syntaxHighlighting(tairikiHighlightStyle),
];
