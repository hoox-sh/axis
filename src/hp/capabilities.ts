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
 * Runtime capability probe for the HP plane (HP PR 2).
 *
 * Sync and side-effect free aside from an optional WebGL2 context probe.
 * SAB is reported only when the document is cross-origin isolated.
 *
 * @module hp/capabilities
 */

import {
  hpGpuMode,
  hpSabMode,
  HP_RUNG_SESSION_KEY,
  isHpDisabled,
  isHpEnabled,
  type HpGpuMode,
  type HpSabMode,
} from './feature-flag';

export type HpRung = 0 | 1 | 2 | 3 | 4;

export type IsolationProbe = {
  isolated: boolean;
  sab: boolean;
  waitAsync: boolean;
  webgpu: boolean;
  webgl2: boolean;
  offscreen: boolean;
};

/** Injectable host so unit tests do not need a browser. */
export type IsolationHost = {
  crossOriginIsolated?: boolean;
  SharedArrayBuffer?: unknown;
  Atomics?: object;
  OffscreenCanvas?: unknown;
  navigator?: { gpu?: unknown };
  document?: {
    createElement?: (tag: string) => { getContext?: (name: string) => unknown };
  };
};

function probeWebgl2(host: IsolationHost): boolean {
  try {
    const el = host.document?.createElement?.('canvas');
    if (!el?.getContext) return false;
    return !!el.getContext('webgl2');
  } catch {
    return false;
  }
}

/** Probe isolation + GPU surfaces. Pass `host` in tests. */
export function isolationProbe(host: IsolationHost = globalThis as IsolationHost): IsolationProbe {
  const isolated = host.crossOriginIsolated === true;
  const sabCtor = host.SharedArrayBuffer;
  const sab = typeof sabCtor === 'function' && isolated;
  const atomics = host.Atomics;
  const waitAsync = !!atomics && 'waitAsync' in atomics;
  const webgpu = !!host.navigator && 'gpu' in host.navigator && host.navigator.gpu != null;
  const offscreen = typeof host.OffscreenCanvas === 'function';
  return {
    isolated,
    sab,
    waitAsync,
    webgpu,
    webgl2: probeWebgl2(host),
    offscreen,
  };
}

export type SelectHpRungOpts = {
  enabled?: boolean;
  disabled?: boolean;
  gpu?: HpGpuMode;
  sab?: HpSabMode;
  /** Session cap from a prior SAB OOM (`axis.hp.rung`). */
  storedRung?: HpRung | null;
};

function readStoredRung(): HpRung | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const v = sessionStorage.getItem(HP_RUNG_SESSION_KEY);
    if (v === '0' || v === '1' || v === '2' || v === '3' || v === '4') {
      return Number(v) as HpRung;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Persist a successful (or fallen-back) rung for this tab.
 * An OOM on SAB writes `'1'` so the next probe does not retry the allocation.
 */
export function rememberHpRung(rung: HpRung): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(HP_RUNG_SESSION_KEY, String(rung));
  } catch {
    /* ignore */
  }
}

function gpuCandidate(probe: IsolationProbe, gpu: HpGpuMode): HpRung | null {
  if (gpu === 'off') return null;
  if (gpu === 'webgpu') return probe.webgpu ? 4 : null;
  if (gpu === 'webgl2') return probe.webgl2 ? 3 : null;
  if (probe.webgpu) return 4;
  if (probe.webgl2) return 3;
  return null;
}

/**
 * Pick an HP rung. Flags default to the live localStorage values.
 * Session `axis.hp.rung` only clamps downward.
 */
export function selectHpRung(probe: IsolationProbe, opts: SelectHpRungOpts = {}): HpRung {
  const disabled = opts.disabled ?? isHpDisabled();
  const enabled = opts.enabled ?? isHpEnabled();
  if (disabled || !enabled) return 0;

  const gpu = opts.gpu ?? hpGpuMode();
  const sab = opts.sab ?? hpSabMode();
  const stored = opts.storedRung === undefined ? readStoredRung() : opts.storedRung;

  let candidate: HpRung = 1;
  const gpuRung = gpuCandidate(probe, gpu);
  if (gpuRung != null) candidate = gpuRung;
  else if (probe.sab && sab !== 'off') candidate = 2;
  else candidate = 1;

  if (stored != null && stored < candidate) return stored;
  return candidate;
}
