// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Search space from Pine `input.*` defs (AXIS Script Settings).
 *
 * @module optimize/space
 */

import type { ScriptInputDef } from '../results/script-inputs';
import type { ParamSpec, ParamValue } from './types';

const SKIP = new Set(['source', 'timeframe', 'symbol', 'session', 'color', 'text', 'unknown']);

export function isSearchableInput(d: ScriptInputDef): boolean {
  return !SKIP.has(d.type);
}

export function defaultParamFromInput(d: ScriptInputDef): ParamSpec | null {
  if (!isSearchableInput(d)) return null;
  const name = d.title || d.id;
  if (!name) return null;
  if (d.type === 'bool') {
    return { name, kind: 'bool', choices: [false, true], enabled: true };
  }
  if (d.type === 'enum' || (d.options && d.options.length)) {
    return { name, kind: 'categorical', choices: [...(d.options || [])], enabled: true };
  }
  if (d.type === 'int' || d.type === 'float' || d.type === 'price') {
    const min = d.min != null && Number.isFinite(Number(d.min)) ? Number(d.min) : undefined;
    const max = d.max != null && Number.isFinite(Number(d.max)) ? Number(d.max) : undefined;
    const step = d.step != null && Number.isFinite(Number(d.step)) ? Number(d.step) : undefined;
    return {
      name,
      kind: d.type === 'int' ? 'int' : 'float',
      min,
      max,
      step,
      enabled: min != null && max != null && min !== max,
    };
  }
  return null;
}

export function spaceReady(params: ParamSpec[]): { ok: boolean; reason?: string } {
  const on = params.filter((p) => p.enabled !== false);
  if (!on.length) return { ok: false, reason: 'Select at least one searchable input' };
  for (const p of on) {
    if (p.kind === 'int' || p.kind === 'float') {
      if (p.min == null || p.max == null || p.min === p.max) {
        return { ok: false, reason: `${p.name}: set min and max` };
      }
    }
    if (p.kind === 'categorical' && !(p.choices && p.choices.length)) {
      return { ok: false, reason: `${p.name}: needs choices` };
    }
  }
  return { ok: true };
}

export function clampValue(spec: ParamSpec, raw: unknown): ParamValue {
  if (spec.kind === 'bool') return Boolean(raw);
  if (spec.kind === 'categorical') {
    const choices = spec.choices || [];
    if (choices.includes(raw as ParamValue)) return raw as ParamValue;
    return choices[0] ?? String(raw ?? '');
  }
  let n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) n = spec.min ?? 0;
  const lo = spec.min ?? n;
  const hi = spec.max ?? n;
  n = Math.min(hi, Math.max(lo, n));
  if (spec.step && spec.step > 0) {
    n = lo + Math.round((n - lo) / spec.step) * spec.step;
  }
  return spec.kind === 'int' ? Math.round(n) : n;
}

export function randomAssignment(params: ParamSpec[], rnd = Math.random): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const spec of params.filter((p) => p.enabled !== false)) {
    if (spec.kind === 'bool') {
      out[spec.name] = rnd() < 0.5;
      continue;
    }
    if (spec.kind === 'categorical') {
      const c = spec.choices || [];
      out[spec.name] = c[Math.floor(rnd() * c.length)] ?? '';
      continue;
    }
    const lo = spec.min ?? 0;
    const hi = spec.max ?? lo + 1;
    out[spec.name] = clampValue(spec, lo + rnd() * (hi - lo));
  }
  return out;
}

export function toPyneSpace(params: ParamSpec[]): {
  params: Array<Record<string, unknown>>;
} {
  return {
    params: params
      .filter((p) => p.enabled !== false)
      .map((p) => ({
        name: p.name,
        kind: p.kind,
        ...(p.min != null ? { min: p.min } : {}),
        ...(p.max != null ? { max: p.max } : {}),
        ...(p.step != null ? { step: p.step } : {}),
        ...(p.choices ? { choices: p.choices } : {}),
      })),
  };
}
