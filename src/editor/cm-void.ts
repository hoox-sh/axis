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
 * CodeMirror **void indigo** theme + highlight style for the Pine editor.
 *
 * Matches AXIS landing / `index.css` tokens (`#111218` canvas, `#939fff` accent).
 * Export {@link voidEditorExtensions} (theme + syntax highlighting) for
 * {@link PineEditor}.
 *
 * @module editor/cm-void
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/** Void canvas CodeMirror theme — matches AXIS void indigo tokens. */
export const voidEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      maxHeight: '100%',
      backgroundColor: '#111218',
      color: '#eceef4',
      fontSize: '13px',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      height: '100%',
    },
    '.cm-content': {
      caretColor: '#939fff',
      // Soft-wrap long Pine lines; gutter still tracks visual lines
      minHeight: '100%',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#939fff',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(147, 159, 255, 0.22)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(147, 159, 255, 0.06)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(147, 159, 255, 0.08)',
    },
    '.cm-gutters': {
      backgroundColor: '#0a0b10',
      color: '#5c5f6e',
      border: 'none',
      borderRight: '2px solid #3a3d4a',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 6px',
    },
    '.cm-panels': {
      backgroundColor: '#111218',
      color: '#eceef4',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '2px solid #3a3d4a',
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '2px solid #3a3d4a',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(232, 160, 58, 0.35)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(232, 160, 58, 0.55)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(142, 245, 168, 0.15)',
    },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(147, 159, 255, 0.2)',
      outline: '1px solid #939fff',
    },
    '.cm-tooltip': {
      backgroundColor: '#171821',
      border: '2px solid #3a3d4a',
      borderRadius: '6px',
      color: '#eceef4',
      overflow: 'hidden',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
    },
    '.cm-tooltip-autocomplete': {
      borderRadius: '6px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgba(147, 159, 255, 0.18)',
      color: '#939fff',
    },
    /* Hover card shell (CodeMirror wraps create() DOM) */
    '.cm-tooltip.cm-tooltip-hover': {
      backgroundColor: '#171821',
      border: '2px solid #3a3d4a',
      borderRadius: '6px',
      color: '#eceef4',
      maxWidth: 'min(420px, 92vw)',
      padding: '0',
    },
    '.cm-tooltip .cm-pine-hover': {
      padding: '10px 12px',
      maxWidth: '400px',
      fontSize: '12px',
      lineHeight: '1.5',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
      color: '#c8cad4',
    },
    '.cm-pine-hover-badge': {
      color: '#5c5f6e',
      fontSize: '10px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      marginBottom: '6px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    },
    '.cm-pine-hover-sig': {
      color: '#939fff',
      fontWeight: '600',
      fontSize: '12.5px',
      marginBottom: '8px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      wordBreak: 'break-word',
    },
    '.cm-pine-hover-title': {
      color: '#939fff',
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
    '.cm-pine-hover-p': {
      margin: '0',
      color: '#c8cad4',
      whiteSpace: 'normal',
    },
    '.cm-pine-hover-heading': {
      color: '#eceef4',
      fontWeight: '600',
      fontSize: '12px',
      margin: '2px 0 0',
    },
    '.cm-pine-hover-hr': {
      border: 'none',
      borderTop: '1px solid #3a3d4a',
      margin: '4px 0',
    },
    '.cm-pine-hover-strong': {
      color: '#eceef4',
      fontWeight: '600',
    },
    '.cm-pine-hover-code-inline': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      color: '#a7b4ff',
      backgroundColor: 'rgba(147, 159, 255, 0.12)',
      padding: '1px 5px',
      borderRadius: '4px',
    },
    '.cm-pine-hover-pre': {
      margin: '2px 0 0',
      padding: '8px 10px',
      backgroundColor: '#0a0b10',
      border: '1px solid #2a2d38',
      borderRadius: '4px',
      overflow: 'auto',
      maxWidth: '100%',
    },
    '.cm-pine-hover-code-block': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '11px',
      lineHeight: '1.45',
      color: '#8ef5a8',
      whiteSpace: 'pre',
    },
  },
  { dark: true },
);

export const voidHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#939fff' },
  { tag: t.operator, color: '#a7b4ff' },
  { tag: t.string, color: '#8ef5a8' },
  { tag: t.number, color: '#e8a03a' },
  { tag: t.bool, color: '#e8a03a' },
  { tag: t.null, color: '#e85d4c' },
  { tag: t.comment, color: '#5c5f6e', fontStyle: 'italic' },
  { tag: t.variableName, color: '#eceef4' },
  { tag: t.definition(t.variableName), color: '#939fff' },
  { tag: t.function(t.variableName), color: '#a7b4ff' },
  { tag: t.propertyName, color: '#8ec8d4' },
  { tag: t.typeName, color: '#939fff' },
  { tag: t.className, color: '#939fff' },
  { tag: t.meta, color: '#8b8e9c' },
  { tag: t.punctuation, color: '#8b8e9c' },
  { tag: t.atom, color: '#e8a03a' },
  { tag: t.namespace, color: '#8ec8d4' },
]);

/** Theme + syntax highlighting bundle for {@link PineEditor}. */
export const voidEditorExtensions = [
  voidEditorTheme,
  syntaxHighlighting(voidHighlightStyle),
];
