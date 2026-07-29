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
 * Cross-window **bridge** for the detachable Pine editor (popup / new tab).
 *
 * Main chart window and editor window communicate via:
 * - **BroadcastChannel** {@link EDITOR_CHANNEL} (`axis-editor-v1`)
 * - **localStorage** shared doc (`EDITOR_DOC_KEY`) for persistence across reloads
 *
 * Dual-listens on the legacy SuperChart channel so open popouts keep working.
 * Messages: hello/ping/pong, doc sync, run + run-status, popout open/close, reattach.
 *
 * @module editor/editor-bridge
 */

import { EDITOR_DOC_KEY } from '../store';

/** BroadcastChannel name for AXIS editor ↔ main. */
export const EDITOR_CHANNEL = 'axis-editor-v1';
/** @deprecated SuperChart channel — dual-listen only */
const LEGACY_EDITOR_CHANNEL = 'superchart-editor-v1';

/** Discriminated union of bridge frames. */
export type BridgeMessage =
  | { type: 'hello'; role: 'main' | 'editor' }
  | { type: 'doc'; doc: string }
  | { type: 'run'; doc: string }
  | { type: 'run-status'; status: string; message: string }
  | { type: 'popout-opened' }
  | { type: 'popout-closed' }
  | { type: 'reattach' }
  | { type: 'ping' }
  | { type: 'pong'; role: 'main' | 'editor' };

type Handler = (msg: BridgeMessage) => void;

let channel: BroadcastChannel | null = null;
let legacyChannel: BroadcastChannel | null = null;
const handlers = new Set<Handler>();

function dispatch(msg: BridgeMessage) {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
  for (const h of handlers) h(msg);
}

function ensureChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel(EDITOR_CHANNEL);
    channel.onmessage = (ev: MessageEvent<BridgeMessage>) => dispatch(ev.data);
  }
  // Dual-listen legacy SuperChart channel (read-only for migration)
  if (!legacyChannel) {
    try {
      legacyChannel = new BroadcastChannel(LEGACY_EDITOR_CHANNEL);
      legacyChannel.onmessage = (ev: MessageEvent<BridgeMessage>) => dispatch(ev.data);
    } catch {
      legacyChannel = null;
    }
  }
  return channel;
}

/** Subscribe to bridge messages; returns unsubscribe. */
export function bridgeSubscribe(handler: Handler): () => void {
  ensureChannel();
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Publish on the AXIS channel (and not on the legacy channel). */
export function bridgePublish(msg: BridgeMessage) {
  const ch = ensureChannel();
  ch?.postMessage(msg);
  // Also mirror doc to localStorage for late joiners
  if (msg.type === 'doc') {
    try {
      localStorage.setItem(EDITOR_DOC_KEY, msg.doc);
    } catch {}
  }
}

/** Read the shared editor document from localStorage. */
export function readSharedDoc(): string {
  try {
    return localStorage.getItem(EDITOR_DOC_KEY) || '';
  } catch {
    return '';
  }
}

/** Persist doc to localStorage and broadcast a `doc` message. */
export function writeSharedDoc(doc: string) {
  try {
    localStorage.setItem(EDITOR_DOC_KEY, doc);
  } catch {}
  bridgePublish({ type: 'doc', doc });
}

/** Open editor as popup window (detach) or full tab (`?view=editor`). */
export function openEditorWindow(mode: 'popup' | 'tab' = 'popup'): Window | null {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'editor');
  const features =
    mode === 'popup'
      ? 'popup=yes,width=720,height=900,menubar=no,toolbar=no,location=no,status=no'
      : undefined;
  const win = window.open(url.toString(), 'axis-editor', features);
  if (win) {
    bridgePublish({ type: 'popout-opened' });
  }
  return win;
}

/** True when this window is the standalone editor (`?view=editor`). */
export function isEditorView(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('view') === 'editor';
}
