// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure tune math: clamp, merge defaults, and CSS custom properties.
 * The manager persists and applies the result.
 *
 * @module ui/effects/resolve
 */

import type { EffectDef, EffectParamSpec, EffectTune } from './types';

export function clampEffectParam(spec: EffectParamSpec, raw: number): number {
  if (!Number.isFinite(raw)) return spec.default;
  const clamped = Math.min(spec.max, Math.max(spec.min, raw));
  if (!(spec.step > 0)) return clamped;
  const steps = Math.round((clamped - spec.min) / spec.step);
  const snapped = spec.min + steps * spec.step;
  const digits = spec.step < 1 ? 2 : 0;
  const tidy = Number(snapped.toFixed(digits));
  return Math.min(spec.max, Math.max(spec.min, tidy));
}

export function readEnabled(def: EffectDef, tune: EffectTune | undefined): boolean {
  return typeof tune?.enabled === 'boolean' ? tune.enabled : def.enabled;
}

export function readParam(def: EffectDef, tune: EffectTune | undefined, paramId: string): number {
  const spec = def.params.find((p) => p.id === paramId);
  if (!spec) return 0;
  const stored = tune?.params?.[paramId];
  const raw = typeof stored === 'number' && Number.isFinite(stored) ? stored : spec.default;
  return clampEffectParam(spec, raw);
}

/**
 * Custom properties for every registered effect.
 * A disabled effect, or reduced motion, writes a zero value so a stuck class does not paint.
 */
export function effectCssVars(
  defs: readonly EffectDef[],
  tunes: Readonly<Record<string, EffectTune | undefined>>,
  reducedMotion: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of defs) {
    const active = readEnabled(def, tunes[def.id]) && !reducedMotion;
    for (const spec of def.params) {
      const value = active ? readParam(def, tunes[def.id], spec.id) : 0;
      out[`--${spec.cssVar}`] = spec.toCss(value);
    }
  }
  return out;
}

/** Drop unknown ids, bad types, and values that already match the default. */
export function sanitizeTunes(
  raw: unknown,
  defs: readonly EffectDef[],
): Record<string, EffectTune> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const bag = raw as Record<string, unknown>;
  const out: Record<string, EffectTune> = {};
  for (const def of defs) {
    const row = bag[def.id];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const tune: EffectTune = {};
    if (typeof rec.enabled === 'boolean' && rec.enabled !== def.enabled) {
      tune.enabled = rec.enabled;
    }
    const paramsIn =
      rec.params && typeof rec.params === 'object' && !Array.isArray(rec.params)
        ? (rec.params as Record<string, unknown>)
        : null;
    if (paramsIn) {
      const params: Record<string, number> = {};
      for (const spec of def.params) {
        const n = paramsIn[spec.id];
        if (typeof n !== 'number' || !Number.isFinite(n)) continue;
        const v = clampEffectParam(spec, n);
        if (v !== spec.default) params[spec.id] = v;
      }
      if (Object.keys(params).length) tune.params = params;
    }
    if (tune.enabled !== undefined || tune.params) out[def.id] = tune;
  }
  return out;
}

export function tuneIsDirty(def: EffectDef, tune: EffectTune | undefined): boolean {
  if (!tune) return false;
  if (typeof tune.enabled === 'boolean' && tune.enabled !== def.enabled) return true;
  if (!tune.params) return false;
  return def.params.some((spec) => {
    const n = tune.params?.[spec.id];
    return typeof n === 'number' && clampEffectParam(spec, n) !== spec.default;
  });
}
