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
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 6px',
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
    },
    '.cm-tooltip-autocomplete': {
      borderRadius: '6px',
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
  },
  { dark: true },
);

/** Syntax colors driven by chrome CSS variables. */
export const voidHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--color-accent)' },
  { tag: t.operator, color: 'var(--color-accent)' },
  { tag: t.string, color: 'var(--color-accent-2)' },
  { tag: t.number, color: 'var(--color-orange)' },
  { tag: t.bool, color: 'var(--color-orange)' },
  { tag: t.null, color: 'var(--color-red)' },
  { tag: t.comment, color: 'var(--color-text-faint)', fontStyle: 'italic' },
  { tag: t.variableName, color: 'var(--color-text)' },
  { tag: t.definition(t.variableName), color: 'var(--color-accent)' },
  { tag: t.function(t.variableName), color: 'var(--color-accent)' },
  { tag: t.propertyName, color: 'var(--color-text-dim)' },
  { tag: t.typeName, color: 'var(--color-accent)' },
  { tag: t.className, color: 'var(--color-accent)' },
  { tag: t.meta, color: 'var(--color-text-dim)' },
  { tag: t.punctuation, color: 'var(--color-text-dim)' },
  { tag: t.atom, color: 'var(--color-orange)' },
  { tag: t.namespace, color: 'var(--color-text-dim)' },
]);

/** Theme + syntax highlighting bundle for {@link PyneEditor}. */
export const voidEditorExtensions = [
  voidEditorTheme,
  syntaxHighlighting(voidHighlightStyle),
];
