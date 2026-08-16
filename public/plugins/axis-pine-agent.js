// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AXIS dynamic plugin — PYNE natural-language agent (Cloudflare® Worker).
//
// Install in AXIS → Manager → Plugins → Install from URL:
//   https://<your-worker>/plugin/axis-pine-agent.js
//
// Contract namespace: pynescript.axis.plugins.v1
// Kind: component (manager-tab + topbar-action). AXIS may still be phase-2
// for component mounting; this module also attaches a compact launcher when
// the host does not call mount() (best-effort global bootstrap).
//
// Pine Script™ and TradingView® are trademarks of TradingView, Inc.
// Cloudflare® is a registered trademark of Cloudflare, Inc.
// Not affiliated with or endorsed by TradingView, Inc. or Cloudflare, Inc.

/**
 * @typedef {object} PluginContext
 * @property {() => Record<string, unknown>} getConfig
 * @property {(msg: string, level?: string) => void} [setStatus]
 * @property {{ fetch?: typeof fetch }} [host]
 */

/** Production agent Worker — module may be served same-origin from AXIS `/plugins/`. */
const DEFAULT_ENDPOINT = "https://pyne-agent-worker.cryptolinx.workers.dev";

/** Default floating modal geometry (not an AXIS dock panel). */
const MODAL_DEFAULT = {
  w: 420,
  h: 520,
  minW: 300,
  minH: 280,
};

function cfg(config) {
  const c = config || {};
  return {
    endpoint: String(c.endpoint || DEFAULT_ENDPOINT).replace(/\/$/, ""),
    apiKey: String(c.apiKey || c.api_key || ""),
    pineVersion: String(c.pineVersion || c.pine_version || "auto"),
    style: String(c.style || "auto"),
  };
}

