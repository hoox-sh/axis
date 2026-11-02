// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AXIS dynamic plugin — PYNE natural-language agent (Cloudflare® Worker).
//
// Install in AXIS → Manager → Plugins → Install from URL:
//   https://<your-worker>/plugin/axis-pine-agent.js
//
// Contract namespace: pynescript.axis.plugins.v1
// Kind: component. Slot: panel.
// AXIS mounts this into the Agent dock panel (FloatableShell). The chat
// fills that body. One file, no imports — the loader's blob fallback
// cannot resolve sibling modules.
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

const DEFAULT_ENDPOINT = "";

/** Workers AI™ validate retries can run for minutes. Shorter aborts look like failure. */
const CHAT_TIMEOUT_MS = 180000;

/**
 * Plugin config. A non-http(s) endpoint becomes "" so the API key is never
 * sent to a relative or unexpected origin.
 */
const PYNE_BACKENDS = ["auto", "pro", "local", "worker", "container", "none"];

/** Named PYNE host. Request sends a kind, never a URL. */
function normalizePyneBackend(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return PYNE_BACKENDS.includes(s) ? s : "auto";
}

function cfg(config) {
  const c = config || {};
  return {
    endpoint: normalizeEndpoint(c.endpoint || DEFAULT_ENDPOINT),
    apiKey: String(c.apiKey || c.api_key || "").trim(),
    pineVersion: String(c.pineVersion || c.pine_version || "auto").trim() || "auto",
    style: String(c.style || "auto").trim() || "auto",
    persona: String(c.persona || "auto").trim() || "auto",
    pyneBackend: normalizePyneBackend(c.pyneBackend || c.pyne_backend),
  };
}

/**
 * POST /v1/chat body. Plugin UI always orchestrates; pyne_backend is a kind.
 * @param {ReturnType<typeof cfg>} live
 * @param {string} text
 * @param {string | null} [sessionId]
 */
function buildChatBody(live, text, sessionId) {
  return {
    message: text,
    session_id: sessionId || undefined,
    pine_version: live.pineVersion,
    style: live.style,
    persona: live.persona,
    pyne_backend: live.pyneBackend,
    orchestrate: true,
  };
}

function normalizeEndpoint(raw) {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.host) return "";
  } catch {
    return "";
  }
  return s;
}

