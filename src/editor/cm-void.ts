// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CodeMirror theme + highlight style for the Pine editor.
 *
 * Surfaces and accents use CSS variables written by
 * {@link applyThemeToDocument} so chart theme presets recolor the editor
 * chrome in lockstep with the rest of AXIS.
 *
 * @module editor/cm-void
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/** Editor theme bound to AXIS chrome CSS variables. */
export const voidEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      maxHeight: '100%',
      backgroundColor: 'var(--color-bg-panel)',
      color: 'var(--color-text)',
      fontSize: '13px',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      height: '100%',
    },
    '.cm-content': {
      caretColor: 'var(--color-accent)',
      minHeight: '100%',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-accent)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-bg-base)',
      color: 'var(--color-text-faint)',
      border: 'none',
      borderRight: '2px solid var(--color-border)',
      /* No fixed gutter min — each column sizes to its content */
      minWidth: '0',
    },
    /*
     * Line numbers: width = digits of max line only (CM spacer 9 → 99 → 999…).
     * Override library `.cm-lineNumbers .cm-gutterElement { minWidth: 20px }`.
     */
    '.cm-lineNumbers': {
      minWidth: '0',
      width: 'auto',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 0.3em 0 0.15em',
      minWidth: '0',
      width: 'auto',
      textAlign: 'right',
      whiteSpace: 'nowrap',
      boxSizing: 'border-box',
    },
    '.cm-panels': {
      backgroundColor: 'var(--color-bg-panel)',
      color: 'var(--color-text)',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '2px solid var(--color-border)',
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '2px solid var(--color-border)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'color-mix(in srgb, var(--color-orange) 35%, transparent)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--color-orange) 55%, transparent)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent-2) 15%, transparent)',
    },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
      outline: '1px solid var(--color-accent)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--color-bg-elev)',
      border: '2px solid var(--color-border)',
      borderRadius: '6px',
      color: 'var(--color-text)',
      overflow: 'hidden',
      boxShadow: 'var(--ui-shadow-panel)',
      // Above chart chrome / docked panels so hover + autocomplete stay visible
      zIndex: '200',
    },
    '.cm-tooltip-autocomplete': {
      borderRadius: '6px',
      maxHeight: 'min(320px, 50vh)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
      color: 'var(--color-accent)',
    },
    '.cm-tooltip.cm-tooltip-hover': {
      backgroundColor: 'var(--color-bg-elev)',
      border: '2px solid var(--color-border)',
      borderRadius: '6px',
      color: 'var(--color-text)',
      maxWidth: 'min(420px, 92vw)',
      padding: '0',
      zIndex: '210',
    },
    '.cm-tooltip .cm-pine-hover': {
      padding: '10px 12px',
      maxWidth: '400px',
      fontSize: '12px',
      lineHeight: '1.5',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
      color: 'var(--chart-fg, var(--color-text-dim))',
    },
    '.cm-pine-hover-badge': {
      color: 'var(--color-text-faint)',
      fontSize: '10px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      marginBottom: '6px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    },
    '.cm-pine-hover-sig': {
      color: 'var(--color-accent)',
      fontWeight: '600',
      fontSize: '12.5px',
      marginBottom: '8px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      wordBreak: 'break-word',
    },
    '.cm-pine-hover-title': {
      color: 'var(--color-accent)',
      fontWeight: '600',
      fontSize: '13px',
      marginBottom: '6px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    },
    '.cm-pine-hover-body': {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    },
    '.cm-pine-hover-list': {
      margin: '0.35em 0 0',
      padding: '0 0 0 1.1em',
      listStyle: 'disc',
    },
    '.cm-pine-hover-li': {
      margin: '0.15em 0',
      lineHeight: '1.4',
    },
    '.cm-pine-hover-p': {
      margin: '0',
      color: 'var(--chart-fg, var(--color-text-dim))',
      whiteSpace: 'normal',
    },
    '.cm-pine-hover-heading': {
      color: 'var(--color-text)',
      fontWeight: '600',
      fontSize: '12px',
      margin: '2px 0 0',
    },
    '.cm-pine-hover-hr': {
      border: 'none',
      borderTop: '1px solid var(--color-border)',
      margin: '4px 0',
    },
    '.cm-pine-hover-strong': {
      color: 'var(--color-text)',
      fontWeight: '600',
    },
    '.cm-pine-hover-code-inline': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      color: 'var(--color-accent)',
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
      padding: '1px 5px',
      borderRadius: '4px',
    },
    '.cm-pine-hover-pre': {
      margin: '2px 0 0',
      padding: '8px 10px',
      backgroundColor: 'var(--color-bg-base)',
      border: '1px solid var(--color-border-soft)',
      borderRadius: '4px',
      overflow: 'auto',
      maxWidth: '100%',
    },
    '.cm-pine-hover-code-block': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      lineHeight: '1.45',
      color: 'var(--color-accent-2)',
      whiteSpace: 'pre',
    },
    '.cm-tooltip .cm-pine-param-hint': {
      padding: '8px 10px',
      maxWidth: 'min(360px, 90vw)',
      fontSize: '11.5px',
      lineHeight: '1.4',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
    },
    '.cm-pine-param-hint-sig': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      color: 'var(--color-accent)',
      fontWeight: '600',
      marginBottom: '6px',
      wordBreak: 'break-word',
    },
    '.cm-pine-param-hint-list': {
      listStyle: 'none',
      margin: '0',
      padding: '0',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
    },
    '.cm-pine-param-hint-list li': {
      display: 'flex',
      gap: '6px',
      alignItems: 'baseline',
      color: 'var(--color-text-dim)',
    },
    '.cm-pine-param-hint-list li.is-used': {
      color: 'var(--color-text-faint)',
      textDecoration: 'line-through',
      opacity: '0.75',
    },
    '.cm-pine-param-hint-list li.is-current': {
      color: 'var(--color-accent)',
      fontWeight: '600',
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
      borderRadius: '3px',
      padding: '1px 4px',
    },
    '.cm-pine-param-hint-list li.is-unused': {
      color: 'var(--color-text)',
    },
    '.cm-pine-param-hint-note': {
      marginLeft: 'auto',
      fontSize: '10px',
      color: 'var(--color-text-faint)',
      fontWeight: '400',
    },
  },
  { dark: true },
);

