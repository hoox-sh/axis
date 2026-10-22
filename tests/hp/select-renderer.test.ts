/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Renderer selection for the GPU rung (HP PR 8, §4).
 *
 * Two contracts:
 *
 * 1. **Probe order** — `probeRendererKind` is a complete 4×4 truth table
 *    over (`gpu` flag × probed capabilities), written out literally so a
 *    reordering of the branches cannot pass by re-deriving the same
 *    order: `off` lands on LWC even where both GPUs exist, a forced mode
 *    never claims a backend the probe does not have, and `auto` walks
 *    WebGPU → WebGL2 → LWC.
 * 2. **Flag reporting** — `resolveGpuFlag` says whether the GPU path
 *    engaged, with the documented caveat that a `'webgpu'` outcome counts
 *    as `'on'` although HP-4 has no painter yet (the caller falls through).
 */

import '../setup';
import { describe, expect, it } from 'bun:test';
import type { HpGpuMode } from '../../src/hp/feature-flag';
import { probeRendererKind, resolveGpuFlag } from '../../src/hp/render/select-renderer';
import type { RendererKind } from '../../src/hp/render/types';

type Probe = { webgpu: boolean; webgl2: boolean };

const PROBES: ReadonlyArray<readonly [label: string, probe: Probe]> = [
  ['both GPUs', { webgpu: true, webgl2: true }],
  ['webgpu only', { webgpu: true, webgl2: false }],
  ['webgl2 only', { webgpu: false, webgl2: true }],
  ['neither GPU', { webgpu: false, webgl2: false }],
];

/**
 * Columns follow `PROBES` order. Written by hand from plan §4 rather than
 * computed, so the table is the specification.
 */
const TRUTH_TABLE: ReadonlyArray<readonly [gpu: HpGpuMode, expected: ReadonlyArray<RendererKind>]> =
  [
    ['off', ['lwc', 'lwc', 'lwc', 'lwc']],
    ['auto', ['webgpu', 'webgpu', 'webgl2', 'lwc']],
    ['webgl2', ['webgl2', 'lwc', 'webgl2', 'lwc']],
    ['webgpu', ['webgpu', 'webgpu', 'lwc', 'lwc']],
  ];

describe('probeRendererKind', () => {
  for (const [gpu, expected] of TRUTH_TABLE) {
    PROBES.forEach(([label, probe], i) => {
      const want = expected[i];
      it(`gpu=${gpu} + ${label} → ${want ?? '??'}`, () => {
        expect(probeRendererKind(probe, gpu)).toBe(want);
      });
    });
  }

  it('the kill switch wins over capability: off lands on LWC even with both GPUs', () => {
    expect(probeRendererKind({ webgpu: true, webgl2: true }, 'off')).toBe('lwc');
  });

  it('a forced mode never claims a backend the probe did not find', () => {
    expect(probeRendererKind({ webgpu: true, webgl2: false }, 'webgl2')).toBe('lwc');
    expect(probeRendererKind({ webgpu: false, webgl2: true }, 'webgpu')).toBe('lwc');
  });

  it('auto walks WebGPU → WebGL2 → LWC', () => {
    expect(probeRendererKind({ webgpu: true, webgl2: true }, 'auto')).toBe('webgpu');
    expect(probeRendererKind({ webgpu: false, webgl2: true }, 'auto')).toBe('webgl2');
    expect(probeRendererKind({ webgpu: false, webgl2: false }, 'auto')).toBe('lwc');
  });
});

describe('resolveGpuFlag', () => {
  it('is off when the flag is off, whatever the probe found', () => {
    expect(resolveGpuFlag('off', 'webgl2')).toBe('off');
    expect(resolveGpuFlag('off', 'webgpu')).toBe('off');
  });

  it('is off when the outcome fell back to LWC', () => {
    expect(resolveGpuFlag('auto', 'lwc')).toBe('off');
    expect(resolveGpuFlag('webgpu', 'lwc')).toBe('off');
  });

  it('is on for a GPU outcome — webgpu too, though HP-4 has no painter yet', () => {
    expect(resolveGpuFlag('auto', 'webgl2')).toBe('on');
    expect(resolveGpuFlag('webgl2', 'webgl2')).toBe('on');
    expect(resolveGpuFlag('webgpu', 'webgpu')).toBe('on');
  });
});
