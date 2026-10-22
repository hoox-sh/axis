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
 * Renderer seam for the GPU rung (HP PR 8, §4 / §11.4).
 *
 * A renderer consumes the Float32/NDC records that
 * `hp/paint/visual-attr.ts` produces and paints candles onto a canvas. It
 * never sees price ticks, the SAB, or float64 — that boundary is deliberate
 * (`§6.5`), because neither float64 nor int64 is renderable and WebGPU has
 * no float64 at all.
 *
 * Probe order is **WebGPU → WebGL2 → LWC** (`§4`): WebGPU is HP-4, WebGL2 is
 * HP-3, and when neither exists the caller keeps Lightweight Charts as the
 * painter (HP-2 or below) and this module is never reached. The flag
 * `axis.engine.hp.gpu` (`auto` | `off` | `webgl2` | `webgpu`) narrows or
 * disables the probe; `off` must land on LWC even where a GPU exists.
 *
 * The contract is intentionally narrow so a WebGPU backend can be added
 * behind the same interface without touching the paint path.
 *
 * @module hp/render/types
 */

import type { VisualAttrBuffer } from '../paint/visual-attr';

/** Which painter won the probe. Mirrors the HP rung names in `§4`. */
export type RendererKind = 'webgpu' | 'webgl2' | 'lwc';

export type RenderViewport = {
  width: number;
  height: number;
  /** CSS pixels per candle. The renderer derives NDC x from it. */
  barSpacing: number;
  /**
   * `x_index` parked at the canvas right edge (NDC `+1`), in bar slots —
   * normally `visibleCount` plus any right margin.
   *
   * The fill numbers records from the **oldest** visible candle forward
   * (`x_index` 0), so NDC x grows with `x_index`: anchoring the right edge
   * puts oldest-left / newest-right. With `barSpacing * rightEdgeIndex ==
   * width`, `x_index` 0 lands exactly on the left edge (NDC `-1`).
   */
  rightEdgeIndex: number;
};

/**
 * A canvas painter over `VisualAttrBuffer` records.
 *
 * Implementations must be side-effect free until {@link CandleRenderer.draw}
 * is called, and must tolerate a `draw` on every frame with no intervening
 * resize.
 */
export interface CandleRenderer {
  readonly kind: RendererKind;

  /** Size the backing surface. Cheap to call repeatedly. */
  resize(width: number, height: number, dpr: number): void;

  /** Paint `count` records from `buf`. Records past `count` are ignored. */
  draw(buf: VisualAttrBuffer, count: number, viewport: RenderViewport): void;

  /** Release GL/GPU handles. The renderer is unusable afterwards. */
  dispose(): void;
}

/** A live GPU context plus the backend that owns it. */
export type RendererHandle = {
  renderer: CandleRenderer;
  kind: RendererKind;
  /** `true` until {@link CandleRenderer.dispose}. */
  alive: boolean;
};
