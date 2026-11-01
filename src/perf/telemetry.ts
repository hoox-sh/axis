// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Minimal performance telemetry for Phase 0 measurement.
 *
 * Wraps `performance.mark` / `measure` in a dev-friendly API. Counters and
 * measures are best-effort and degrade silently in environments that lack the
 * Performance API (tests / SSR / older browsers).
 *
 * @module perf/telemetry
 */

/** Is true when running in a browser with the full Performance API. */
export function perfAvailable(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.performance !== 'undefined' &&
    typeof globalThis.performance.mark === 'function' &&
    typeof globalThis.performance.measure === 'function'
  );
}

/** Is true for dev / non-production builds. */
export function isDevBuild(): boolean {
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
}

let enabled = isDevBuild();

/** Toggle telemetry at runtime (useful for tests). */
export function setPerfEnabled(value: boolean): void {
  enabled = value;
}

/** Is telemetry currently active? */
export function perfEnabled(): boolean {
  return enabled && perfAvailable();
}

/** Emit a single mark if telemetry is active. */
export function perfMark(name: string): void {
  if (!enabled) return;
  try {
    globalThis.performance.mark?.(name);
  } catch {
    /* ignore */
  }
}

/** Measure between two marks and clear the marks. */
export function perfMeasure(name: string, startMark: string, endMark: string): number | null {
  if (!enabled || !perfAvailable()) return null;
  try {
    globalThis.performance.measure(name, startMark, endMark);
    const entries = globalThis.performance.getEntriesByName(name, 'measure');
    const last = entries[entries.length - 1];
    if (last) return last.duration;
  } catch {
    /* ignore */
  }
  return null;
}

/** Run a function and record its duration as a measure. */
export function perfMeasureSync<T>(name: string, fn: () => T): T {
  const start = `${name}:start:${perfUnique()}`;
  const end = `${name}:end:${perfUnique()}`;
  perfMark(start);
  try {
    return fn();
  } finally {
    perfMark(end);
    perfMeasure(name, start, end);
    perfClearMarks(start, end);
  }
}

/** Run an async function and record its duration as a measure. */
export async function perfMeasureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = `${name}:start:${perfUnique()}`;
  const end = `${name}:end:${perfUnique()}`;
  perfMark(start);
  try {
    return await fn();
  } finally {
    perfMark(end);
    perfMeasure(name, start, end);
    perfClearMarks(start, end);
  }
}

/** Clear named marks and any measures with the same name. */
export function perfClearMarks(...names: string[]): void {
  if (!perfAvailable()) return;
  for (const name of names) {
    try {
      globalThis.performance.clearMarks(name);
      globalThis.performance.clearMeasures(name);
    } catch {
      /* ignore */
    }
  }
}

let _id = 0;
function perfUnique(): number {
  return ++_id;
}
