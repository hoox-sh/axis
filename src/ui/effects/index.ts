// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * UI effect manager — tuned chrome motion.
 *
 * @module ui/effects
 */

export {
  UI_EFFECTS_STORAGE_KEY,
  applyUiEffects,
  effectActive,
  effectDirty,
  effectEnabled,
  effectMs,
  effectParam,
  getEffect,
  installUiEffects,
  listEffects,
  prefersReducedMotion,
  registerEffect,
  resetEffect,
  setEffectEnabled,
  setEffectParam,
} from './manager';
export type { EffectDef, EffectParamSpec, EffectPreviewSpec, EffectTune } from './types';
