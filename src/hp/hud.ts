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
 * Capabilities HUD for the HP plane (HP PR 9, plan §13).
 *
 * Pure: the probe host and every flag are injectable; no store, no DOM
 * writes — the Workers Manager card and the unit tests both call
 * {@link hpChip}.
 *
 * The value follows the plan verbatim — `hp · sab+gpu`, `hp · copy+lwc`,
 * `json · lwc` — transport memory (`sab` | `copy` | `json`) plus painter
 * (`gpu` | `lwc`). It reports the rung {@link selectHpRung} *selects* for
 * this browser; the GPU canvas itself lands with the render-wiring PR.
 *
 * @module hp/hud
 */

import { isolationProbe, selectHpRung, type HpRung, type IsolationHost } from './capabilities';
import {
  hpGpuMode,
  hpSabMode,
  isHpDisabled,
  isHpEnabled,
  type HpGpuMode,
  type HpSabMode,
} from './feature-flag';
import { probeRendererKind } from './render/select-renderer';
import type { RendererKind } from './render/types';

export type HpChipInput = {
  /** Injectable probe host (tests); defaults to `globalThis`. */
  host?: IsolationHost;
  /** Defaults to the `axis.engine.hp.enabled` flag. */
  enabled?: boolean;
  /** Defaults to the `axis.engine.hp.disabled` kill switch. */
  disabled?: boolean;
  /** Defaults to `axis.engine.hp.gpu`. */
  gpu?: HpGpuMode;
  /** Defaults to `axis.engine.hp.sab`. */
  sab?: HpSabMode;
  /** Session rung cap; omitted → the live `axis.hp.rung` read. */
  storedRung?: HpRung | null;
};

export type HpChip = {
  /** Plan-format value: `hp · sab+gpu` / `hp · copy+lwc` / `json · lwc`. */
  value: string;
  /** StudioHealth-compatible dot state (`ui/studio` status pill). */
  health: 'healthy' | 'idle' | 'skipped';
  /** Word next to the dot — `HP-3`, `Off (default)`, `Kill switch`. */
  statusLabel: string;
  /** One line: rung, transport memory, painter, isolation. */
  detail: string;
  rung: HpRung;
  engaged: boolean;
  /** Painter the probe would hand the rung (informational: a session
   * rung cap can hold the rung below the probed best painter). */
  renderer: RendererKind;
};

const OFF_VALUE = 'json · lwc';

function painterWord(rung: HpRung): string {
  if (rung === 4) return 'WebGPU';
  if (rung === 3) return 'WebGL2';
  return 'LWC';
}

/**
 * The HUD chip: kill switch wins, then the opt-in, then the selected rung.
 *
 * Transport memory is derived from what the selection will actually use —
 * `rung 1` is always the transferable copy (no isolation, forced
 * `sab: 'off'`, or a session cap after a SAB OOM), `sab` only when the tab
 * is isolated and SAB is allowed.
 */
export function hpChip(input: HpChipInput = {}): HpChip {
  const probe = isolationProbe(input.host);
  const gpu = input.gpu ?? hpGpuMode();
  const renderer = probeRendererKind(probe, gpu);
  const disabled = input.disabled ?? isHpDisabled();
  const enabled = input.enabled ?? isHpEnabled();

  if (disabled) {
    return {
      value: OFF_VALUE,
      health: 'skipped',
      statusLabel: 'Kill switch',
      detail: 'axis.engine.hp.disabled=1 wins over enabled — the JSON /ws/live → LWC path stays.',
      rung: 0,
      engaged: false,
      renderer,
    };
  }
  if (!enabled) {
    return {
      value: OFF_VALUE,
      health: 'idle',
      statusLabel: 'Off (default)',
      detail:
        'Opt-in, default off — until axis.engine.hp.enabled=1 the JSON /ws/live path decodes on main and LWC paints.',
      rung: 0,
      engaged: false,
      renderer,
    };
  }

  const sab = input.sab ?? hpSabMode();
  const rung = selectHpRung(probe, {
    enabled,
    disabled,
    gpu,
    sab,
    storedRung: input.storedRung,
  });
  const transport = rung === 1 || !probe.sab || sab === 'off' ? 'copy' : 'sab';
  const painter = rung >= 3 ? 'gpu' : 'lwc';
  const transportWord = transport === 'sab' ? 'SAB ring' : 'transferable copy';

  return {
    value: `hp · ${transport}+${painter}`,
    health: 'healthy',
    statusLabel: `HP-${rung}`,
    detail: `Selected HP-${rung} · ${transportWord} · painter ${painterWord(rung)} · ${
      probe.isolated ? 'cross-origin isolated' : 'not cross-origin isolated'
    }`,
    rung,
    engaged: true,
    renderer,
  };
}
