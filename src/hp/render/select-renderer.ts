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
 * Renderer selection for the GPU rung (HP PR 8, §4).
 *
 * {@link probeRendererKind} turns the isolation probe plus the
 * `axis.engine.hp.gpu` flag into the painter that wins, following the
 * plan's probe order **WebGPU → WebGL2 → LWC**. It mirrors `gpuCandidate()`
 * in `hp/capabilities` (rung 4 = webgpu, 3 = webgl2, null = keep LWC); it
 * does not call that function because this one answers "which painter",
 * not "which rung".
 *
 * Plan-ahead asymmetry to keep in mind: `'webgpu'` can be *selected* here
 * (HP-4 reserved), but **no WebGPU painter exists in this PR** —
 * `webgl2-renderer.ts` is the only GPU backend today. Callers must treat a
 * `webgpu` outcome as "not paintable yet" and fall through to LWC until
 * HP-4 lands.
 *
 * @module hp/render/select-renderer
 */

import type { IsolationProbe } from '../capabilities';
import type { HpGpuMode } from '../feature-flag';
import type { RendererKind } from './types';

/**
 * Pick the painter kind for this probe + flag combination.
 *
 * Probe order (plan §4): `off` always lands on LWC even where a GPU
 * exists; a forced mode narrows to that backend or falls back to LWC;
 * `auto` prefers WebGPU, then WebGL2, then LWC.
 */
export function probeRendererKind(
  probe: Pick<IsolationProbe, 'webgpu' | 'webgl2'>,
  gpu: HpGpuMode,
): RendererKind {
  if (gpu === 'off') return 'lwc';
  if (gpu === 'webgpu') return probe.webgpu ? 'webgpu' : 'lwc';
  if (gpu === 'webgl2') return probe.webgl2 ? 'webgl2' : 'lwc';
  // 'auto' — same preference order as gpuCandidate() in hp/capabilities.
  if (probe.webgpu) return 'webgpu';
  if (probe.webgl2) return 'webgl2';
  return 'lwc';
}

/**
 * Whether the GPU path actually engaged: `'on'` only when the probe
 * selected a GPU painter, `'off'` when the flag is `off` or the outcome is
 * LWC. A `'webgpu'` outcome still counts as `'on'` for flag purposes even
 * though HP-4 has no painter yet — the caller is expected to fall through.
 */
export function resolveGpuFlag(gpu: HpGpuMode, probed: RendererKind): 'off' | 'on' {
  if (gpu === 'off' || probed === 'lwc') return 'off';
  return 'on';
}