function explainEndpoint(raw) {
  const s = String(raw ?? "").trim();
  if (s && !normalizeEndpoint(s)) return "Endpoint must be an http:// or https:// URL.";
  return "Set plugin config: endpoint = your pyne-agent-worker HTTPS URL.";
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

const PLUGIN_UI_VERSION = "0.1.9";

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
    .pyne-agent-host {
      display: flex; flex-direction: column; height: 100%; min-height: 0;
    }
    .pyne-agent-root {
      display: flex; flex-direction: column; height: 100%; min-height: 0; flex: 1;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: var(--ui-font-base, 13px);
      color: var(--color-text, #e8eaee);
      background: transparent;
      overflow: hidden;
    }
    .pyne-agent-meta {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--color-border-soft, #151922);
      background: color-mix(in srgb, var(--color-bg-elev, #10131b) 70%, var(--color-bg-base, #07080c));
      flex-shrink: 0;
    }
    .pyne-agent-chip {
      display: inline-flex; align-items: center; gap: 4px;
      height: 18px; padding: 0 7px;
      font-size: 10px; font-weight: 600; letter-spacing: 0.02em;
      color: var(--color-text-dim, #9aa3b2);
      background: var(--color-bg-hover, #161a24);
      border: 1px solid var(--color-border, #1c2230);
      border-radius: 999px;
      line-height: 1;
      max-width: 42%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pyne-agent-chip.is-on {
      color: var(--color-accent, #8b9cff);
      border-color: color-mix(in srgb, var(--color-accent, #8b9cff) 45%, var(--color-border, #1c2230));
      background: color-mix(in srgb, var(--color-accent, #8b9cff) 12%, var(--color-bg-elev, #10131b));
    }
    .pyne-agent-chip kbd {
      font: inherit; font-weight: 650; color: inherit;
    }
    .pyne-agent-status {
      display: inline-flex; align-items: center; gap: 5px;
      color: var(--color-text-dim, #9aa3b2); font-size: 10px;
      min-height: 1.2em;
      margin-left: auto;
      max-width: 52%;
      overflow: hidden;
    }
    .pyne-agent-status.is-thinking {
      color: var(--color-accent, #8b9cff);
    }
    .pyne-agent-status-label {
      line-height: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pyne-agent-status-dots {
      display: none;
      align-items: center;
      gap: 3px;
      height: 10px;
    }
    .pyne-agent-status.is-thinking .pyne-agent-status-dots { display: inline-flex; }
    .pyne-agent-status-dots span {
      width: 4px; height: 4px; border-radius: 50%;
      background: var(--color-accent, #8b9cff);
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
    .pyne-agent-msgs {
      flex: 1; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
      min-height: 0;
    }
    .pyne-agent-msg {
      max-width: 96%; padding: 8px 10px; border-radius: var(--radius-input, 4px);
      font-size: 12px; line-height: 1.5;
      word-break: break-word;
    }
    .pyne-agent-msg.user {
      align-self: flex-end;
      white-space: pre-wrap;
      background: color-mix(in srgb, var(--color-accent, #8b9cff) 22%, var(--color-bg-elev, #10131b));
      border: 1px solid color-mix(in srgb, var(--color-accent, #8b9cff) 35%, transparent);
      color: var(--color-text, #e8eaee);
    }
    .pyne-agent-msg.assistant {
      align-self: stretch;
      max-width: 100%;
      background: var(--color-bg-elev, #10131b);
      border: 1px solid var(--color-border-soft, #151922);
      border-left: 2px solid color-mix(in srgb, var(--color-accent, #8b9cff) 55%, var(--color-border, #1c2230));
    }
    .pyne-agent-msg.error {
      align-self: stretch;
      white-space: pre-wrap;
      background: color-mix(in srgb, var(--color-red, #7f1d1d) 18%, var(--color-bg-panel, #3a1515));
      border: 1px solid color-mix(in srgb, var(--color-red, #7f1d1d) 55%, transparent);
      color: var(--color-red, #fecaca);
    }
    .pyne-agent-prose {
      margin: 0 0 8px;
    }
    .pyne-agent-prose:last-child { margin-bottom: 0; }
    .pyne-agent-prose p { margin: 0 0 6px; }
    .pyne-agent-prose p:last-child { margin-bottom: 0; }
    .pyne-agent-prose h3, .pyne-agent-prose h4 {
      margin: 8px 0 4px; font-size: 12px; font-weight: 650;
    }
    .pyne-agent-prose ol, .pyne-agent-prose ul {
      margin: 4px 0 8px; padding-left: 1.25em;
    }
    .pyne-agent-prose li { margin: 2px 0; }
    .pyne-agent-prose strong { font-weight: 650; }
    .pyne-agent-codebox {
      margin: 8px 0 0;
      border: 1px solid var(--color-border, #3a3d4a);
      border-radius: var(--radius-input, 4px);
      background: var(--color-bg-base, #0a0b10);
      overflow: hidden;
    }
    .pyne-agent-codebox:first-child { margin-top: 0; }
    .pyne-agent-codebox-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 6px;
      padding: 4px 8px;
      background: color-mix(in srgb, var(--color-bg-elev, #10131b) 80%, var(--color-bg-base, #0a0b10));
      border-bottom: 1px solid var(--color-border-soft, #252730);
      font-size: 10px;
      color: var(--color-text-dim, #8b8e9c);
      user-select: none;
    }
    .pyne-agent-codebox-lang {
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--color-accent, #8b9cff);
    }
    .pyne-agent-codebox pre {
      margin: 0;
      padding: 8px 10px;
      max-height: min(220px, 42%);
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
      background: var(--color-bg-elev, #10131b);
    }
    .pyne-agent-codebox-actions button {
      background: var(--color-bg-hover, #22232e);
      color: var(--color-text, #e8eaee);
      border: 1px solid var(--color-border, #3a4a5c);
      border-radius: var(--radius-input, 4px);
      padding: 3px 8px; font-size: 10.5px; font-weight: 500; cursor: pointer;
      line-height: 1.3;
    }
    .pyne-agent-codebox-actions button:hover {
      border-color: var(--color-accent, #8b9cff);
      color: var(--color-accent, #8b9cff);
    }
    .pyne-agent-codebox-actions button:focus-visible,
    .pyne-agent-form button[type="submit"]:focus-visible {
      outline: none;
      border-color: var(--color-accent, #8b9cff);
    }
    .pyne-agent-codebox-actions button.is-primary {
      background: color-mix(in srgb, var(--color-accent, #8b9cff) 18%, var(--color-bg-elev, #10131b));
      border-color: var(--color-accent, #8b9cff);
      color: var(--color-accent, #8b9cff);
    }
    .pyne-agent-codebox-actions button.is-primary:hover {
      background: color-mix(in srgb, var(--color-accent-hover, #7488f0) 28%, var(--color-bg-elev, #10131b));
      border-color: var(--color-accent-hover, #7488f0);
      color: var(--color-accent-hover, #7488f0);
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
      display: flex; flex-direction: column; gap: 6px; padding: 8px 12px 6px;
      border-top: 1px solid var(--color-border-soft, #151922);
      background: var(--color-bg-elev, #10131b);
      flex-shrink: 0;
    }
    .pyne-agent-form textarea {
      flex: 1; resize: none; min-height: 44px; max-height: 96px; width: 100%;
      background: var(--color-bg-base, #07080c);
      color: var(--color-text, #e8eaee);
      border: 1px solid var(--color-border, #1c2230);
      border-radius: var(--radius-input, 4px);
      padding: 8px 10px; font: inherit; font-size: 12px;
    }
    .pyne-agent-form textarea:focus {
      outline: none;
      border-color: var(--color-accent, #8b9cff);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent, #8b9cff) 35%, transparent);
    }
    .pyne-agent-composer-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .pyne-agent-hint {
      font-size: 10px; color: var(--color-text-faint, #6b7382);
      letter-spacing: 0.02em;
    }
    .pyne-agent-form button[type="submit"] {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-height: var(--ui-control-h, 28px);
      background: color-mix(in srgb, var(--color-accent, #8b9cff) 18%, var(--color-bg-elev, #10131b));
      color: var(--color-accent, #8b9cff);
      border: 1px solid var(--color-accent, #8b9cff);
      border-radius: var(--radius-input, 4px);
      padding: 0 12px; font-weight: 650; font-size: 11px; cursor: pointer;
      letter-spacing: 0.02em;
    }
    .pyne-agent-form button[type="submit"]:hover {
      background: color-mix(in srgb, var(--color-accent-hover, #7488f0) 28%, var(--color-bg-elev, #10131b));
      border-color: var(--color-accent-hover, #7488f0);
      color: var(--color-accent-hover, #7488f0);
    }
    .pyne-agent-form button:disabled { opacity: 0.5; cursor: not-allowed; }
    .pyne-agent-legal {
      font-size: 9px; color: var(--color-text-faint, #6b7382);
      padding: 0 12px 8px; flex-shrink: 0;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    @media (max-width: 420px) {
      .pyne-agent-status { max-width: 46%; }
      .pyne-agent-form textarea { min-height: 40px; font-size: 16px; }
      .pyne-agent-form button[type="submit"] { min-height: 36px; min-width: 64px; }
      .pyne-agent-chip { max-width: 46%; }
    }
  `;
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

/** Drop a trailing `_Validation:` / `_Note:` footnote. Underscores are not italics here. */
function splitValidationNote(text) {
  const raw = String(text || "");
  const m = raw.match(/\n+_(?:Validation|Note):\s*([\s\S]*?)_\s*$/i);
  if (!m) return { text: raw.trim(), note: "" };
  return {
    text: raw.slice(0, m.index).trim(),
    note: String(m[1] || "").replace(/\s*\.$/, "").trim(),
  };
}

function stripValidationNotes(text) {
  return splitValidationNote(text).text;
}

/**
 * Status + plain-text validation line for one chat reply.
 * @param {string} reply
 * @param {Record<string, unknown> | null | undefined} validation
 */
function presentReply(reply, validation) {
  const split = splitValidationNote(reply);
  const v = validation && typeof validation === "object" ? validation : null;
  if (v && v.available && !v.skipped) {
    if (v.validated) return { text: split.text, status: "validated", detail: "" };
    const last = v.last && typeof v.last === "object" ? v.last : {};
    const err = String(last.error || last.reason || split.note || "").trim();
    const line = err ? `Validation failed: ${err}` : "Validation failed.";
    const head = err.slice(0, Math.min(48, err.length));
    const already = Boolean(head) && split.text.includes(head);
    return {
      text: already ? split.text : split.text ? `${split.text}\n\n${line}` : line,
      status: "validation failed",
      detail: err,
    };
  }
  // Misconfigured backend: the worker appends `_Note: …` and skips validation.
  if (split.note && !/not configured/i.test(split.note)) {
    return {
      text: split.text ? `${split.text}\n\n${split.note}` : split.note,
      status: "",
      detail: "",
    };
  }
  return { text: split.text, status: "", detail: "" };
}

function isNetworkError(e) {
  if (typeof TypeError !== "undefined" && e instanceof TypeError) return true;
  const msg = e instanceof Error ? e.message : String(e || "");
  return /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
}

/** @param {unknown} e */
function describeChatError(e) {
  const msg = e instanceof Error ? e.message : String(e || "");
  if (/session not found/i.test(msg)) {
    return {
      kind: "session",
      text: "Session expired. Send again to start a new one.",
      status: "session expired",
    };
  }
  if (isNetworkError(e)) {
    return {
      kind: "network",
      text: "Could not reach the agent worker (check the endpoint and that this origin is allowed).",
      status: "offline",
    };
  }
  const name = e && typeof e === "object" && "name" in e ? String(e.name) : "";
  if (name === "AbortError") {
    return {
      kind: "timeout",
      text: "The agent timed out. Try a shorter request.",
      status: "timed out",
    };
  }
  return { kind: "error", text: msg || "Request failed", status: "error" };
}

function shortModel(model) {
  const tail = String(model || "").split("/").filter(Boolean).pop() || String(model || "");
  return tail.length > 18 ? `${tail.slice(0, 16)}…` : tail;
}

function shortBackend(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "pyne-worker" || s === "worker") return "worker";
  if (s === "pyne-pro" || s === "pro") return "pro";
  if (s === "pyne-local" || s === "local") return "local";
  if (s === "pyne-container" || s === "container") return "container";
  if (s === "axis-mcp" || s === "axis") return "axis";
  if (s === "heuristic") return "lint";
  if (s === "none") return "";
  return s && s !== "auto" ? s : "";
}

function chipLabel(kind, value) {
  const v = String(value || "auto");
  return `${kind} ${v}`;
}

function deliveryStatus(result) {
  if (result === "inserted") return "Added to editor";
  if (result === "opened") return "Opened in a new tab";
  return String(result || "");
}

/** Inline `code` + **bold**. */
function appendInline(el, text) {
  const s = String(text || "");
  const re = /(`[^`\n]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) el.appendChild(document.createTextNode(s.slice(last, m.index)));
    const tok = m[1];
    if (tok.startsWith("`")) {
      const code = document.createElement("code");
      code.className = "pyne-agent-inline-code";
      code.textContent = tok.slice(1, -1);
      el.appendChild(code);
    } else {
      const strong = document.createElement("strong");
      strong.textContent = tok.slice(2, -2);
      el.appendChild(strong);
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) el.appendChild(document.createTextNode(s.slice(last)));
}

/**
 * Render compact markdown (paragraphs, lists, **bold**, `code`, ### headings).
 * Avoids dumping raw ### / 1. **Foo** into the AXIS chat pane.
 */
function fillProse(el, text) {
  el.textContent = "";
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const flushPara = (buf) => {
    const t = buf.join(" ").trim();
    if (!t) return;
    const p = document.createElement("p");
    appendInline(p, t);
    el.appendChild(p);
  };
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      const h = document.createElement("h3");
      appendInline(h, heading[1]);
      el.appendChild(h);
      i += 1;
      continue;
    }
    const ol = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    const ul = trimmed.match(/^[-*]\s+(.+)$/);
    if (ol || ul) {
      const list = document.createElement(ol ? "ol" : "ul");
      if (ol) list.start = Number(ol[1]);
      while (i < lines.length) {
        const t = lines[i].trim();
        const om = t.match(/^(\d+)[.)]\s+(.+)$/);
        const um = t.match(/^[-*]\s+(.+)$/);
        if (ol && om) {
          const li = document.createElement("li");
          appendInline(li, om[2]);
          list.appendChild(li);
        } else if (ul && um) {
          const li = document.createElement("li");
          appendInline(li, um[1]);
          list.appendChild(li);
        } else if (!t) {
          break;
        } else {
          break;
        }
        i += 1;
      }
      el.appendChild(list);
      continue;
    }
    const buf = [trimmed];
    i += 1;
    while (i < lines.length) {
      const n = lines[i].trim();
      if (!n || /^#{1,4}\s/.test(n) || /^\d+[.)]\s/.test(n) || /^[-*]\s/.test(n)) break;
      buf.push(n);
      i += 1;
    }
    flushPara(buf);
  }
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

  // AXIS host bridge. The editor listens only while its panel is mounted.
  const eventName =
    mode === "insert" ? "axis-agent-insert-script" : "axis-agent-open-script";
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    const editorOpen =
      typeof document !== "undefined" &&
      typeof document.querySelector === "function" &&
      document.querySelector('[data-testid="axis-editor"]');
    if (!editorOpen) throw new Error("editor closed");
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
 * Mount chat UI into a panel body. The host panel owns the title and close.
 * @param {HTMLElement} el
 * @param {Record<string, unknown>} api host API (optional insertScript, getConfig)
 * @param {Record<string, unknown>} [config]
 */
function mountChat(el, api, config) {
  injectStyles();
  el.innerHTML = "";
  el.classList.add("pyne-agent-host");

  const root = document.createElement("div");
  root.className = "pyne-agent-root";
  root.innerHTML = `
    <div class="pyne-agent-meta" data-meta>
      <span class="pyne-agent-chip" data-chip-persona>${chipLabel("persona", "auto")}</span>
      <span class="pyne-agent-chip" data-chip-backend>${chipLabel("backend", "auto")}</span>
      <span class="pyne-agent-chip is-on" title="Plugin always sends orchestrate:true">orchestrate</span>
      <small class="pyne-agent-status" data-status role="status" aria-live="polite">
        <span class="pyne-agent-status-label">ready</span>
        <span class="pyne-agent-status-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      </small>
    </div>
    <div class="pyne-agent-msgs" data-msgs aria-live="polite"></div>
    <form class="pyne-agent-form" data-form>
      <textarea data-input aria-label="Message" placeholder="Ask in natural language… e.g. RSI divergence strategy with ATR stops (v6)"></textarea>
      <div class="pyne-agent-composer-bar">
        <span class="pyne-agent-hint">Ctrl+Enter</span>
        <button type="submit" data-send title="Send (Ctrl+Enter)">Send</button>
      </div>
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
  const chipPersona = root.querySelector("[data-chip-persona]");
  const chipBackend = root.querySelector("[data-chip-backend]");

  function liveCfg() {
    return cfg({ ...(config || {}), ...(api?.getConfig?.() || {}) });
  }

  function paintMeta(live) {
    if (chipPersona) chipPersona.textContent = chipLabel("persona", live.persona);
    if (chipBackend) chipBackend.textContent = chipLabel("backend", live.pyneBackend);
  }
  paintMeta(liveCfg());

  let sessionId = null;
  let busy = false;
  let alive = true;
  /** @type {AbortController | null} */
  let inflight = null;
  let copyTimer = 0;

  function setStatus(t, title) {
    if (!status) return;
    const raw = String(t ?? "");
    const thinking = /^\s*thinking[.…\s]*$/i.test(raw);
    status.classList.toggle("is-thinking", thinking);
    const label = thinking ? "thinking" : raw;
    if (statusLabel) statusLabel.textContent = label;
    else status.textContent = label;
    status.setAttribute("aria-busy", thinking ? "true" : "false");
    if (title) status.title = String(title);
    else status.removeAttribute("title");
  }

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });

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
          if (typeof window.confirm === "function") {
            const ok = window.confirm("Replace the active editor tab with this script?");
            if (!ok) return;
          }
          setStatus(deliveryStatus(deliverScript("insert", code, api)));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          setStatus(msg === "editor closed" ? "Open the editor first" : "insert failed");
        }
      });
      actions.appendChild(insertBtn);

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "Open in new script";
      openBtn.title = "Open this script in a new editor tab";
      openBtn.addEventListener("click", () => {
        try {
          setStatus(deliveryStatus(deliverScript("open", code, api)));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          setStatus(msg === "editor closed" ? "Open the editor first" : "open failed");
        }
      });
      actions.appendChild(openBtn);
    }

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      const prevLabel = statusLabel?.textContent || "ready";
      const prevTitle = status?.getAttribute("title") || "";
      try {
        await navigator.clipboard.writeText(code);
        setStatus("copied");
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = window.setTimeout(() => {
          copyTimer = 0;
          if (!alive) return;
          if (statusLabel?.textContent === "copied") setStatus(prevLabel, prevTitle);
        }, 1600);
      } catch {
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(codeEl);
          sel?.removeAllRanges();
          sel?.addRange(range);
        } catch {
          /* selection is best-effort */
        }
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

    let segments = parseReplySegments(text);
    const pineExtra = msgOpts.pine ? String(msgOpts.pine).trim() : "";
    const hasPineFence = segments.some(
      (s) => s.type === "code" && looksLikePine(s.code, s.lang)
    );

    // Extracted pine with no fence in the reply still needs a code box.
    if (pineExtra && !hasPineFence) {
      segments = [...segments, { type: "code", code: pineExtra, lang: "pine" }];
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
    "Hi — describe the indicator or strategy in plain language. I write Pine Script™ v6 for PYNE / AXIS, parse-lint-eval on the backend you pick (auto, Pro, local, worker, container). Private knowledge base on Cloudflare®. I do not ship TradingView® built-in sources."
  );

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const text = String(input.value || "").trim();
    if (!text) return;

    const merged = { ...(config || {}), ...(api?.getConfig?.() || {}) };
    const live = liveCfg();
    paintMeta(live);
    if (!live.endpoint) {
      addMsg("assistant", explainEndpoint(merged.endpoint), { error: true });
      return;
    }

    busy = true;
    sendBtn.disabled = true;
    setStatus("thinking…");
    addMsg("user", text);
    input.value = "";

    const ac = new AbortController();
    inflight = ac;
    const timer = window.setTimeout(() => ac.abort(), CHAT_TIMEOUT_MS);

    try {
      const data = await agentFetch(
        live.endpoint,
        live.apiKey,
        "/v1/chat",
        {
          method: "POST",
          signal: ac.signal,
          body: JSON.stringify(buildChatBody(live, text, sessionId)),
        },
        api?.host?.fetch
      );
      if (!alive) return;
      sessionId = data.session_id || sessionId;
      const presented = presentReply(data.reply || "", data.validation);
      const pine = data.pine ? String(data.pine) : "";
      const body = presented.text || (pine ? "" : "(empty)");
      addMsg("assistant", body, { pine: pine || null });
      const model = data.model ? String(data.model) : "";
      const last = data.validation && typeof data.validation === "object" ? data.validation.last : null;
      const backend = shortBackend(
        (last && typeof last === "object" && last.backend) || data.validation?.backend
      );
      const bits = [presented.status || "ok", shortModel(model), backend].filter(Boolean);
      const label = bits.join(" · ");
      const title = [model, backend && `backend ${backend}`, presented.detail]
        .filter(Boolean)
        .join(" — ");
      setStatus(label, title);
    } catch (e) {
      if (!alive) return;
      const info = ac.signal.aborted
        ? describeChatError(Object.assign(new Error("aborted"), { name: "AbortError" }))
        : describeChatError(e);
      if (info.kind === "session") sessionId = null;
      addMsg("assistant", info.text, { error: true });
      setStatus(info.status);
    } finally {
      clearTimeout(timer);
      if (inflight === ac) inflight = null;
      if (!alive) return;
      busy = false;
      sendBtn.disabled = false;
    }
  });

  return () => {
    alive = false;
    if (copyTimer) clearTimeout(copyTimer);
    inflight?.abort();
    el.innerHTML = "";
  };
}


const plugin = {
  id: "pyne-agent",
  name: "PYNE Agent",
  kind: "component",
  version: "0.1.9",
  description:
    "Natural-language PYNE script authoring via Cloudflare® Workers AI™ and a private Vectorize™ knowledge base (v5/v6 docs + open corpus). Always orchestrates; selectable PYNE backend (auto / Pro / local / worker / container). AXIS sister plugin for HOOX / PYNE.",
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
      type: "password",
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
    persona: {
      type: "select",
      default: "auto",
      label: "Persona",
      description: "Pine coder, AXIS operator (changes the app via MCP), or trader",
      options: ["auto", "pine", "axis", "trader"],
    },
    pyneBackend: {
      type: "select",
      default: "auto",
      label: "PYNE backend",
      description:
        "Where parse/lint/eval run. auto = first configured host. Kinds only — not a URL.",
      options: ["auto", "pro", "local", "worker", "container", "none"],
    },
  },
  slots: ["panel"],

  /**
   * Fill the Agent panel body. Closing the panel runs the returned disposer,
   * which aborts an in-flight chat.
   * @param {string} _slot
   * @param {HTMLElement} el
   * @param {Record<string, unknown>} api
   */
  mount(_slot, el, api) {
    return mountChat(el, api, api?.getConfig?.() || {});
  },

  async init(ctx) {
    ctx?.setStatus?.("PYNE Agent ready", "info");
  },
};

export default plugin;
export {
  plugin,
  mountChat,
  parseReplySegments,
  looksLikePine,
  scriptNameFromPine,
  deliverScript,
  cfg,
  explainEndpoint,
  presentReply,
  stripValidationNotes,
  describeChatError,
  normalizePyneBackend,
  buildChatBody,
  shortBackend,
  PYNE_BACKENDS,
  PLUGIN_UI_VERSION,
};
