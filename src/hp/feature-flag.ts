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
 * Feature flags for the high-performance chart plane (HP PR 2).
 *
 * Opt-in until the default flip (PR 10). The kill switch wins over enable.
 *
 * @module hp/feature-flag
 */

export const HP_ENABLED_KEY = 'axis.engine.hp.enabled';
export const HP_DISABLED_KEY = 'axis.engine.hp.disabled';
export const HP_GPU_KEY = 'axis.engine.hp.gpu';
export const HP_SAB_KEY = 'axis.engine.hp.sab';
export const HP_RUNG_SESSION_KEY = 'axis.hp.rung';

export type HpGpuMode = 'auto' | 'off' | 'webgl2' | 'webgpu';
export type HpSabMode = 'auto' | 'off';

let memoryEnabled = false;
let memoryDisabled = false;
let memoryGpu: HpGpuMode = 'auto';
let memorySab: HpSabMode = 'auto';

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — memory flag still applies */
  }
}

/** True when HP is opted in and the kill switch is off. */
export function isHpEnabled(): boolean {
  if (isHpDisabled()) return false;
  try {
    if (typeof localStorage === 'undefined') return memoryEnabled;
    return localStorage.getItem(HP_ENABLED_KEY) === '1';
  } catch {
    return memoryEnabled;
  }
}

/** Kill switch. Wins over {@link isHpEnabled}. */
export function isHpDisabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return memoryDisabled;
    return localStorage.getItem(HP_DISABLED_KEY) === '1' || memoryDisabled;
  } catch {
    return memoryDisabled;
  }
}

export function setHpEnabled(on: boolean): void {
  memoryEnabled = on;
  memoryDisabled = !on;
  if (on) {
    lsSet(HP_ENABLED_KEY, '1');
    lsSet(HP_DISABLED_KEY, null);
  } else {
    lsSet(HP_ENABLED_KEY, null);
    lsSet(HP_DISABLED_KEY, '1');
  }
}

export function setHpDisabled(on: boolean): void {
  memoryDisabled = on;
  lsSet(HP_DISABLED_KEY, on ? '1' : null);
}

export function hpGpuMode(): HpGpuMode {
  const raw = lsGet(HP_GPU_KEY) ?? memoryGpu;
  if (raw === 'off' || raw === 'webgl2' || raw === 'webgpu' || raw === 'auto') return raw;
  return 'auto';
}

export function setHpGpuMode(mode: HpGpuMode): void {
  memoryGpu = mode;
  lsSet(HP_GPU_KEY, mode === 'auto' ? null : mode);
}

export function hpSabMode(): HpSabMode {
  const raw = lsGet(HP_SAB_KEY) ?? memorySab;
  if (raw === 'off' || raw === 'auto') return raw;
  return 'auto';
}

export function setHpSabMode(mode: HpSabMode): void {
  memorySab = mode;
  lsSet(HP_SAB_KEY, mode === 'auto' ? null : mode);
}

/** Reset in-memory + storage flags (tests). */
export function resetHpFlags(): void {
  memoryEnabled = false;
  memoryDisabled = false;
  memoryGpu = 'auto';
  memorySab = 'auto';
  lsSet(HP_ENABLED_KEY, null);
  lsSet(HP_DISABLED_KEY, null);
  lsSet(HP_GPU_KEY, null);
  lsSet(HP_SAB_KEY, null);
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(HP_RUNG_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
