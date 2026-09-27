// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * UI effect manager.
 *
 * Registry of short chrome motions, a persisted tune per effect, and CSS
 * custom properties on `<html>`. Call `effectMs` / `effectParam` from the
 * component that plays the motion. Register later effects with
 * {@link registerEffect}; Settings lists them automatically.
 *
 * Reduced motion forces every effect off without changing the saved tune.
 *
 * @module ui/effects/manager
 */

import { createSignal } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { BUILTIN_EFFECTS } from './registry';
import {
  clampEffectParam,
  effectCssVars,
  readEnabled,
  readParam,
  sanitizeTunes,
  tuneIsDirty,
} from './resolve';
import type { EffectDef, EffectTune } from './types';

export const UI_EFFECTS_STORAGE_KEY = 'pynescript.axis.ui-effects.v1';

const registry = new Map<string, EffectDef>();
for (const def of BUILTIN_EFFECTS) registry.set(def.id, def);

const [tunes, setTunes] = createStore<Record<string, EffectTune>>({});
const [reducedMotion, setReducedMotion] = createSignal(false);

let installed = false;
let reducedBound = false;

export function listEffects(): readonly EffectDef[] {
  return [...registry.values()];
}

export function getEffect(id: string): EffectDef | undefined {
  return registry.get(id);
}

/** Register or replace an effect. Safe to call after install; CSS vars refresh. */
export function registerEffect(def: EffectDef): void {
  registry.set(def.id, def);
  if (installed) applyUiEffects();
}

export function prefersReducedMotion(): boolean {
  return reducedMotion();
}

export function effectEnabled(id: string): boolean {
  const def = registry.get(id);
  if (!def) return false;
  return readEnabled(def, tunes[id]);
}

/** Tuned number, clamped to the spec. Unknown ids return 0. */
export function effectParam(id: string, paramId: string): number {
  const def = registry.get(id);
  if (!def) return 0;
  return readParam(def, tunes[id], paramId);
}

/** True when the user left the effect on and the OS is not asking for reduced motion. */
export function effectActive(id: string): boolean {
  return effectEnabled(id) && !reducedMotion();
}

/**
 * Timer length for an effect. `0` when the effect is off or motion is reduced,
 * so callers can skip the class entirely.
 */
export function effectMs(id: string, paramId = 'durationMs'): number {
  if (!effectActive(id)) return 0;
  return effectParam(id, paramId);
}

export function effectDirty(id: string): boolean {
  const def = registry.get(id);
  if (!def) return false;
  return tuneIsDirty(def, tunes[id]);
}

export function setEffectEnabled(id: string, enabled: boolean): void {
  const def = registry.get(id);
  if (!def) return;
  setTunes(
    produce((draft) => {
      if (!draft[id]) draft[id] = {};
      if (enabled === def.enabled) delete draft[id].enabled;
      else draft[id].enabled = enabled;
      if (draft[id].enabled === undefined && !draft[id].params) delete draft[id];
    }),
  );
  commit();
}

export function setEffectParam(id: string, paramId: string, raw: number): void {
  const def = registry.get(id);
  const spec = def?.params.find((p) => p.id === paramId);
  if (!def || !spec || !Number.isFinite(raw)) return;
  const value = clampEffectParam(spec, raw);
  setTunes(
    produce((draft) => {
      const row = draft[id] ?? {};
      const params = { ...(row.params ?? {}) };
      if (value === spec.default) delete params[paramId];
      else params[paramId] = value;
      const next: EffectTune = { ...row };
      if (Object.keys(params).length) next.params = params;
      else delete next.params;
      if (next.enabled === undefined && !next.params) delete draft[id];
      else draft[id] = next;
    }),
  );
  commit();
}

export function resetEffect(id: string): void {
  if (!registry.has(id)) return;
  setTunes(
    produce((draft) => {
      delete draft[id];
    }),
  );
  commit();
}

/** Write current tunes to CSS custom properties. No-op without a document. */
export function applyUiEffects(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root?.style || typeof root.style.setProperty !== 'function') return;
  const vars = effectCssVars(listEffects(), tunes, reducedMotion());
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}

/** Hydrate saved tunes, follow reduced-motion, and paint CSS variables. */
export function installUiEffects(): void {
  if (!installed) {
    installed = true;
    hydrate();
    bindReducedMotion();
  }
  applyUiEffects();
}

function commit(): void {
  persist();
  applyUiEffects();
}

function persist(): void {
  if (typeof localStorage === 'undefined' || localStorage == null) return;
  try {
    const raw = JSON.stringify(tunes);
    if (raw === '{}') localStorage.removeItem(UI_EFFECTS_STORAGE_KEY);
    else localStorage.setItem(UI_EFFECTS_STORAGE_KEY, raw);
  } catch {
    /* quota — the in-memory tune still paints */
  }
}

function hydrate(): void {
  let parsed: unknown = null;
  try {
    if (typeof localStorage === 'undefined' || localStorage == null) return;
    const raw = localStorage.getItem(UI_EFFECTS_STORAGE_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  setTunes(reconcile(sanitizeTunes(parsed, listEffects())));
}

function bindReducedMotion(): void {
  if (reducedBound) return;
  reducedBound = true;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sync = () => {
    setReducedMotion(mq.matches);
    applyUiEffects();
  };
  sync();
  try {
    mq.addEventListener('change', sync);
  } catch {
    /* older matchMedia */
  }
}

/** @internal test helper */
export function _setReducedMotionForTests(on: boolean): void {
  setReducedMotion(on);
  applyUiEffects();
}

/** @internal test helper — empty tunes and drop the storage key. */
export function _resetUiEffectsForTests(): void {
  try {
    localStorage?.removeItem(UI_EFFECTS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  setTunes(reconcile({}));
  setReducedMotion(false);
  applyUiEffects();
}
