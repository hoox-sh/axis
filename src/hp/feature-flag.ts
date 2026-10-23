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

import { getItem, removeItem, setItem } from '../utils/storage';
import { createFlagPair } from '../utils/flags';

export const HP_ENABLED_KEY = 'axis.engine.hp.enabled';
export const HP_DISABLED_KEY = 'axis.engine.hp.disabled';
export const HP_GPU_KEY = 'axis.engine.hp.gpu';
export const HP_SAB_KEY = 'axis.engine.hp.sab';
export const HP_RUNG_SESSION_KEY = 'axis.hp.rung';

export type HpGpuMode = 'auto' | 'off' | 'webgl2' | 'webgpu';
export type HpSabMode = 'auto' | 'off';

const hpFlag = createFlagPair({ enabledKey: HP_ENABLED_KEY, disabledKey: HP_DISABLED_KEY });

let memoryGpu: HpGpuMode = 'auto';
let memorySab: HpSabMode = 'auto';

/** True when HP is opted in and the kill switch is off. */
export function isHpEnabled(): boolean {
  return hpFlag.isEnabled();
}

/** Kill switch. Wins over {@link isHpEnabled}. */
export function isHpDisabled(): boolean {
  return hpFlag.isDisabled();
}

export function setHpEnabled(on: boolean): void {
  hpFlag.setEnabled(on);
}

export function setHpDisabled(on: boolean): void {
  hpFlag.setDisabled(on);
}

export function hpGpuMode(): HpGpuMode {
  const raw = getItem(HP_GPU_KEY) ?? memoryGpu;
  if (raw === 'off' || raw === 'webgl2' || raw === 'webgpu' || raw === 'auto') return raw;
  return 'auto';
}

export function setHpGpuMode(mode: HpGpuMode): void {
  memoryGpu = mode;
  if (mode === 'auto') removeItem(HP_GPU_KEY);
  else setItem(HP_GPU_KEY, mode);
}

export function hpSabMode(): HpSabMode {
  const raw = getItem(HP_SAB_KEY) ?? memorySab;
  if (raw === 'off' || raw === 'auto') return raw;
  return 'auto';
}

export function setHpSabMode(mode: HpSabMode): void {
  memorySab = mode;
  if (mode === 'auto') removeItem(HP_SAB_KEY);
  else setItem(HP_SAB_KEY, mode);
}

/** Reset in-memory + storage flags (tests). */
export function resetHpFlags(): void {
  hpFlag.reset();
  memoryGpu = 'auto';
  memorySab = 'auto';
  removeItem(HP_GPU_KEY);
  removeItem(HP_SAB_KEY);
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(HP_RUNG_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
