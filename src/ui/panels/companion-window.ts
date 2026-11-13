// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Companion popup windows for dock panels.
 *
 * A panel can be detached into a real browser window (`dock: 'window'`). The
 * popup is a static skeleton — every dynamic string goes through DOM APIs
 * (`textContent`, `doc.title`), never `doc.write` interpolation — and talks
 * back through same-origin `postMessage`.
 *
 * Plain DOM code with no Solid reactivity, so it lives outside the component
 * file. {@link installPanelWindowBridge} is called once from `app.tsx`.
 *
 * @module ui/panels/companion-window
 */

import { getPanelChrome, setPanelDock, setPanelOpen } from '../../store';
import { PANEL_IDS } from './panel-manager';
import type { PanelId } from './types';

const companionWindows = new Map<PanelId, Window>();

/** Static companion-window stylesheet (no interpolation — never user-controlled). */
const COMPANION_CSS = [
  'html,body{margin:0;height:100%;background:#0a0b10;color:#eceef4;',
  'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
  '.wrap{display:flex;flex-direction:column;height:100%}',
  'header{display:flex;align-items:center;gap:8px;padding:8px 10px;',
  'border-bottom:2px solid #3a3d4a;background:#111218;font-size:11px;',
  'text-transform:uppercase;letter-spacing:.06em;color:#8b8e9c;font-weight:650}',
  'main{flex:1;padding:16px;color:#8b8e9c;font-size:12px;line-height:1.5}',
  'code{color:#939fff}',
  'button{margin-top:12px;background:#171821;color:#eceef4;border:2px solid #3a3d4a;',
  'padding:6px 12px;cursor:pointer;border-radius:2px;font:inherit}',
  'button:hover{border-color:#939fff;color:#939fff}',
  '.grip{display:inline-flex;flex-direction:column;gap:2px;margin-right:6px}',
  '.grip i{display:block;width:10px;height:2px;background:#5c5f6e}',
].join('\n');

/** True for known panel ids (guards the `window.open` name + bridge casts). */
function isKnownPanelId(v: unknown): v is PanelId {
  return typeof v === 'string' && (PANEL_IDS as readonly string[]).includes(v);
}

/** Detach `id` into a companion popup (focuses an existing one). */
export function openCompanionWindow(id: PanelId, title: string) {
  // Validate before touching `window.open`: the id lands in the window name
  // and (via postMessage) back in the bridge cast below.
  if (!isKnownPanelId(id)) return;
  try {
    const existing = companionWindows.get(id);
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const c = getPanelChrome(id);
    const w = window.open(
      '',
      `axis-panel-${id}`,
      `width=${Math.max(320, c.w)},height=${Math.max(240, c.h)},menubar=no,toolbar=no,location=no,status=no`,
    );
    if (!w) return;
    companionWindows.set(id, w);
    // Static skeleton only — every dynamic string below goes through DOM
    // APIs (`textContent`, `doc.title`), never `doc.write` interpolation.
    const doc = w.document;
    doc.open();
    doc.write(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>',
    );
    doc.close();
    doc.title = `AXIS · ${title}`;
    const style = doc.createElement('style');
    style.textContent = COMPANION_CSS;
    doc.head.appendChild(style);
    const wrap = doc.createElement('div');
    wrap.className = 'wrap';
    const header = doc.createElement('header');
    const grip = doc.createElement('span');
    grip.className = 'grip';
    for (let i = 0; i < 3; i++) grip.appendChild(doc.createElement('i'));
    header.appendChild(grip);
    header.appendChild(doc.createTextNode(title));
    const main = doc.createElement('main');
    const p1 = doc.createElement('p');
    const strong = doc.createElement('strong');
    strong.style.color = '#eceef4';
    strong.textContent = title;
    p1.appendChild(strong);
    p1.appendChild(doc.createTextNode(' is detached to this window.'));
    const p2 = doc.createElement('p');
    p2.appendChild(
      doc.createTextNode(
        'The live panel stays in the main AXIS tab (float mode). Use this window as a focus space, or close it and choose ',
      ),
    );
    const code = doc.createElement('code');
    code.textContent = 'Dock';
    p2.appendChild(code);
    p2.appendChild(doc.createTextNode(' / '));
    const code2 = doc.createElement('code');
    code2.textContent = 'Float';
    p2.appendChild(code2);
    p2.appendChild(doc.createTextNode(' from the panel handle.'));
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = 'reattach';
    btn.textContent = 'Reattach & close';
    // Same-origin companion: wire directly from the opener instead of an
    // inline <script> + postMessage round-trip (CSP-friendly, same behavior).
    btn.addEventListener('click', () => {
      try {
        setPanelDock(id, 'float');
        setPanelOpen(id, true);
      } finally {
        try {
          w.close();
        } catch {
          /* ignore */
        }
        companionWindows.delete(id);
      }
    });
    main.appendChild(p1);
    main.appendChild(p2);
    main.appendChild(btn);
    wrap.appendChild(header);
    wrap.appendChild(main);
    doc.body.appendChild(wrap);
    w.addEventListener('beforeunload', () => {
      companionWindows.delete(id);
      // Keep float open in main
      const chrome = getPanelChrome(id);
      if (chrome.dock === 'window') setPanelDock(id, 'float');
    });
  } catch {
    /* popup blocked */
  }
}

/**
 * Listen for `axis-panel-reattach` / `axis-panel-window-closed` postMessages
 * from companion popups. Returns an unsubscribe for `onCleanup`.
 */
export function installPanelWindowBridge(): () => void {
  const onMsg = (ev: MessageEvent) => {
    // Same-origin only — companion popups use location.origin as targetOrigin
    if (ev.origin !== window.location.origin) return;
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'axis-panel-reattach' && isKnownPanelId(d.id)) {
      setPanelDock(d.id, 'float');
      setPanelOpen(d.id, true);
      const w = companionWindows.get(d.id);
      try {
        w?.close();
      } catch {
        /* ignore */
      }
      companionWindows.delete(d.id);
    }
    if (d.type === 'axis-panel-window-closed' && isKnownPanelId(d.id)) {
      companionWindows.delete(d.id);
      // Keep float open in main
      const c = getPanelChrome(d.id);
      if (c.dock === 'window') setPanelDock(d.id, 'float');
    }
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}