async function agentFetch(endpoint, apiKey, path, init = {}, hostFetch) {
  const f = hostFetch || fetch;
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  if (apiKey) {
    headers.set("X-API-Key", apiKey);
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  const res = await f(`${endpoint}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

const PLUGIN_UI_VERSION = "0.1.5";

function injectStyles() {
  const id = "pyne-agent-styles";
  let style = document.getElementById(id);
  if (style?.getAttribute("data-v") === PLUGIN_UI_VERSION) return;
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.appendChild(style);
  }
  style.setAttribute("data-v", PLUGIN_UI_VERSION);
  style.textContent = `
    .pyne-agent-root {
      display: flex; flex-direction: column; height: 100%; min-height: 0;
      font-family: ui-sans-serif, system-ui, sans-serif;
      color: var(--color-text, #e8eaed);
      background: var(--color-bg-panel, #0f1419);
      border: 1px solid var(--color-border, #2a3441);
      border-radius: var(--radius-input, 3px);
      overflow: hidden;
      box-shadow: var(--ui-shadow-panel, 0 12px 40px rgba(0,0,0,0.45));
    }
    .pyne-agent-header {
      padding: 8px 10px; border-bottom: 1px solid var(--color-border-soft, #2a3441);
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      background: var(--color-bg-elev, #151b23);
      cursor: grab; user-select: none; flex-shrink: 0;
      touch-action: none;
    }
    .pyne-agent-header:active { cursor: grabbing; }
    .pyne-agent-header h3 {
      margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
      color: var(--color-text, #e8eaed);
    }
    .pyne-agent-header small { color: var(--color-text-dim, #8b98a5); font-size: 10px; }
    .pyne-agent-status {
      display: inline-flex; align-items: center; gap: 5px;
      color: var(--color-text-dim, #8b98a5); font-size: 10px;
      min-height: 1.2em;
    }
    .pyne-agent-status.is-thinking {
      color: var(--color-accent, #5b7cfa);
    }
    .pyne-agent-status-label { line-height: 1; }
    .pyne-agent-status-dots {
      display: none;
      align-items: center;
      gap: 3px;
      height: 10px;
    }
    .pyne-agent-status.is-thinking .pyne-agent-status-dots { display: inline-flex; }
    .pyne-agent-status-dots span {
      width: 4px; height: 4px; border-radius: 50%;
      background: var(--color-accent, #5b7cfa);
      opacity: 0.35;
      animation: pyne-agent-bounce 1.05s ease-in-out infinite;
    }
    .pyne-agent-status-dots span:nth-child(2) { animation-delay: 0.15s; }
    .pyne-agent-status-dots span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes pyne-agent-bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
      40% { transform: translateY(-3px); opacity: 1; }
    }
    .pyne-agent-status.is-thinking .pyne-agent-status-label {
      animation: pyne-agent-pulse 1.4s ease-in-out infinite;
    }
    @keyframes pyne-agent-pulse {
      0%, 100% { opacity: 0.75; }
      50% { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pyne-agent-status-dots span,
      .pyne-agent-status.is-thinking .pyne-agent-status-label {
        animation: none;
        opacity: 0.85;
      }
    }
    .pyne-agent-header-actions {
      display: flex; align-items: center; gap: 6px; flex-shrink: 0;
    }
    .pyne-agent-header-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 1.65em; height: 1.65em; padding: 0;
      background: transparent;
      color: var(--color-text-dim, #8b98a5);
      border: 1px solid transparent;
      border-radius: var(--radius-input, 3px);
      font-size: 14px; line-height: 1; cursor: pointer;
    }
    .pyne-agent-header-btn:hover {
      color: var(--color-text, #e8eaed);
      background: var(--color-bg-hover, #22232e);
      border-color: var(--color-border-soft, #252730);
    }
    .pyne-agent-header-btn:focus-visible {
      outline: none;
      border-color: var(--color-accent, #5b7cfa);
    }
    .pyne-agent-msgs {
      flex: 1; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
      min-height: 0;
    }
    .pyne-agent-msg {
      max-width: 96%; padding: 8px 10px; border-radius: var(--radius-input, 3px);
      font-size: 12px; line-height: 1.5;
      word-break: break-word;
    }
    .pyne-agent-msg.user {
      align-self: flex-end;
      white-space: pre-wrap;
      background: color-mix(in srgb, var(--color-accent, #2563eb) 28%, var(--color-bg-elev, #1d4f7c));
      color: var(--color-text, #e8eaed);
    }
    .pyne-agent-msg.assistant {
      align-self: stretch;
      max-width: 100%;
      background: var(--color-bg-elev, #1a222c);
      border: 1px solid var(--color-border-soft, #2a3441);
    }
    .pyne-agent-msg.error {
      align-self: stretch;
      white-space: pre-wrap;
      background: color-mix(in srgb, var(--color-red, #7f1d1d) 18%, var(--color-bg-panel, #3a1515));
      border: 1px solid color-mix(in srgb, var(--color-red, #7f1d1d) 55%, transparent);
      color: var(--color-red, #fecaca);
    }
    .pyne-agent-prose {
      white-space: pre-wrap;
      margin: 0 0 8px;
    }
    .pyne-agent-prose:last-child { margin-bottom: 0; }
    .pyne-agent-codebox {
      margin: 8px 0 0;
      border: 1px solid var(--color-border, #3a3d4a);
      border-radius: var(--radius-input, 3px);
      background: var(--color-bg-base, #0a0b10);
      overflow: hidden;
    }
    .pyne-agent-codebox:first-child { margin-top: 0; }
    .pyne-agent-codebox-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 6px;
      padding: 4px 8px;
      background: color-mix(in srgb, var(--color-bg-elev, #171821) 80%, var(--color-bg-base, #0a0b10));
      border-bottom: 1px solid var(--color-border-soft, #252730);
      font-size: 10px;
      color: var(--color-text-dim, #8b8e9c);
      user-select: none;
    }
    .pyne-agent-codebox-lang {
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--color-accent, #5b7cfa);
    }
    .pyne-agent-codebox pre {
      margin: 0;
      padding: 8px 10px;
      max-height: min(280px, 40vh);
      overflow: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      line-height: 1.45;
      color: var(--color-text, #eceef4);
      white-space: pre;
      tab-size: 2;
    }
    .pyne-agent-codebox code {
      font-family: inherit;
      font-size: inherit;
      background: none;
      padding: 0;
      color: inherit;
    }
    .pyne-agent-codebox-actions {
      display: flex; flex-wrap: wrap; gap: 4px;
      padding: 6px 8px;
      border-top: 1px solid var(--color-border-soft, #252730);
      background: var(--color-bg-elev, #171821);
    }
    .pyne-agent-codebox-actions button {
      background: var(--color-bg-hover, #22232e);
      color: var(--color-text, #e8eaed);
      border: 1px solid var(--color-border, #3a4a5c);
      border-radius: var(--radius-input, 3px);
      padding: 3px 8px; font-size: 10.5px; font-weight: 500; cursor: pointer;
      line-height: 1.3;
    }
    .pyne-agent-codebox-actions button:hover {
      border-color: var(--color-accent, #5b7cfa);
      color: var(--color-accent, #5b7cfa);
    }
    .pyne-agent-codebox-actions button.is-primary {
      background: color-mix(in srgb, var(--color-accent, #5b7cfa) 18%, var(--color-bg-elev, #171821));
      border-color: var(--color-accent, #5b7cfa);
      color: var(--color-accent, #5b7cfa);
    }
    .pyne-agent-codebox-actions button.is-primary:hover {
      background: color-mix(in srgb, var(--color-accent-hover, #4a6ae8) 28%, var(--color-bg-elev, #171821));
      border-color: var(--color-accent-hover, #4a6ae8);
      color: var(--color-accent-hover, #4a6ae8);
    }
    .pyne-agent-inline-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.92em;
      padding: 0.05em 0.3em;
      border-radius: var(--radius-chip, 2px);
      background: color-mix(in srgb, var(--color-bg-base, #0a0b10) 70%, transparent);
      border: 1px solid var(--color-border-soft, #252730);
    }
    .pyne-agent-form {
      display: flex; gap: 8px; padding: 8px 10px;
      border-top: 1px solid var(--color-border-soft, #2a3441);
      background: var(--color-bg-elev, #151b23);
      flex-shrink: 0;
    }
    .pyne-agent-form textarea {
      flex: 1; resize: none; min-height: 52px; max-height: 140px;
      background: var(--color-bg-base, #0b0f14);
      color: var(--color-text, #e8eaed);
      border: 1px solid var(--color-border, #2a3441);
      border-radius: var(--radius-input, 3px);
      padding: 7px 8px; font: inherit; font-size: 12px;
    }
    .pyne-agent-form textarea:focus {
      outline: none;
      border-color: var(--color-accent, #5b7cfa);
    }
    .pyne-agent-form button[type="submit"] {
      align-self: flex-end;
      background: color-mix(in srgb, var(--color-accent, #2563eb) 22%, var(--color-bg-elev, #171821));
      color: var(--color-accent, #5b7cfa);
      border: 1px solid var(--color-accent, #5b7cfa);
      border-radius: var(--radius-input, 3px);
      padding: 6px 10px; font-weight: 600; font-size: 11px; cursor: pointer;
    }
    .pyne-agent-form button[type="submit"]:hover {
      background: color-mix(in srgb, var(--color-accent-hover, #4a6ae8) 32%, var(--color-bg-elev, #171821));
      border-color: var(--color-accent-hover, #4a6ae8);
      color: var(--color-accent-hover, #4a6ae8);
    }
    .pyne-agent-form button:disabled { opacity: 0.5; cursor: not-allowed; }
    .pyne-agent-legal {
      font-size: 9px; color: var(--color-text-faint, #6b7785);
      padding: 0 10px 6px; flex-shrink: 0;
    }

    /* Compact launcher — theme accent, standard radius, above bottom chrome */
    .pyne-agent-launch {
      position: fixed;
      z-index: 99998;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: var(--ui-control-h, 2em);
      min-height: 1.65em;
      padding: 0 0.65em;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.01em;
      cursor: pointer;
      color: var(--color-accent, #5b7cfa);
      background: color-mix(in srgb, var(--color-accent, #5b7cfa) 18%, var(--color-bg-elev, #171821));
      border: 1px solid var(--color-accent, #5b7cfa);
      border-radius: var(--radius-input, 3px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
      transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
    }
    .pyne-agent-launch:hover {
      background: color-mix(in srgb, var(--color-accent-hover, #4a6ae8) 28%, var(--color-bg-elev, #171821));
      border-color: var(--color-accent-hover, #4a6ae8);
      color: var(--color-accent-hover, #4a6ae8);
    }
    .pyne-agent-launch:focus-visible {
      outline: none;
      border-color: var(--color-accent, #5b7cfa);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent, #5b7cfa) 40%, transparent);
    }
    .pyne-agent-launch[aria-expanded="true"] {
      background: color-mix(in srgb, var(--color-accent, #5b7cfa) 28%, var(--color-bg-elev, #171821));
    }
    .pyne-agent-launch-dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--color-accent, #5b7cfa);
      flex-shrink: 0;
    }

    /* Floating modal shell (default position — not an AXIS panel) */
    .pyne-agent-float {
      position: fixed;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      min-width: ${MODAL_DEFAULT.minW}px;
      min-height: ${MODAL_DEFAULT.minH}px;
      box-sizing: border-box;
    }
    .pyne-agent-float .pyne-agent-root {
      flex: 1;
      min-height: 0;
      height: 100%;
    }
    .pyne-agent-resize {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      z-index: 2;
      touch-action: none;
    }
    .pyne-agent-resize::after {
      content: "";
      position: absolute;
      right: 3px;
      bottom: 3px;
      width: 8px;
      height: 8px;
      border-right: 2px solid var(--color-text-faint, #5c5f6e);
      border-bottom: 2px solid var(--color-text-faint, #5c5f6e);
      opacity: 0.85;
    }
    .pyne-agent-resize:hover::after {
      border-color: var(--color-accent, #5b7cfa);
    }
  `;
}

/**
 * Place the launcher at the bottom-right of the editor (or viewport),
 * sitting just above the editor status bar / app status bar.
 * @param {HTMLElement} btn
 */
function placeLauncher(btn) {
  const pad = 8;
  const editor =
    document.querySelector('[data-testid="axis-editor"]') ||
    document.querySelector(".axis-editor-statusbar")?.closest?.('[data-testid="axis-editor"]') ||
    document.querySelector(".axis-editor-statusbar")?.parentElement;

  if (editor && editor.getBoundingClientRect) {
    const er = editor.getBoundingClientRect();
    if (er.width > 40 && er.height > 40) {
      const status =
        editor.querySelector('[data-testid="axis-editor-stats"]') ||
        editor.querySelector(".axis-editor-statusbar");
      const statusH = status ? status.getBoundingClientRect().height : 0;
      // Bottom-right of editor, just above its status/action bar
      const bottom = Math.max(pad, window.innerHeight - er.bottom + statusH + pad);
      const right = Math.max(pad, window.innerWidth - er.right + pad);
      btn.style.bottom = `${Math.round(bottom)}px`;
      btn.style.right = `${Math.round(right)}px`;
      btn.style.left = "auto";
      btn.style.top = "auto";
      return;
    }
  }

  // Fallback: viewport bottom-right above app status bar
  const appBar = document.querySelector('[data-testid="axis-statusbar"]');
  let bottom = 40;
  if (appBar) {
    const r = appBar.getBoundingClientRect();
    bottom = Math.max(pad, window.innerHeight - r.top + pad);
  } else {
    // Theme token fallback when AXIS chrome is not present
    bottom = 48;
  }
  btn.style.bottom = `${Math.round(bottom)}px`;
  btn.style.right = `${pad}px`;
  btn.style.left = "auto";
  btn.style.top = "auto";
}

/**
 * Default modal position: bottom-right of the editor area (or viewport),
 * above bottom chrome — free float, not a dock panel.
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
function defaultModalGeometry() {
  const w = Math.min(MODAL_DEFAULT.w, Math.max(MODAL_DEFAULT.minW, window.innerWidth - 24));
  const h = Math.min(MODAL_DEFAULT.h, Math.max(MODAL_DEFAULT.minH, window.innerHeight - 80));
  const pad = 12;

  const editor = document.querySelector('[data-testid="axis-editor"]');
  if (editor) {
    const er = editor.getBoundingClientRect();
    if (er.width > 80 && er.height > 80) {
      const status =
        editor.querySelector('[data-testid="axis-editor-stats"]') ||
        editor.querySelector(".axis-editor-statusbar");
      const statusH = status ? status.getBoundingClientRect().height : 28;
      // Sit above the editor bottom bar, right-aligned within the editor
      let x = er.right - w - pad;
      let y = er.bottom - statusH - h - pad;
      x = Math.min(Math.max(8, x), window.innerWidth - w - 8);
      y = Math.min(Math.max(8, y), window.innerHeight - h - 8);
      return { x: Math.round(x), y: Math.round(y), w, h };
    }
  }

  const appBar = document.querySelector('[data-testid="axis-statusbar"]');
  const bottomReserve = appBar
    ? Math.max(36, window.innerHeight - appBar.getBoundingClientRect().top + 8)
    : 48;
  const x = Math.max(8, window.innerWidth - w - pad);
  const y = Math.max(8, window.innerHeight - h - bottomReserve);
  return { x: Math.round(x), y: Math.round(y), w, h };
}

/**
 * @param {HTMLElement} shell
 * @param {{ x: number, y: number, w: number, h: number }} geo
 */
function applyGeometry(shell, geo) {
  shell.style.left = `${geo.x}px`;
  shell.style.top = `${geo.y}px`;
  shell.style.width = `${geo.w}px`;
  shell.style.height = `${geo.h}px`;
  shell.style.right = "auto";
  shell.style.bottom = "auto";
}

/**
 * Wire header drag + corner resize on a floating shell.
 * @param {HTMLElement} shell
 * @param {HTMLElement} header
 * @param {HTMLElement} resizeEl
 * @param {{ x: number, y: number, w: number, h: number }} geo
 * @returns {() => void}
 */
function enableFloatChrome(shell, header, resizeEl, geo) {
  /** @type {{ mode: 'move' | 'resize', sx: number, sy: number, ox: number, oy: number, ow: number, oh: number } | null} */
  let drag = null;

  const onMove = (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.sx;
    const dy = ev.clientY - drag.sy;
    if (drag.mode === "move") {
      geo.x = Math.max(0, Math.min(window.innerWidth - 48, drag.ox + dx));
      geo.y = Math.max(0, Math.min(window.innerHeight - 40, drag.oy + dy));
    } else {
      geo.w = Math.max(MODAL_DEFAULT.minW, Math.min(window.innerWidth - geo.x - 8, drag.ow + dx));
      geo.h = Math.max(MODAL_DEFAULT.minH, Math.min(window.innerHeight - geo.y - 8, drag.oh + dy));
    }
    applyGeometry(shell, geo);
  };

  const onUp = () => {
    if (!drag) return;
    drag = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };

  const start = (mode, ev) => {
    if (ev.button != null && ev.button !== 0) return;
    // Don't start drag from header action buttons
    if (mode === "move" && ev.target instanceof Element) {
      if (ev.target.closest(".pyne-agent-header-btn")) return;
    }
    ev.preventDefault();
    drag = {
      mode,
      sx: ev.clientX,
      sy: ev.clientY,
      ox: geo.x,
      oy: geo.y,
      ow: geo.w,
      oh: geo.h,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = mode === "move" ? "grabbing" : "nwse-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onHeaderDown = (ev) => start("move", ev);
  const onResizeDown = (ev) => start("resize", ev);

  header.addEventListener("pointerdown", onHeaderDown);
  resizeEl.addEventListener("pointerdown", onResizeDown);

  return () => {
    onUp();
    header.removeEventListener("pointerdown", onHeaderDown);
    resizeEl.removeEventListener("pointerdown", onResizeDown);
  };
}

/** Extract title-ish name from Pine source for new tabs. */
function scriptNameFromPine(code) {
  const src = String(code || "");
  const m =
    src.match(/\b(?:indicator|strategy|library)\s*\(\s*["']([^"']+)["']/) ||
    src.match(/\/\/\s*@?\s*title\s*[:=]\s*(.+)/i);
  if (m?.[1]) {
    const name = m[1].trim().slice(0, 48);
    if (name) return name;
  }
  return "Agent script";
}

/** True when a fenced block looks like Pine / PYNE source. */
function looksLikePine(code, lang) {
  const l = String(lang || "").toLowerCase();
  if (/^(pine|pinescript|pine-script|pyne)$/.test(l)) return true;
  const s = String(code || "");
  return (
    /\/\/\s*@version\s*=\s*[56]/i.test(s) ||
    /\b(indicator|strategy|library)\s*\(/.test(s)
  );
}

/**
 * Split markdown-ish reply into prose + fenced code segments.
 * @returns {Array<{ type: 'text' | 'code', text?: string, code?: string, lang?: string }>}
 */
function parseReplySegments(text) {
  const raw = String(text || "");
  /** @type {Array<{ type: 'text' | 'code', text?: string, code?: string, lang?: string }>} */
  const parts = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      const prose = raw.slice(last, m.index).trim();
      if (prose) parts.push({ type: "text", text: prose });
    }
    const lang = String(m[1] || "").trim();
    const code = String(m[2] || "").replace(/\n$/, "");
    parts.push({ type: "code", code, lang });
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    const prose = raw.slice(last).trim();
    if (prose) parts.push({ type: "text", text: prose });
  }
  if (!parts.length && raw.trim()) {
    parts.push({ type: "text", text: raw.trim() });
  }
  return parts;
}

/** Light inline formatting: `code` → span (escape HTML). */
function fillProse(el, text) {
  el.textContent = "";
  const s = String(text || "");
  const re = /`([^`\n]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) el.appendChild(document.createTextNode(s.slice(last, m.index)));
    const code = document.createElement("code");
    code.className = "pyne-agent-inline-code";
    code.textContent = m[1];
    el.appendChild(code);
    last = m.index + m[0].length;
  }
  if (last < s.length) el.appendChild(document.createTextNode(s.slice(last)));
}

/**
 * Push Pine into AXIS editor via host API or CustomEvent bridge.
 * @param {'insert' | 'open'} mode
 * @param {string} code
 * @param {Record<string, unknown>} api
 * @param {string} [name]
 */
function deliverScript(mode, code, api, name) {
  const pine = String(code || "");
  if (!pine.trim()) throw new Error("empty script");
  const title = name || scriptNameFromPine(pine);

  if (mode === "insert") {
    if (typeof api?.insertScript === "function") {
      api.insertScript(pine);
      return "inserted";
    }
    if (typeof api?.setScript === "function") {
      api.setScript(pine);
      return "inserted";
    }
  } else {
    if (typeof api?.openScript === "function") {
      api.openScript(pine, { name: title });
      return "opened";
    }
    if (typeof api?.newScript === "function") {
      api.newScript(pine, { name: title });
      return "opened";
    }
    if (typeof api?.openNewScript === "function") {
      api.openNewScript(pine, title);
      return "opened";
    }
  }

  // AXIS host bridge (tabbed editor listens for these)
  const eventName =
    mode === "insert" ? "axis-agent-insert-script" : "axis-agent-open-script";
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(
      new CustomEvent(eventName, {
        detail: { code: pine, name: title, source: "pyne-agent" },
      })
    );
    return mode === "insert" ? "inserted" : "opened";
  }
  throw new Error("no editor host");
}

/**
 * Mount chat UI into a host element.
 * @param {HTMLElement} el
 * @param {Record<string, unknown>} api host API (optional insertScript, getConfig)
 * @param {Record<string, unknown>} [config]
 * @param {{ onClose?: () => void, floating?: boolean }} [opts]
 */
function mountChat(el, api, config, opts = {}) {
  injectStyles();
  el.innerHTML = "";
  el.classList.add("pyne-agent-host");

  const root = document.createElement("div");
  root.className = "pyne-agent-root";
  root.innerHTML = `
    <div class="pyne-agent-header" data-header>
      <div>
        <h3>PYNE Agent</h3>
        <small>Cloudflare® Workers AI™ · AXIS plugin</small>
      </div>
      <div class="pyne-agent-header-actions">
        <small class="pyne-agent-status" data-status role="status" aria-live="polite">
          <span class="pyne-agent-status-label">ready</span>
          <span class="pyne-agent-status-dots" aria-hidden="true"><span></span><span></span><span></span></span>
        </small>
        ${
          opts.onClose
            ? `<button type="button" class="pyne-agent-header-btn" data-close title="Close" aria-label="Close PYNE Agent">×</button>`
            : ""
        }
      </div>
    </div>
    <div class="pyne-agent-msgs" data-msgs></div>
    <form class="pyne-agent-form" data-form>
      <textarea data-input placeholder="Ask in natural language… e.g. RSI divergence strategy with ATR stops (v6)"></textarea>
      <button type="submit" data-send>Send</button>
    </form>
    <div class="pyne-agent-legal">
      Pine Script™ and TradingView® are trademarks of TradingView, Inc.
      Cloudflare® is a registered trademark of Cloudflare, Inc.
      Independent project — not affiliated with TradingView® or Cloudflare®.
    </div>
  `;
  el.appendChild(root);

  const msgs = root.querySelector("[data-msgs]");
  const form = root.querySelector("[data-form]");
  const input = root.querySelector("[data-input]");
  const sendBtn = root.querySelector("[data-send]");
  const status = root.querySelector("[data-status]");
  const statusLabel = status?.querySelector(".pyne-agent-status-label");
  const closeBtn = root.querySelector("[data-close]");

  if (closeBtn && opts.onClose) {
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      opts.onClose?.();
    });
  }

  let sessionId = null;
  let busy = false;

  function setStatus(t) {
    if (!status) return;
    const raw = String(t ?? "");
    // Normalize "thinking…" / "thinking..." → animated thinking state
    const thinking = /^\s*thinking[.…\s]*$/i.test(raw);
    status.classList.toggle("is-thinking", thinking);
    const label = thinking ? "thinking" : raw;
    if (statusLabel) statusLabel.textContent = label;
    else status.textContent = label;
    status.setAttribute("aria-busy", thinking ? "true" : "false");
  }

  /**
   * @param {string} code
   * @param {string} [lang]
   * @param {{ pineActions?: boolean }} [boxOpts]
   */
  function buildCodeBox(code, lang, boxOpts = {}) {
    const box = document.createElement("div");
    box.className = "pyne-agent-codebox";

    const bar = document.createElement("div");
    bar.className = "pyne-agent-codebox-bar";
    const langEl = document.createElement("span");
    langEl.className = "pyne-agent-codebox-lang";
    const isPine = looksLikePine(code, lang);
    langEl.textContent = isPine
      ? "pine"
      : String(lang || "code").trim() || "code";
    const meta = document.createElement("span");
    const lines = String(code).split("\n").length;
    meta.textContent = `${lines} line${lines === 1 ? "" : "s"}`;
    bar.appendChild(langEl);
    bar.appendChild(meta);
    box.appendChild(bar);

    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    box.appendChild(pre);

    const actions = document.createElement("div");
    actions.className = "pyne-agent-codebox-actions";

    if (boxOpts.pineActions !== false && isPine) {
      const insertBtn = document.createElement("button");
      insertBtn.type = "button";
      insertBtn.className = "is-primary";
      insertBtn.textContent = "Add to editor";
      insertBtn.title = "Replace the active editor tab with this script";
      insertBtn.addEventListener("click", () => {
        try {
          setStatus(deliverScript("insert", code, api));
        } catch {
          setStatus("insert failed");
        }
      });
      actions.appendChild(insertBtn);

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "Open in new script";
      openBtn.title = "Open this script in a new editor tab";
      openBtn.addEventListener("click", () => {
        try {
          setStatus(deliverScript("open", code, api));
        } catch {
          setStatus("open failed");
        }
      });
      actions.appendChild(openBtn);
    }

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        setStatus("copied");
      } catch {
        setStatus("copy failed");
      }
    });
    actions.appendChild(copyBtn);
    box.appendChild(actions);
    return box;
  }

  function addMsg(role, text, msgOpts = {}) {
    const div = document.createElement("div");
    div.className = `pyne-agent-msg ${msgOpts.error ? "error" : role}`;

    if (role !== "assistant" || msgOpts.error) {
      div.textContent = text;
      msgs.appendChild(div);
      msgs.scrollTop = msgs.scrollHeight;
      return;
    }

    // Formatted assistant reply: prose + monospace code boxes
    let segments = parseReplySegments(text);
    const pineExtra = msgOpts.pine ? String(msgOpts.pine).trim() : "";
    const hasPineFence = segments.some(
      (s) => s.type === "code" && looksLikePine(s.code, s.lang)
    );

    // If API returned extracted pine but the reply had no fence, attach a box
    if (pineExtra && !hasPineFence) {
      segments = [...segments, { type: "code", code: pineExtra, lang: "pine" }];
    }

    // Deduplicate: if fence body matches extracted pine, keep fence only
    if (pineExtra && hasPineFence) {
      /* already in segments */
    }

    if (!segments.length) {
      div.textContent = text || "(empty)";
    } else {
      for (const seg of segments) {
        if (seg.type === "text") {
          const p = document.createElement("div");
          p.className = "pyne-agent-prose";
          fillProse(p, seg.text || "");
          div.appendChild(p);
        } else if (seg.type === "code") {
          div.appendChild(buildCodeBox(seg.code || "", seg.lang || ""));
        }
      }
    }

    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  addMsg(
    "assistant",
    "Hi — describe the indicator or strategy you want in plain language. I use a private PYNE knowledge base (v5/v6 docs + open corpus) on Cloudflare®. I do not ship TradingView® built-in sources."
  );

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const text = String(input.value || "").trim();
    if (!text) return;

    const live = cfg({ ...cfg(api?.getConfig?.() || {}), ...(config || {}) });
    if (!live.endpoint) {
      addMsg("assistant", "Set plugin config: endpoint = your pyne-agent-worker HTTPS URL.", {
        error: true,
      });
      return;
    }

    busy = true;
    sendBtn.disabled = true;
    setStatus("thinking…");
    addMsg("user", text);
    input.value = "";

    try {
      const data = await agentFetch(
        live.endpoint,
        live.apiKey,
        "/v1/chat",
        {
          method: "POST",
          body: JSON.stringify({
            message: text,
            session_id: sessionId || undefined,
            pine_version: live.pineVersion,
            style: live.style,
          }),
        },
        api?.host?.fetch
      );
      sessionId = data.session_id || sessionId;
      addMsg("assistant", data.reply || "(empty)", { pine: data.pine || null });
      setStatus(data.model ? `ok · ${data.model}` : "ok");
    } catch (e) {
      addMsg("assistant", e instanceof Error ? e.message : String(e), { error: true });
      setStatus("error");
    } finally {
      busy = false;
      sendBtn.disabled = false;
    }
  });

  return () => {
    el.innerHTML = "";
  };
}

/**
 * Open a free-floating (non-panel) agent modal at the default position.
 * @param {Record<string, unknown>} api
 * @param {Record<string, unknown>} config
 * @param {{ onClosed?: () => void }} [modalOpts]
 * @returns {() => void} dispose / close (idempotent)
 */
function openFloatingModal(api, config, modalOpts = {}) {
  const existing = document.getElementById("pyne-agent-float-root");
  if (existing) {
    existing.remove();
  }

  injectStyles();
  const shell = document.createElement("div");
  shell.className = "pyne-agent-float";
  shell.id = "pyne-agent-float-root";
  shell.setAttribute("role", "dialog");
  shell.setAttribute("aria-label", "PYNE Agent");

  const geo = defaultModalGeometry();
  applyGeometry(shell, geo);

  const host = document.createElement("div");
  host.style.cssText = "flex:1;min-height:0;height:100%;display:flex;flex-direction:column;";
  shell.appendChild(host);

  const resizeEl = document.createElement("div");
  resizeEl.className = "pyne-agent-resize";
  resizeEl.title = "Resize";
  resizeEl.setAttribute("aria-hidden", "true");
  shell.appendChild(resizeEl);

  document.body.appendChild(shell);

  let closed = false;
  let chromeDispose = () => {};
  let unmount = () => {};

  const close = () => {
    if (closed) return;
    closed = true;
    chromeDispose();
    unmount();
    shell.remove();
    modalOpts.onClosed?.();
  };

  unmount = mountChat(host, api, config, { onClose: close, floating: true });
  const header = host.querySelector("[data-header]");
  if (header) {
    chromeDispose = enableFloatChrome(shell, header, resizeEl, geo);
  }

  return close;
}

/** Compact launcher above editor bottom bars when AXIS does not mount slots. */
function bootstrapFloating(config) {
  if (typeof document === "undefined") return () => {};
  if (document.getElementById("pyne-agent-fab")) return () => {};

  injectStyles();
  const fab = document.createElement("button");
  fab.className = "pyne-agent-launch";
  fab.type = "button";
  fab.id = "pyne-agent-fab";
  fab.setAttribute("aria-expanded", "false");
  fab.setAttribute("aria-haspopup", "dialog");
  fab.title = "Open PYNE Agent";
  fab.innerHTML = `<span class="pyne-agent-launch-dot" aria-hidden="true"></span><span>Agent</span>`;
  document.body.appendChild(fab);
  placeLauncher(fab);

  let closeModal = null;
  let moTimer = 0;

  const reposition = () => placeLauncher(fab);
  window.addEventListener("resize", reposition);

  // Re-place when editor dock/layout changes (throttled)
  let layoutObs = null;
  if (typeof MutationObserver !== "undefined") {
    layoutObs = new MutationObserver(() => {
      if (moTimer) return;
      moTimer = window.setTimeout(() => {
        moTimer = 0;
        reposition();
      }, 120);
    });
    layoutObs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  }

  fab.addEventListener("click", () => {
    if (closeModal) {
      closeModal();
      return;
    }
    closeModal = openFloatingModal(
      { getConfig: () => config || {} },
      config,
      {
        onClosed: () => {
          closeModal = null;
          fab.setAttribute("aria-expanded", "false");
        },
      }
    );
    fab.setAttribute("aria-expanded", "true");
  });

  return () => {
    if (closeModal) closeModal();
    window.removeEventListener("resize", reposition);
    if (moTimer) clearTimeout(moTimer);
    layoutObs?.disconnect();
    fab.remove();
  };
}

const plugin = {
  id: "pyne-agent",
  name: "PYNE Agent",
  kind: "component",
  version: "0.1.5",
  description:
    "Natural-language PYNE script authoring via Cloudflare® Workers AI™ and a private Vectorize™ knowledge base (v5/v6 docs + open corpus). AXIS sister plugin for HOOX / PYNE.",
  builtIn: false,
  capabilities: {
    needsNetwork: true,
    needsAuth: true,
  },
  configSchema: {
    endpoint: {
      type: "string",
      default: "",
      label: "Agent worker URL",
      description: "HTTPS origin of pyne-agent-worker (no trailing slash)",
      placeholder: "https://pyne-agent-worker.example.workers.dev",
    },
    apiKey: {
      type: "string",
      default: "",
      label: "API key",
      description: "X-API-Key / Bearer token for the worker",
      placeholder: "optional in local open mode",
    },
    pineVersion: {
      type: "select",
      default: "auto",
      label: "Language version preference",
      options: ["auto", "v5", "v6"],
    },
    style: {
      type: "select",
      default: "auto",
      label: "Script kind preference",
      options: ["auto", "indicator", "strategy", "library"],
    },
  },
  slots: ["manager-tab", "topbar-action", "settings-section"],

  /**
   * @param {string} slot
   * @param {HTMLElement} el
   * @param {Record<string, unknown>} api
   */
  mount(slot, el, api) {
    const config = {
      ...(api?.getConfig?.() || {}),
    };
    if (slot === "topbar-action") {
      el.innerHTML = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pyne-agent-launch";
      btn.style.position = "static";
      btn.style.boxShadow = "none";
      btn.innerHTML = `<span class="pyne-agent-launch-dot" aria-hidden="true"></span><span>Agent</span>`;
      btn.title = "Open PYNE Agent chat";
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-haspopup", "dialog");
      injectStyles();
      let closeModal = null;
      btn.addEventListener("click", () => {
        if (closeModal) {
          closeModal();
          return;
        }
        closeModal = openFloatingModal(api, config, {
          onClosed: () => {
            closeModal = null;
            btn.setAttribute("aria-expanded", "false");
          },
        });
        btn.setAttribute("aria-expanded", "true");
      });
      el.appendChild(btn);
      return () => {
        if (closeModal) closeModal();
        el.innerHTML = "";
      };
    }
    // manager-tab / settings-section → full chat (embedded, no float chrome)
    return mountChat(el, api, config);
  },

  async init(ctx) {
    const config = ctx?.getConfig?.() || {};
    // If AXIS never calls mount (component phase 2), still offer a compact launcher.
    if (typeof document !== "undefined" && !config.disableFloating) {
      this._floatDispose = bootstrapFloating(config);
    }
    ctx?.setStatus?.("PYNE Agent ready", "info");
  },

  async dispose() {
    try {
      this._floatDispose?.();
    } catch {
      /* ignore */
    }
  },
};

export default plugin;
export {
  plugin,
  mountChat,
  openFloatingModal,
  parseReplySegments,
  looksLikePine,
  scriptNameFromPine,
  deliverScript,
};
