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
 * In-app text prompt for drawing tools (callout / note / text / anchored text).
 *
 * Replaces blocking `window.prompt` calls which steal focus, break Tauri v2
 * webviews (prompt is unsupported there) and can strand the chart in a stuck
 * state. Resolves with the entered string, or `null` on cancel/Escape.
 *
 * @module chart/drawings/tools/text-prompt
 */

export interface DrawingTextPromptOptions {
  /** Dialog title / aria-label. */
  title: string;
  /** Initial input value. */
  value: string;
  /** Confirm button label (default "OK"). */
  confirmLabel?: string;
  /** Cancel button label (default "Cancel"). */
  cancelLabel?: string;
  /** Max input length (default 200, matches DRAWING_TEXT_MAX). */
  maxlength?: number;
}

let activePrompt: Promise<string | null> | null = null;

/**
 * Show a non-blocking, keyboard-accessible text prompt.
 * Only one prompt may be open; a second call resolves after the first closes
 * (queued call returns `null` if the first was cancelled by replacement).
 */
export function promptDrawingText(opts: DrawingTextPromptOptions): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (activePrompt) return Promise.resolve(null);

  let resolvePrompt: (v: string | null) => void = () => {};
  const p = new Promise<string | null>((resolve) => {
    resolvePrompt = resolve;
  });
  activePrompt = p;

  const finish = (v: string | null) => {
    activePrompt = null;
    document.removeEventListener('keydown', onDocKey, true);
    overlay.remove();
    resolvePrompt(v);
  };

  const overlay = document.createElement('div');
  overlay.setAttribute('data-testid', 'axis-drawing-text-prompt-overlay');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '80',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(8, 9, 13, 0.55)',
    backdropFilter: 'blur(1px)',
  } as CSSStyleDeclaration);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) finish(null);
  });

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', opts.title);
  dialog.className =
    'bg-bg-elev border border-border rounded-[var(--radius-input)] shadow-lg p-3 flex flex-col gap-2 w-[min(22rem,90vw)]';

  const title = document.createElement('div');
  title.textContent = opts.title;
  title.className = 'text-[12px] font-semibold text-text';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sc-input text-[13px] px-2 py-1.5 w-full';
  input.value = opts.value;
  input.maxLength = opts.maxlength ?? 200;
  input.setAttribute('data-testid', 'axis-drawing-text-prompt-input');
  input.setAttribute('aria-label', opts.title);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    }
  });

  const buttons = document.createElement('div');
  buttons.className = 'flex justify-end gap-1.5';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = opts.cancelLabel ?? 'Cancel';
  cancel.className = 'sc-btn sc-btn-ghost text-[12px] px-3 py-1';
  cancel.setAttribute('data-testid', 'axis-drawing-text-prompt-cancel');
  cancel.addEventListener('click', () => finish(null));

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = opts.confirmLabel ?? 'OK';
  ok.className = 'sc-btn sc-btn-primary text-[12px] px-3 py-1';
  ok.setAttribute('data-testid', 'axis-drawing-text-prompt-ok');
  ok.addEventListener('click', () => finish(input.value));

  const onDocKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    }
  };
  document.addEventListener('keydown', onDocKey, true);

  buttons.append(cancel, ok);
  dialog.append(title, input, buttons);
  overlay.append(dialog);
  document.body.append(overlay);
  input.focus();
  input.select();

  return p;
}

/** True while a drawing text prompt is open (used to gate chart hotkeys). */
export function isDrawingTextPromptOpen(): boolean {
  return activePrompt != null;
}
