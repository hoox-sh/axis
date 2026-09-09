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
 * Language-feature groups for the editor **Language Feature Bar**.
 *
 * Each group maps to one master {@link EditorIntelSettings} boolean (toggled
 * on click) plus the full setting list shown in the long-press menu. Pure
 * data — the bar component and tests share these definitions so chips can
 * never drift from the settings surface.
 *
 * @module editor/language-features
 */

import {
  INTEL_HOVER_MS_MAX,
  INTEL_HOVER_MS_MIN,
  INTEL_IDLE_MS_MAX,
  INTEL_IDLE_MS_MIN,
  INTEL_MAX_OPTIONS_MAX,
  INTEL_MAX_OPTIONS_MIN,
  INTEL_TAB_SWITCH_MS_MAX,
  INTEL_TAB_SWITCH_MS_MIN,
  INTEL_TIMEOUT_MS_MAX,
  INTEL_TIMEOUT_MS_MIN,
  type EditorIntelSettings,
} from './editor-intel';

/** Press-and-hold delay before a chip opens its settings menu (ms). */
export const FEATURE_BAR_LONG_PRESS_MS = 550;

/** Poll interval for live activity (tooltips / completion open and close outside Solid). */
export const FEATURE_BAR_POLL_MS = 400;

/** Live activity flags — which language features are firing right now. */
export type FeatureActivityKey =
  | 'hover'
  | 'signature'
  | 'complete'
  | 'lint'
  | 'marks'
  | 'chips'
  | 'remote';

export type FeatureActivity = Record<FeatureActivityKey, boolean>;

/** All-quiet snapshot (editor missing, nothing firing). */
export const IDLE_FEATURE_ACTIVITY: FeatureActivity = {
  hover: false,
  signature: false,
  complete: false,
  lint: false,
  marks: false,
  chips: false,
  remote: false,
};

/**
 * Editor-observed activity — read live off the CodeMirror view
 * (completion list open, signature hint shown, hover card open).
 */
export type EditorObservedActivity = {
  hover: boolean;
  signature: boolean;
  complete: boolean;
};

/** All-quiet editor snapshot (view missing). */
export const IDLE_EDITOR_ACTIVITY: EditorObservedActivity = {
  hover: false,
  signature: false,
  complete: false,
};

type BoolKey = {
  [K in keyof EditorIntelSettings]-?: EditorIntelSettings[K] extends boolean ? K : never;
}[keyof EditorIntelSettings];

type NumKey = {
  [K in keyof EditorIntelSettings]-?: EditorIntelSettings[K] extends number ? K : never;
}[keyof EditorIntelSettings];

/** One row inside a group's long-press settings menu. */
export type FeatureSetting =
  | { kind: 'toggle'; key: BoolKey; label: string; hint?: string }
  | {
      kind: 'number';
      key: NumKey;
      label: string;
      hint?: string;
      min: number;
      max: number;
      step?: number;
      suffix?: string;
    };

/** One chip in the Language Feature Bar. */
export interface LanguageFeatureGroup {
  /** Stable id (also used for `data-testid="axis-editor-feature-<id>"`). */
  id: string;
  /** Short chip label. */
  label: string;
  /** Tooltip for the chip (mentions click vs long-press). */
  hint: string;
  /** Master switch toggled on click. */
  masterKey: BoolKey;
  /**
   * Activity flag that colors the chip. Colored ⟺ the feature is firing
   * right now (not merely enabled) — so the bar shows which features the
   * current script actually uses, and which could be disabled.
   */
  activityKey: FeatureActivityKey;
  /** Full setting list for the long-press menu. */
  settings: FeatureSetting[];
}

const CLICK_HINT = 'Click toggles · long-press (or right-click) opens settings';

