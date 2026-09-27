// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tunable chrome motion. One effect is a named flash or pulse with a few
 * numeric params. Later UI can register another effect without a new settings page.
 *
 * @module ui/effects/types
 */

export interface EffectParamSpec {
  id: string;
  label: string;
  /** One short line under the slider. */
  hint: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Shown next to the value. Also the usual CSS suffix (`ms`, `%`). */
  unit: string;
  /** Custom property name without the leading `--`. */
  cssVar: string;
  /** Format a tuned number for that custom property. */
  toCss: (value: number) => string;
}

/** Optional live sample in Settings. Classes are toggled on the sample row. */
export interface EffectPreviewSpec {
  sampleClass: string;
  upClass: string;
  downClass: string;
}

export interface EffectDef {
  id: string;
  label: string;
  /** One sentence: what the user sees. */
  summary: string;
  /** On unless the user turns it off. */
  enabled: boolean;
  params: readonly EffectParamSpec[];
  preview?: EffectPreviewSpec;
}

/** Stored override. Missing fields mean "use the registry default". */
export interface EffectTune {
  enabled?: boolean;
  params?: Record<string, number>;
}
