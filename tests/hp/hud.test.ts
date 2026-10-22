/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * HP HUD chip (HP PR 9, plan §13/§4).
 *
 * The chip value is pinned verbatim from the plan — `hp · sab+gpu`,
 * `hp · copy+lwc`, `json · lwc` — across the flag × capability matrix:
 * kill switch wins over enable, HP stays default-off as `json · lwc`,
 * the painter word comes from the selected rung (not the raw probe), and
 * transport memory flips to `copy` whenever the tab cannot or must not use
 * SAB (no isolation, `sab: 'off'`, or the session OOM cap).
 *
 * Every flag is injected so the test never touches localStorage/sessionStorage.
 */

import '../setup';
import { describe, expect, it } from 'bun:test';
import type { IsolationHost } from '../../src/hp/capabilities';
import { hpChip, type HpChipInput } from '../../src/hp/hud';

function host(
  opts: { isolated?: boolean; webgpu?: boolean; webgl2?: boolean } = {},
): IsolationHost {
  return {
    crossOriginIsolated: opts.isolated === true,
    SharedArrayBuffer: opts.isolated === true ? class {} : undefined,
    Atomics: { waitAsync: () => 0 },
    OffscreenCanvas: class {},
    navigator: opts.webgpu === true ? { gpu: {} } : {},
    document: {
      createElement: () => ({
        getContext: (name: string) => (opts.webgl2 === true && name === 'webgl2' ? {} : null),
      }),
    },
  };
}

/** Opted-in baseline: no flags read from storage beyond these. */
const ON: Omit<HpChipInput, 'host'> = {
  enabled: true,
  disabled: false,
  gpu: 'auto',
  sab: 'auto',
  storedRung: null,
};

describe('hpChip — default off and kill switch', () => {
  it('reports json · lwc when HP is untouched (default off)', () => {
    const chip = hpChip({ host: host(), ...ON, enabled: false });
    expect(chip.value).toBe('json · lwc');
    expect(chip.engaged).toBe(false);
    expect(chip.rung).toBe(0);
    expect(chip.health).toBe('idle');
    expect(chip.statusLabel).toBe('Off (default)');
  });

  it('kill switch wins over enabled', () => {
    const chip = hpChip({ host: host({ isolated: true, webgl2: true }), ...ON, disabled: true });
    expect(chip.value).toBe('json · lwc');
    expect(chip.engaged).toBe(false);
    expect(chip.rung).toBe(0);
    expect(chip.health).toBe('skipped');
    expect(chip.statusLabel).toBe('Kill switch');
  });

  it('the default-off value matches today’s production path: JSON + LWC', () => {
    const chip = hpChip({ host: host(), ...ON, enabled: false });
    expect(chip.value).toBe('json · lwc');
    expect(chip.detail).toContain('JSON /ws/live');
    expect(chip.detail).toContain('LWC');
  });
});

describe('hpChip — engaged rung selection', () => {
  it('bare browser → HP-1 · copy+lwc', () => {
    const chip = hpChip({ host: host(), ...ON });
    expect(chip.value).toBe('hp · copy+lwc');
    expect(chip.rung).toBe(1);
    expect(chip.statusLabel).toBe('HP-1');
    expect(chip.health).toBe('healthy');
    expect(chip.detail).toContain('transferable copy');
    expect(chip.detail).toContain('painter LWC');
    expect(chip.detail).toContain('not cross-origin isolated');
  });

  it('isolated without a GPU → HP-2 · sab+lwc', () => {
    const chip = hpChip({ host: host({ isolated: true }), ...ON });
    expect(chip.value).toBe('hp · sab+lwc');
    expect(chip.rung).toBe(2);
    expect(chip.detail).toContain('SAB ring');
    expect(chip.detail).toContain('cross-origin isolated');
  });

  it('isolated + WebGL2 → HP-3 · sab+gpu', () => {
    const chip = hpChip({ host: host({ isolated: true, webgl2: true }), ...ON });
    expect(chip.value).toBe('hp · sab+gpu');
    expect(chip.rung).toBe(3);
    expect(chip.detail).toContain('painter WebGL2');
    expect(chip.renderer).toBe('webgl2');
  });

  it('isolated + WebGPU → HP-4 · sab+gpu', () => {
    const chip = hpChip({ host: host({ isolated: true, webgpu: true }), ...ON });
    expect(chip.value).toBe('hp · sab+gpu');
    expect(chip.rung).toBe(4);
    expect(chip.detail).toContain('painter WebGPU');
    expect(chip.renderer).toBe('webgpu');
  });

  it('WebGL2 without isolation → HP-3 painter but copy transport', () => {
    const chip = hpChip({ host: host({ webgl2: true }), ...ON });
    expect(chip.value).toBe('hp · copy+gpu');
    expect(chip.rung).toBe(3);
    expect(chip.detail).toContain('transferable copy');
    expect(chip.detail).toContain('painter WebGL2');
    expect(chip.detail).toContain('not cross-origin isolated');
  });
});

describe('hpChip — flag overrides and clamps', () => {
  it("sab: 'off' forces the transferable copy even when isolated", () => {
    const chip = hpChip({ host: host({ isolated: true }), ...ON, sab: 'off' });
    expect(chip.value).toBe('hp · copy+lwc');
    expect(chip.rung).toBe(1);
  });

  it("gpu: 'off' keeps HP on the LWC painter", () => {
    const chip = hpChip({ host: host({ isolated: true, webgl2: true }), ...ON, gpu: 'off' });
    expect(chip.value).toBe('hp · sab+lwc');
    expect(chip.rung).toBe(2);
    expect(chip.renderer).toBe('lwc');
  });

  it("a forced 'webgpu' mode falls back when the probe finds no WebGPU", () => {
    const chip = hpChip({ host: host({ isolated: true, webgl2: true }), ...ON, gpu: 'webgpu' });
    expect(chip.value).toBe('hp · sab+lwc');
    expect(chip.rung).toBe(2);
    expect(chip.renderer).toBe('lwc');
  });

  it('the session rung cap (SAB OOM) clamps to copy even when isolated', () => {
    const chip = hpChip({ host: host({ isolated: true, webgl2: true }), ...ON, storedRung: 1 });
    expect(chip.rung).toBe(1);
    expect(chip.value).toBe('hp · copy+lwc');
    expect(chip.detail).toContain('transferable copy');
  });

  it('renderer stays informational when a cap holds the rung below the probe', () => {
    const chip = hpChip({ host: host({ isolated: true, webgl2: true }), ...ON, storedRung: 2 });
    expect(chip.rung).toBe(2);
    expect(chip.value).toBe('hp · sab+lwc');
    expect(chip.renderer).toBe('webgl2');
  });
});
