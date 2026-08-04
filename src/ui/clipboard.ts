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
 * Clipboard helpers that work on insecure origins (HTTP VPS demos).
 *
 * `navigator.clipboard.writeText` requires a secure context (HTTPS or
 * localhost). AXIS often runs at `http://VPS:8081`, so we fall back to a
 * hidden textarea + `document.execCommand('copy')` when the API is missing
 * or rejects the write.
 *
 * @module ui/clipboard
 */

function canUseAsyncClipboard(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.clipboard?.writeText !== 'function') return false;
  // Prefer not to hit NotAllowedError on plain HTTP demo hosts
  try {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return false;
    }
  } catch {
    /* ignore */
  }
  return true;
}

function selectTextarea(ta: HTMLTextAreaElement, len: number): void {
  try {
    if (typeof ta.focus === 'function') ta.focus();
  } catch {
    /* ignore */
  }
  // Happy-dom / minimal test DOMs may lack select / setSelectionRange
  try {
    if (typeof ta.select === 'function') {
      ta.select();
      return;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof ta.setSelectionRange === 'function') {
      ta.setSelectionRange(0, len);
    }
  } catch {
    /* ignore */
  }
}

function copyViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  if (typeof document.execCommand !== 'function') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  // Keep in viewport for selection; opacity 0 so invisible
  ta.style.cssText =
    'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;' +
    'outline:none;box-shadow:none;background:transparent;opacity:0;';
  document.body.appendChild(ta);
  try {
    selectTextarea(ta, text.length);
    return !!document.execCommand('copy');
  } catch {
    return false;
  } finally {
    try {
      document.body.removeChild(ta);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Copy plain text to the system clipboard.
 * @returns true when the browser accepted the write
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? '');
  if (!value) return false;

  if (canUseAsyncClipboard()) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through */
    }
  }

  return copyViaExecCommand(value);
}
