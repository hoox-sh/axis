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
 * Multi-click draft controller for AXIS interactive drawings.
 *
 * Tracks placement of 1-, 2-, 3-, and N-point tools until the drawing is
 * finished (fixed arity on the last click, free-form via {@link DraftController.onFinish}).
 */

/** Chart time/price anchor used while drafting. */
export interface ChartPoint {
  time: number;
  price: number;
}

/** Fixed point count, or free-form (`'n'`) finished via `onFinish`. */
export type ToolArity = 1 | 2 | 3 | 'n';

export interface ToolSpec {
  kind: string;
  arity: ToolArity;
  /** Minimum points when `arity` is `'n'` (default 2). */
  minPoints?: number;
}

export type DraftPhase =
  | { status: 'idle' }
  | { status: 'placing'; kind: string; points: ChartPoint[]; hover: ChartPoint | null };

export interface DraftPayload {
  kind: string;
  points: ChartPoint[];
}

export interface DraftController {
  getPhase(): DraftPhase;
  begin(kind: string): void;
  cancel(): void;
  /** Returns finished drawing payload or null if still placing. */
  onClick(pt: ChartPoint): DraftPayload | null;
  onMove(pt: ChartPoint): void;
  /** Complete an N-point tool when `points.length >= minPoints`. */
  onFinish(): DraftPayload | null;
  /** Committed points plus hover (when set) for draft paint; null when idle. */
  previewPoints(): ChartPoint[] | null;
}

/** Default tool arities used when no custom specs are passed. */
export const TOOL_SPECS: readonly ToolSpec[] = [
  { kind: 'hline', arity: 1 },
  { kind: 'text', arity: 1 },
  { kind: 'trend', arity: 2 },
  { kind: 'ray', arity: 2 },
  { kind: 'rect', arity: 2 },
  { kind: 'fib', arity: 2 },
  { kind: 'measure', arity: 2 },
  { kind: 'channel', arity: 3 },
  { kind: 'polyline', arity: 'n', minPoints: 2 },
] as const;

function copyPoint(pt: ChartPoint): ChartPoint {
  return { time: pt.time, price: pt.price };
}

function copyPoints(pts: ChartPoint[]): ChartPoint[] {
  return pts.map(copyPoint);
}

function indexSpecs(specs: readonly ToolSpec[]): Map<string, ToolSpec> {
  const map = new Map<string, ToolSpec>();
  for (const s of specs) {
    map.set(s.kind, s);
  }
  return map;
}

function minPointsFor(spec: ToolSpec): number {
  if (spec.arity === 'n') {
    return spec.minPoints ?? 2;
  }
  return spec.arity;
}

/**
 * Create a pure multi-click draft state machine.
 *
 * @param specs Optional tool specs (defaults to {@link TOOL_SPECS}).
 */
export function createDraftController(specs: readonly ToolSpec[] = TOOL_SPECS): DraftController {
  const byKind = indexSpecs(specs);

  let phase: DraftPhase = { status: 'idle' };
  let activeSpec: ToolSpec | null = null;

  function resetIdle(): void {
    phase = { status: 'idle' };
    activeSpec = null;
  }

  function finish(kind: string, points: ChartPoint[]): DraftPayload {
    const payload: DraftPayload = { kind, points: copyPoints(points) };
    resetIdle();
    return payload;
  }

  return {
    getPhase(): DraftPhase {
      if (phase.status === 'idle') {
        return { status: 'idle' };
      }
      return {
        status: 'placing',
        kind: phase.kind,
        points: copyPoints(phase.points),
        hover: phase.hover ? copyPoint(phase.hover) : null,
      };
    },

    begin(kind: string): void {
      const spec = byKind.get(kind);
      if (!spec) {
        throw new Error(`Unknown drawing tool kind: ${kind}`);
      }
      activeSpec = spec;
      phase = {
        status: 'placing',
        kind: spec.kind,
        points: [],
        hover: null,
      };
    },

    cancel(): void {
      resetIdle();
    },

    onClick(pt: ChartPoint): DraftPayload | null {
      if (phase.status !== 'placing' || !activeSpec) {
        return null;
      }

      const next = [...phase.points, copyPoint(pt)];
      const kind = phase.kind;
      const arity = activeSpec.arity;

      if (arity === 'n') {
        phase = {
          status: 'placing',
          kind,
          points: next,
          hover: null,
        };
        return null;
      }

      if (next.length >= arity) {
        return finish(kind, next);
      }

      phase = {
        status: 'placing',
        kind,
        points: next,
        hover: null,
      };
      return null;
    },

    onMove(pt: ChartPoint): void {
      if (phase.status !== 'placing') {
        return;
      }
      phase = {
        status: 'placing',
        kind: phase.kind,
        points: phase.points,
        hover: copyPoint(pt),
      };
    },

    onFinish(): DraftPayload | null {
      if (phase.status !== 'placing' || !activeSpec) {
        return null;
      }
      if (activeSpec.arity !== 'n') {
        return null;
      }
      if (phase.points.length < minPointsFor(activeSpec)) {
        return null;
      }
      return finish(phase.kind, phase.points);
    },

    previewPoints(): ChartPoint[] | null {
      if (phase.status !== 'placing') {
        return null;
      }
      const out = copyPoints(phase.points);
      if (phase.hover) {
        out.push(copyPoint(phase.hover));
      }
      return out;
    },
  };
}