export const LANGUAGE_FEATURE_GROUPS: LanguageFeatureGroup[] = [
  {
    id: 'hover',
    label: 'Hover',
    hint: `Builtin / symbol hover cards. ${CLICK_HINT}`,
    masterKey: 'hoverEnabled',
    activityKey: 'hover',
    settings: [
      { kind: 'toggle', key: 'hoverEnabled', label: 'Hover cards', hint: 'Docs for ta.*, plot, input.*, annotations.' },
      {
        kind: 'number',
        key: 'hoverTimeMs',
        label: 'Hover delay',
        hint: 'Rest time before a card opens.',
        min: INTEL_HOVER_MS_MIN,
        max: INTEL_HOVER_MS_MAX,
        step: 25,
        suffix: ' ms',
      },
      { kind: 'toggle', key: 'hoverRemote', label: 'Remote hover', hint: 'Ask Pro API /lsp/hover when local has no card.' },
    ],
  },
  {
    id: 'signature',
    label: 'Sig',
    hint: `In-call signature / parameter checklist. ${CLICK_HINT}`,
    masterKey: 'signatureHints',
    activityKey: 'signature',
    settings: [
      {
        kind: 'toggle',
        key: 'signatureHints',
        label: 'Signature hints',
        hint: 'In-call checklist of used / current / unused parameters.',
      },
    ],
  },
  {
    id: 'complete',
    label: 'Complete',
    hint: `Autocomplete suggestions. ${CLICK_HINT}`,
    masterKey: 'autocompleteEnabled',
    activityKey: 'complete',
    settings: [
      { kind: 'toggle', key: 'autocompleteEnabled', label: 'Completions', hint: 'Typing + Ctrl/Cmd-Space.' },
      { kind: 'toggle', key: 'activateOnTyping', label: 'Activate while typing', hint: 'Off = trigger key only.' },
      { kind: 'toggle', key: 'paramCompletions', label: 'Named parameters', hint: 'Remaining title= / minval= args inside a call.' },
      { kind: 'toggle', key: 'enumCompletions', label: 'Enum values', hint: 'plot.style_*, shape.*, size.*, location.*, color.*.' },
      { kind: 'toggle', key: 'remoteCompletions', label: 'Remote completions', hint: 'Merge Pro API /lsp/completion.' },
      {
        kind: 'number',
        key: 'maxRenderedOptions',
        label: 'Max options',
        hint: 'Cap the suggestion popup.',
        min: INTEL_MAX_OPTIONS_MIN,
        max: INTEL_MAX_OPTIONS_MAX,
        step: 8,
      },
    ],
  },
  {
    id: 'lint',
    label: 'Lint',
    hint: `Idle pre-eval / lint. ${CLICK_HINT}`,
    masterKey: 'preevalEnabled',
    activityKey: 'lint',
    settings: [
      { kind: 'toggle', key: 'preevalEnabled', label: 'Pre-eval', hint: 'Parse/lint after idle, Save, and Run.' },
      { kind: 'toggle', key: 'preevalLocal', label: 'Local checks', hint: 'Brackets, strings, entry point.' },
      { kind: 'toggle', key: 'preevalRemote', label: 'Remote diagnostics', hint: 'POST /lsp/diagnostics when Backend URL is up.' },
      { kind: 'toggle', key: 'preevalTypos', label: 'Typo hints', hint: 'Unknown ta.* / bare-call typos.' },
      { kind: 'toggle', key: 'preevalBlockRun', label: 'Block Run on errors', hint: 'Severity error disables Run.' },
      { kind: 'toggle', key: 'preevalClearOnEdit', label: 'Clear while typing', hint: 'Hide marks until idle.' },
      {
        kind: 'number',
        key: 'preevalIdleMs',
        label: 'Idle delay',
        hint: 'Quiet time after last keystroke before lint.',
        min: INTEL_IDLE_MS_MIN,
        max: INTEL_IDLE_MS_MAX,
        step: 50,
        suffix: ' ms',
      },
      {
        kind: 'number',
        key: 'preevalTabSwitchMs',
        label: 'Tab-switch delay',
        hint: 'Lint shortly after switching tabs.',
        min: INTEL_TAB_SWITCH_MS_MIN,
        max: INTEL_TAB_SWITCH_MS_MAX,
        step: 50,
        suffix: ' ms',
      },
    ],
  },
  {
    id: 'marks',
    label: 'Marks',
    hint: `Diagnostic underlines + gutter markers. ${CLICK_HINT}`,
    masterKey: 'diagUnderlines',
    activityKey: 'marks',
    settings: [
      { kind: 'toggle', key: 'diagUnderlines', label: 'Underlines + line tint', hint: 'Wavy/dotted marks in the buffer.' },
      { kind: 'toggle', key: 'diagGutter', label: 'Gutter markers', hint: 'Dots / triangles in the left gutter.' },
      { kind: 'toggle', key: 'diagHover', label: 'Diagnostic hover', hint: 'Tooltip when resting on a mark.' },
      { kind: 'toggle', key: 'diagErrors', label: 'Show errors' },
      { kind: 'toggle', key: 'diagWarnings', label: 'Show warnings' },
      { kind: 'toggle', key: 'diagTypos', label: 'Show typos' },
      { kind: 'toggle', key: 'diagInfo', label: 'Show info' },
    ],
  },
  {
    id: 'chips',
    label: 'Chips',
    hint: `Inline color chips + debug markers. ${CLICK_HINT}`,
    masterKey: 'colorChips',
    activityKey: 'chips',
    settings: [
      { kind: 'toggle', key: 'colorChips', label: 'Color chips', hint: 'Swatches before hex / color.* tokens.' },
      { kind: 'toggle', key: 'inlineChips', label: 'Debug chips', hint: 'End-of-line; also needs the editor Debug toggle.' },
      { kind: 'toggle', key: 'inlinePinGutter', label: 'Pin gutter', hint: 'Also requires chart Pins.' },
    ],
  },
  {
    id: 'remote',
    label: 'Remote',
    hint: `Remote LSP via Backend URL. ${CLICK_HINT}`,
    masterKey: 'remoteLspEnabled',
    activityKey: 'remote',
    settings: [
      { kind: 'toggle', key: 'remoteLspEnabled', label: 'Use remote LSP', hint: 'Master for hover / complete / diagnostics.' },
      {
        kind: 'number',
        key: 'hoverTimeoutMs',
        label: 'Hover timeout',
        hint: 'Give up on /lsp/hover, show local.',
        min: INTEL_TIMEOUT_MS_MIN,
        max: INTEL_TIMEOUT_MS_MAX,
        step: 50,
        suffix: ' ms',
      },
      {
        kind: 'number',
        key: 'completionTimeoutMs',
        label: 'Completion timeout',
        hint: 'Give up on /lsp/completion.',
        min: INTEL_TIMEOUT_MS_MIN,
        max: INTEL_TIMEOUT_MS_MAX,
        step: 50,
        suffix: ' ms',
      },
      {
        kind: 'number',
        key: 'diagnosticsTimeoutMs',
        label: 'Diagnostics timeout',
        hint: 'Local marks show first; this only waits for remote parse.',
        min: INTEL_TIMEOUT_MS_MIN,
        max: INTEL_TIMEOUT_MS_MAX,
        step: 50,
        suffix: ' ms',
      },
    ],
  },
];

