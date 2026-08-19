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
 * Persisted **editor intelligence** prefs — pre-eval / lint, hover cards,
 * signature hints, autocomplete, diagnostic marks, inline chips.
 *
 * Defaults match prior hardcoded AXIS behavior. Settings → Editor writes
 * this bag; editor modules read via {@link readEditorIntel}.
 *
 * @module editor/editor-intel
 */

/** Timing clamps (ms) — keep idle lint snappy without mid-token noise. */
export const INTEL_IDLE_MS_MIN = 200;
export const INTEL_IDLE_MS_MAX = 3_000;
export const INTEL_HOVER_MS_MIN = 50;
export const INTEL_HOVER_MS_MAX = 1_000;
export const INTEL_TIMEOUT_MS_MIN = 200;
export const INTEL_TIMEOUT_MS_MAX = 8_000;
export const INTEL_TAB_SWITCH_MS_MIN = 0;
export const INTEL_TAB_SWITCH_MS_MAX = 1_000;
export const INTEL_MAX_OPTIONS_MIN = 8;
export const INTEL_MAX_OPTIONS_MAX = 128;

/**
 * Default idle window after the last keystroke before pre-eval runs.
 * 1s: underlines appear after a pause, not mid-token. Tab-switch uses
 * {@link EditorIntelSettings.preevalTabSwitchMs} (shorter).
 */
export const DEFAULT_PREEVAL_IDLE_MS = 1_000;

export type EditorIntelSettings = {
  /** Master: schedule idle / Save / Run pre-eval at all. */
  preevalEnabled: boolean;
  /** Quiet time after last keystroke before idle lint (ms). */
  preevalIdleMs: number;
  /** Lint shortly after switching editor tabs (ms). */
  preevalTabSwitchMs: number;
  /** Wipe underlines on each keystroke (avoids mid-token noise). */
  preevalClearOnEdit: boolean;
  /** Client structural checks (brackets, strings, entry point). */
  preevalLocal: boolean;
  /** Merge Pro API `POST /lsp/diagnostics` when Backend URL is up. */
  preevalRemote: boolean;
  /** Flag unknown `ta.*` / bare-call typos (`plt()`). */
  preevalTypos: boolean;
  /** Warn when `//@version=` is missing. */
  preevalVersionWarn: boolean;
  /** Warn on v3 `study()`. */
  preevalStudyWarn: boolean;
  /** Warn on bare `security()` (prefer `request.security`). */
  preevalSecurityWarn: boolean;
  /** Warn on a second `indicator()` / `strategy()` / `library()`. */
  preevalDuplicateDecl: boolean;
  /** Severity **error** disables Run (typos never block). */
  preevalBlockRun: boolean;

  /** Wavy / dotted underlines + line tint. */
  diagUnderlines: boolean;
  /** Left gutter dots / triangles. */
  diagGutter: boolean;
  /** Tooltip when the cursor rests on a mark. */
  diagHover: boolean;
  diagErrors: boolean;
  diagWarnings: boolean;
  diagTypos: boolean;
  diagInfo: boolean;

  /** Builtin / symbol hover cards. */
  hoverEnabled: boolean;
  /** CodeMirror hover delay before the card opens (ms). */
  hoverTimeMs: number;
  /** Ask Pro API `/lsp/hover` (falls back to local). */
  hoverRemote: boolean;
  /** In-call parameter checklist under the cursor. */
  signatureHints: boolean;

  /** Completions (typing + ⌘/Ctrl-Space). */
  autocompleteEnabled: boolean;
  /** Open the list while typing (off = trigger only). */
  activateOnTyping: boolean;
  /** Named remaining / used parameters inside a call. */
  paramCompletions: boolean;
  /** `plot.style_*` / `shape.*` / `size.*` value lists. */
  enumCompletions: boolean;
  /** Merge Pro API `/lsp/completion` items. */
  remoteCompletions: boolean;
  /** Cap the rendered suggestion list. */
  maxRenderedOptions: number;

  /** Master: use Backend URL for hover / complete / diagnostics. */
  remoteLspEnabled: boolean;
  hoverTimeoutMs: number;
  completionTimeoutMs: number;
  diagnosticsTimeoutMs: number;

  /** Hex / `color.*` swatches in the buffer. */
  colorChips: boolean;
  /** End-of-line debug chips (also needs `inlineDebugEnabled`). */
  inlineChips: boolean;
  /** Pin gutter for bar_index / time logs (also needs `debugPinsEnabled`). */
  inlinePinGutter: boolean;
};

export const DEFAULT_EDITOR_INTEL: EditorIntelSettings = {
  preevalEnabled: true,
  preevalIdleMs: DEFAULT_PREEVAL_IDLE_MS,
  preevalTabSwitchMs: 200,
  preevalClearOnEdit: true,
  preevalLocal: true,
  preevalRemote: true,
  preevalTypos: true,
  preevalVersionWarn: true,
  preevalStudyWarn: true,
  preevalSecurityWarn: true,
  preevalDuplicateDecl: true,
  preevalBlockRun: true,

  diagUnderlines: true,
  diagGutter: true,
  diagHover: true,
  diagErrors: true,
  diagWarnings: true,
  diagTypos: true,
  diagInfo: true,

  hoverEnabled: true,
  hoverTimeMs: 250,
  hoverRemote: true,
  signatureHints: true,

  autocompleteEnabled: true,
  activateOnTyping: true,
  paramCompletions: true,
  enumCompletions: true,
  remoteCompletions: true,
  maxRenderedOptions: 64,

  remoteLspEnabled: true,
  hoverTimeoutMs: 700,
  completionTimeoutMs: 1_200,
  diagnosticsTimeoutMs: 2_000,

  colorChips: true,
  inlineChips: true,
  inlinePinGutter: true,
};

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  return fallback;
}

function asInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** Coerce a persisted / partial bag to a full {@link EditorIntelSettings}. */
export function readEditorIntel(raw: unknown): EditorIntelSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_EDITOR_INTEL;
  return {
    preevalEnabled: asBool(o.preevalEnabled, d.preevalEnabled),
    preevalIdleMs: asInt(o.preevalIdleMs, d.preevalIdleMs, INTEL_IDLE_MS_MIN, INTEL_IDLE_MS_MAX),
    preevalTabSwitchMs: asInt(
      o.preevalTabSwitchMs,
      d.preevalTabSwitchMs,
      INTEL_TAB_SWITCH_MS_MIN,
      INTEL_TAB_SWITCH_MS_MAX,
    ),
    preevalClearOnEdit: asBool(o.preevalClearOnEdit, d.preevalClearOnEdit),
    preevalLocal: asBool(o.preevalLocal, d.preevalLocal),
    preevalRemote: asBool(o.preevalRemote, d.preevalRemote),
    preevalTypos: asBool(o.preevalTypos, d.preevalTypos),
    preevalVersionWarn: asBool(o.preevalVersionWarn, d.preevalVersionWarn),
    preevalStudyWarn: asBool(o.preevalStudyWarn, d.preevalStudyWarn),
    preevalSecurityWarn: asBool(o.preevalSecurityWarn, d.preevalSecurityWarn),
    preevalDuplicateDecl: asBool(o.preevalDuplicateDecl, d.preevalDuplicateDecl),
    preevalBlockRun: asBool(o.preevalBlockRun, d.preevalBlockRun),

    diagUnderlines: asBool(o.diagUnderlines, d.diagUnderlines),
    diagGutter: asBool(o.diagGutter, d.diagGutter),
    diagHover: asBool(o.diagHover, d.diagHover),
    diagErrors: asBool(o.diagErrors, d.diagErrors),
    diagWarnings: asBool(o.diagWarnings, d.diagWarnings),
    diagTypos: asBool(o.diagTypos, d.diagTypos),
    diagInfo: asBool(o.diagInfo, d.diagInfo),

    hoverEnabled: asBool(o.hoverEnabled, d.hoverEnabled),
    hoverTimeMs: asInt(o.hoverTimeMs, d.hoverTimeMs, INTEL_HOVER_MS_MIN, INTEL_HOVER_MS_MAX),
    hoverRemote: asBool(o.hoverRemote, d.hoverRemote),
    signatureHints: asBool(o.signatureHints, d.signatureHints),

    autocompleteEnabled: asBool(o.autocompleteEnabled, d.autocompleteEnabled),
    activateOnTyping: asBool(o.activateOnTyping, d.activateOnTyping),
    paramCompletions: asBool(o.paramCompletions, d.paramCompletions),
    enumCompletions: asBool(o.enumCompletions, d.enumCompletions),
    remoteCompletions: asBool(o.remoteCompletions, d.remoteCompletions),
    maxRenderedOptions: asInt(
      o.maxRenderedOptions,
      d.maxRenderedOptions,
      INTEL_MAX_OPTIONS_MIN,
      INTEL_MAX_OPTIONS_MAX,
    ),

    remoteLspEnabled: asBool(o.remoteLspEnabled, d.remoteLspEnabled),
    hoverTimeoutMs: asInt(o.hoverTimeoutMs, d.hoverTimeoutMs, INTEL_TIMEOUT_MS_MIN, INTEL_TIMEOUT_MS_MAX),
    completionTimeoutMs: asInt(
      o.completionTimeoutMs,
      d.completionTimeoutMs,
      INTEL_TIMEOUT_MS_MIN,
      INTEL_TIMEOUT_MS_MAX,
    ),
    diagnosticsTimeoutMs: asInt(
      o.diagnosticsTimeoutMs,
      d.diagnosticsTimeoutMs,
      INTEL_TIMEOUT_MS_MIN,
      INTEL_TIMEOUT_MS_MAX,
    ),

    colorChips: asBool(o.colorChips, d.colorChips),
    inlineChips: asBool(o.inlineChips, d.inlineChips),
    inlinePinGutter: asBool(o.inlinePinGutter, d.inlinePinGutter),
  };
}

/** True when a diagnostic severity is shown in the editor. */
export function intelShowsSeverity(
  intel: EditorIntelSettings,
  severity: string,
): boolean {
  const s = String(severity || '').toLowerCase();
  if (s === 'error' || s === 'fatal') return intel.diagErrors;
  if (s === 'warning') return intel.diagWarnings;
  if (s === 'typo') return intel.diagTypos;
  if (s === 'info' || s === 'information' || s === 'hint') return intel.diagInfo;
  return true;
}