/** Syntax colors driven by chrome CSS variables. */
export const voidHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--color-accent)', fontWeight: '600' },
  { tag: t.controlKeyword, color: 'var(--color-accent)', fontWeight: '600' },
  { tag: t.definitionKeyword, color: 'var(--color-accent)', fontWeight: '600' },
  { tag: t.moduleKeyword, color: 'var(--color-accent)', fontWeight: '600' },
  { tag: t.operator, color: 'color-mix(in srgb, var(--color-accent) 72%, var(--color-text-dim))' },
  { tag: t.string, color: 'var(--color-accent-2)' },
  { tag: t.special(t.string), color: 'var(--color-orange)' },
  { tag: t.number, color: 'var(--color-orange)' },
  { tag: t.bool, color: 'var(--color-orange)', fontWeight: '600' },
  { tag: t.null, color: 'var(--color-red)', fontStyle: 'italic' },
  { tag: t.comment, color: 'var(--color-text-faint)', fontStyle: 'italic' },
  // User locals — neutral, not a builtin
  { tag: t.variableName, color: 'var(--color-text)' },
  // Series builtins: close / bar_index / time / hl2 …
  { tag: t.standard(t.variableName), color: 'var(--color-editor-builtin)', fontWeight: '500' },
  // import alias (`m`, `motion`) and `export` names
  { tag: t.special(t.variableName), color: 'var(--color-editor-lib)', fontWeight: '500' },
  { tag: t.definition(t.variableName), color: 'var(--color-accent)', fontWeight: '500' },
  { tag: t.function(t.variableName), color: 'var(--color-accent)', fontWeight: '500' },
  // Built-in members: ta.sma, color.red
  { tag: t.propertyName, color: 'color-mix(in srgb, var(--color-accent-2) 72%, var(--color-text))' },
  // Library exports: m.Easing, motion.easing
  { tag: t.special(t.propertyName), color: 'var(--color-editor-lib-member)' },
  { tag: t.typeName, color: 'var(--color-editor-type)', fontWeight: '700' },
  { tag: t.className, color: 'var(--color-editor-type)', fontWeight: '700' },
  { tag: t.meta, color: 'var(--color-text-dim)', fontStyle: 'italic' },
  { tag: t.punctuation, color: 'var(--color-text-dim)' },
  { tag: t.bracket, color: 'var(--color-text-dim)' },
  { tag: t.atom, color: 'var(--color-orange)' },
  { tag: t.namespace, color: 'color-mix(in srgb, var(--color-accent) 58%, var(--color-text-dim))' },
]);

/** Theme + syntax highlighting bundle for {@link PyneEditor}. */
export const voidEditorExtensions = [
  voidEditorTheme,
  syntaxHighlighting(voidHighlightStyle),
];