/** Look up a group by id. */
export function featureGroupById(id: string): LanguageFeatureGroup | undefined {
  return LANGUAGE_FEATURE_GROUPS.find((g) => g.id === id);
}

/**
 * Derive chip activity from live signals. “Active” means visibly firing —
 * an open card / list / hint, a running check, or rendered marks — so the
 * bar shows which features the current script actually uses (and which
 * could be disabled), not merely which are switched on.
 *
 * - `lint`: a pre-eval check is running, or the last check produced diagnostics.
 * - `marks`: diagnostics are rendered as underlines / gutter markers.
 * - `chips`: color swatches are rendered in the buffer.
 * - `remote`: remote LSP is switched on while a remote-capable feature
 *   (hover / complete / lint) is firing — i.e. the backend is in the loop.
 */
export function deriveFeatureActivity(input: {
  observed: EditorObservedActivity;
  lintPending: boolean;
  diagnosticCount: number;
  colorHits: number;
  intel: EditorIntelSettings;
}): FeatureActivity {
  const { observed, lintPending, diagnosticCount, colorHits, intel } = input;
  const lint =
    intel.preevalEnabled && (lintPending || diagnosticCount > 0);
  const marks =
    (intel.diagUnderlines || intel.diagGutter) && diagnosticCount > 0;
  const chips = intel.colorChips && colorHits > 0;
  const remote =
    intel.remoteLspEnabled && (observed.hover || observed.complete || lint);
  return {
    hover: observed.hover,
    signature: observed.signature,
    complete: observed.complete,
    lint,
    marks,
    chips,
    remote,
  };
}
