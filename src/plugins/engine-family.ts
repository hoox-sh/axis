// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Engine family lookups.
 *
 * An engine declares its family; this module is the one place that answers
 * "what kind of engine is this?" — from a plugin, from a registered id, or
 * (as a fallback) from a string that names no registered engine.
 *
 * The id stays the user-facing name and the selection key. The family is
 * what the code branches on.
 *
 * @module plugins/engine-family
 */

import { registry } from './registry';
import type { EngineFamily } from './types';

/**
 * The built-in engines, by id.
 *
 * A static map so a lookup works before the engines are registered (the
 * plugin registry is populated lazily).
 */
const BUILTIN_FAMILY: Readonly<Record<string, EngineFamily>> = {
  server: 'server',
  'pyne-worker': 'worker',
  pyodide: 'pyodide',
};

/**
 * The family of an engine id — exact, or `null` when the id names no engine.
 *
 * Use this when a wrong answer would be costly (routing a credential to the
 * wrong slot, for example): an unknown id stays unknown.
 */
export function engineFamilyForId(id: string): EngineFamily | null {
  const trimmed = String(id || '').trim();
  if (!trimmed) return null;
  const registered = registry.getEngine(trimmed)?.family;
  if (registered) return registered;
  return BUILTIN_FAMILY[trimmed] ?? null;
}

/**
 * The family of a free-form string that may name an engine.
 *
 * The exact lookup wins. The substring heuristics are the fallback for a
 * value that names no known engine — a stale endpoint, a preset id, a
 * capability hint.
 */
export function engineFamilyForText(text: string): EngineFamily {
  const trimmed = String(text || '').trim();
  const exact = engineFamilyForId(trimmed);
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  if (!lower) return 'dynamic';
  if (lower.includes('pyodide') || lower.includes('client') || lower === 'offline')
    return 'pyodide';
  if (lower.includes('worker') || lower.includes('edge') || lower.includes('cloudflare')) {
    return 'worker';
  }
  if (lower.includes('server') || lower.includes('flask')) return 'server';
  return 'dynamic';
}

/**
 * The family of an engine id, falling back to the text heuristics.
 *
 * The common case: a caller has an engine id and wants to branch on the
 * engine's behaviour.
 */
export function engineFamilyFor(id: string): EngineFamily {
  return engineFamilyForId(id) ?? engineFamilyForText(id);
}
