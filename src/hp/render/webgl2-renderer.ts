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
 * WebGL2 candle renderer — the HP-3 GPU rung (HP PR 8, §4 / §11.4).
 *
 * Paints `VisualAttrBuffer` records as instanced quads: one 32-byte record
 * per candle, eight divisor-1 vertex attributes laid out by
 * {@link VISUAL_OFFSET}, and a single 4-corner unit quad at divisor 0. The
 * vertex shader places each instance over its bar slot spanning the wick
 * (low..high); the fragment shader keeps the body box and a thin centered
 * wick strip and discards the rest of the quad — one draw call per frame,
 * no per-candle CPU work.
 *
 * The canvas is stacked over the Lightweight Charts chrome (plan §11.4), so
 * every frame clears to transparent and the packed alpha (194/255 for a
 * normal candle) blends with `SRC_ALPHA / ONE_MINUS_SRC_ALPHA`. No depth
 * test, no stencil.
 *
 * {@link createWebgl2Renderer} never throws: any context, shader, program or
 * buffer failure returns `null` and the caller falls through to the next
 * rung (LWC keeps painting). WebGPU (HP-4) can win the probe, but this is
 * the only GPU painter implemented today — see `select-renderer.ts`.
 *
 * @module hp/render/webgl2-renderer
 */

import {
  VISUAL_CANDLE_BYTES,
  VISUAL_OFFSET,
  VISUAL_RECORD_WORDS,
  type VisualAttrBuffer,
} from '../paint/visual-attr';
import type { CandleRenderer, RenderViewport } from './types';

/**
 * Minimal canvas surface so `HTMLCanvasElement` and `OffscreenCanvas`
 * unify under one `getContext` call — their DOM overloads do not.
 */
type Gl2Canvas = {
  getContext(contextId: string, options?: WebGLContextAttributes): unknown;
};

const CTX_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  // The compositor must see straight (non-premultiplied) alpha so it matches
  // SRC_ALPHA / ONE_MINUS_SRC_ALPHA blending against the cleared back buffer.
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
};

// Keep these in sync with the `layout(location = N)` qualifiers in
// VERTEX_SHADER_SRC. Attribute locations are explicit precisely so the
// bound-but-unused fields (volume, flags) keep a fixed slot for a later pass.
const ATTR_CORNER = 0;
const ATTR_X = 1;
const ATTR_OPEN = 2;
const ATTR_HIGH = 3;
const ATTR_LOW = 4;
const ATTR_CLOSE = 5;
const ATTR_VOLUME = 6;
const ATTR_COLOR = 7;
const ATTR_FLAGS = 8;

/** Instance attributes that are plain `float` words in the record. */
const FLOAT_INSTANCE_ATTRS: ReadonlyArray<readonly [location: number, offset: number]> = [
  [ATTR_X, VISUAL_OFFSET.x],
  [ATTR_OPEN, VISUAL_OFFSET.open],
  [ATTR_HIGH, VISUAL_OFFSET.high],
  [ATTR_LOW, VISUAL_OFFSET.low],
  [ATTR_CLOSE, VISUAL_OFFSET.close],
  [ATTR_VOLUME, VISUAL_OFFSET.volume],
];

/** Unit-quad corners for `TRIANGLE_STRIP`: bottom-left, bottom-right, top-left, top-right. */
const QUAD_CORNERS = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

/** Pre-parity slot fractions, used when the caller omits explicit widths. */
const FALLBACK_BODY_FRAC = 0.75;
const FALLBACK_WICK_FRAC = 0.125;

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;
// uint arithmetic below — state the precision instead of leaning on the
// vertex language's implicit highp-int default.
precision highp int;

// Unit-quad corner, 0..1 — divisor 0, advances per vertex.
layout(location = 0) in vec2 a_corner;
// VisualCandle fields — divisor 1, stride VISUAL_CANDLE_BYTES (32 bytes).
layout(location = 1) in float a_x;
layout(location = 2) in float a_open;
layout(location = 3) in float a_high;
layout(location = 4) in float a_low;
layout(location = 5) in float a_close;
// Bound for record-layout parity; not consumed by the candle pass yet.
layout(location = 6) in float a_volume;
layout(location = 7) in uint a_color;
layout(location = 8) in uint a_flags;

uniform float u_halfWidth;      // viewport.width * 0.5 (CSS px)
uniform float u_barSpacing;     // CSS px per bar slot
uniform float u_rightEdgeIndex; // x_index parked at the right edge (NDC +1)
uniform float u_heightPx;       // viewport height (CSS px), for the 1px floor

out vec4 v_rgba;
out float v_y;
out float v_ndcX;
out float v_centerX;
out float v_bodyLo;
out float v_bodyHi;

void main() {
  // One bar slot in NDC-x. The fill numbers records from the OLDEST visible
  // candle (x_index 0) forward, so NDC x must GROW with x_index: oldest at
  // the left edge, newest at the right. Anchor instead of flip — x_index ==
  // u_rightEdgeIndex sits at the right edge (NDC +1). Worked example:
  // rightEdgeIndex == visibleCount and barSpacing * visibleCount == width
  // puts x_index 0 at exactly -1 (left edge). A -1 flip here would render
  // the chart mirrored.
  float slotNdc = u_barSpacing / u_halfWidth;
  float center = (a_x - u_rightEdgeIndex) * slotNdc + 1.0;
  float ndcX = center + (a_corner.x - 0.5) * slotNdc;

  // The quad spans the whole wick span (low..high). A flat bar (high==low)
  // gets a one-CSS-pixel floor so a pegged or dormant market still draws a
  // visible line instead of vanishing.
  float pxNdcY = 2.0 / max(u_heightPx, 1.0);
  float lo = a_low;
  float hi = a_high;
  if (hi - lo < pxNdcY) {
    float mid = (hi + lo) * 0.5;
    lo = mid - pxNdcY * 0.5;
    hi = mid + pxNdcY * 0.5;
  }
  float y = mix(lo, hi, a_corner.y);

  gl_Position = vec4(ndcX, y, 0.0, 1.0);

  // a_color is the u32 packed 0xAABBGGRR: in memory its bytes read
  // R,G,B,A (little-endian), so byte 0 = least significant = R. Unpack by
  // hand with core ES 3.00 bit ops — GLSL ES 3.00 has NO unpackUint4x8 /
  // unpackUnorm4x8 (those are desktop-GL / ES 3.2 additions), and reaching
  // for one fails to compile on every WebGL2 driver. Because the factory
  // treats a compile failure as a clean null, such a mistake would silently
  // disable the GPU rung forever instead of failing loudly.
  float r = float(a_color & 0xffu);
  float g = float((a_color >> 8u) & 0xffu);
  float b = float((a_color >> 16u) & 0xffu);
  float a = float((a_color >> 24u) & 0xffu);
  v_rgba = vec4(r, g, b, a) / 255.0;

  v_y = y;
  v_ndcX = ndcX;
  v_centerX = center;
  // Body span is open..close regardless of direction (down bars included).
  v_bodyLo = min(a_open, a_close);
  v_bodyHi = max(a_open, a_close);
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec4 v_rgba;
in float v_y;
in float v_ndcX;
in float v_centerX;
in float v_bodyLo;
in float v_bodyHi;

out vec4 fragColor;

// Half-widths in NDC, computed from LWC's own candle geometry
// (optimalCandlestickWidth for the body, a flat one-pixel wick) so the GL
// candles sit inside LWC's pixels instead of a slightly different slot
// fraction.
uniform float u_bodyHalf;
uniform float u_wickHalf;

void main() {
  float dx = abs(v_ndcX - v_centerX);
  bool inBody = v_y >= v_bodyLo && v_y <= v_bodyHi && dx <= u_bodyHalf;
  bool inWick = dx <= u_wickHalf;
  // The quad spans low..high — carve out everything that is neither body
  // nor wick (the fragment is not interpolated across discarded regions).
  if (!inBody && !inWick) discard;
  fragColor = v_rgba;
}
`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // No info-log output by design: a compile failure is a clean fall
    // through to the next rung, not something to spam the console with.
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragment: WebGLShader,
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

type RendererResources = {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  cornerVbo: WebGLBuffer;
  candleVbo: WebGLBuffer;
};

/**
 * Create the instanced candle renderer for `canvas`.
 *
 * Returns `null` — never throws — when a `webgl2` context cannot be
 * obtained or any shader/program/buffer setup step fails; the caller falls
 * through to the next rung (LWC keeps painting).
 */
export function createWebgl2Renderer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): CandleRenderer | null {
  try {
    const ctx = (canvas as unknown as Gl2Canvas).getContext('webgl2', CTX_ATTRIBUTES);
    if (!(ctx instanceof WebGL2RenderingContext)) return null;
    const gl = ctx;

    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }
    const program = linkProgram(gl, vertex, fragment);
    // The program holds its own references now; release the shader objects.
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!program) return null;

    const vao = gl.createVertexArray();
    const cornerVbo = gl.createBuffer();
    const candleVbo = gl.createBuffer();
    if (!vao || !cornerVbo || !candleVbo) {
      if (vao) gl.deleteVertexArray(vao);
      if (cornerVbo) gl.deleteBuffer(cornerVbo);
      if (candleVbo) gl.deleteBuffer(candleVbo);
      gl.deleteProgram(program);
      return null;
    }

    // One VAO holds the whole layout: the unit quad (divisor 0) plus the
    // eight per-instance VisualCandle attributes (divisor 1).
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, cornerVbo);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_CORNERS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(ATTR_CORNER);
    gl.vertexAttribPointer(ATTR_CORNER, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(ATTR_CORNER, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, candleVbo);
    for (const [location, offset] of FLOAT_INSTANCE_ATTRS) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 1, gl.FLOAT, false, VISUAL_CANDLE_BYTES, offset);
      gl.vertexAttribDivisor(location, 1);
    }
    // The u32 fields go through IPointer so the shader reads raw words —
    // no float normalization may touch the packed bytes.
    gl.enableVertexAttribArray(ATTR_COLOR);
    gl.vertexAttribIPointer(
      ATTR_COLOR,
      1,
      gl.UNSIGNED_INT,
      VISUAL_CANDLE_BYTES,
      VISUAL_OFFSET.color,
    );
    gl.vertexAttribDivisor(ATTR_COLOR, 1);
    gl.enableVertexAttribArray(ATTR_FLAGS);
    gl.vertexAttribIPointer(
      ATTR_FLAGS,
      1,
      gl.UNSIGNED_INT,
      VISUAL_CANDLE_BYTES,
      VISUAL_OFFSET.flags,
    );
    gl.vertexAttribDivisor(ATTR_FLAGS, 1);
    gl.bindVertexArray(null);

    // Per-context state, set once: blend for the stacked-canvas alpha, no
    // depth, transparent clear color (plan §11.4).
    gl.useProgram(program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const resources: RendererResources = { program, vao, cornerVbo, candleVbo };
    return makeRenderer(canvas, gl, resources);
  } catch {
    // Context loss, a hostile canvas, or an exotic environment — the GPU
    // rung is an optimization, never a load-bearing wall.
    return null;
  }
}

function makeRenderer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  gl: WebGL2RenderingContext,
  res: RendererResources,
): CandleRenderer {
  const uniforms = {
    halfWidth: gl.getUniformLocation(res.program, 'u_halfWidth'),
    barSpacing: gl.getUniformLocation(res.program, 'u_barSpacing'),
    rightEdgeIndex: gl.getUniformLocation(res.program, 'u_rightEdgeIndex'),
    heightPx: gl.getUniformLocation(res.program, 'u_heightPx'),
    bodyHalf: gl.getUniformLocation(res.program, 'u_bodyHalf'),
    wickHalf: gl.getUniformLocation(res.program, 'u_wickHalf'),
  };

  let disposed = false;
  let lastW = -1;
  let lastH = -1;
  /** `candleVbo` storage, in float32 words; grown monotonically. */
  let allocatedFloats = 0;

  const setU1f = (location: WebGLUniformLocation | null, value: number): void => {
    if (location) gl.uniform1f(location, value);
  };

  return {
    kind: 'webgl2',

    resize(width: number, height: number, dpr: number): void {
      if (disposed) return;
      const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
      const w = Math.max(1, Math.round((Number.isFinite(width) ? width : 0) * scale));
      const h = Math.max(1, Math.round((Number.isFinite(height) ? height : 0) * scale));
      // Assigning canvas.width/height clears the drawing buffer even when
      // the value is unchanged — guard so repeated calls stay free.
      if (w === lastW && h === lastH && canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      lastW = w;
      lastH = h;
    },

    draw(buf: VisualAttrBuffer, count: number, viewport: RenderViewport): void {
      if (disposed || gl.isContextLost()) return;

      // Transparent clear every frame — the stacked LWC chrome shows
      // through wherever no candle covers (plan §11.4).
      gl.clear(gl.COLOR_BUFFER_BIT);

      const { width, height, barSpacing, rightEdgeIndex } = viewport;
      if (!(width > 0) || !(height > 0)) return;
      if (!Number.isFinite(barSpacing) || !Number.isFinite(rightEdgeIndex)) return;
      if (!Number.isFinite(count)) return;
      const n = Math.min(Math.max(0, Math.trunc(count)), buf.capacity);
      if (n <= 0) return;

      // Candle geometry: LWC's own body/wick widths when the caller passes
      // them, else the historical slot fractions (rough frames only).
      const bodyPx =
        typeof viewport.bodyWidthPx === 'number' && viewport.bodyWidthPx > 0
          ? viewport.bodyWidthPx
          : barSpacing * FALLBACK_BODY_FRAC;
      const wickPx =
        typeof viewport.wickWidthPx === 'number' && viewport.wickWidthPx > 0
          ? viewport.wickWidthPx
          : barSpacing * FALLBACK_WICK_FRAC;

      gl.bindVertexArray(res.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.candleVbo);

      // Upload only the live prefix — the +64 tail stays in the staging
      // buffer and never crosses the bus. The stride is VISUAL_RECORD_WORDS
      // (8 words = 32 bytes), not the 6 float fields: `bufferSubData`'s
      // length is in elements, so a 6-word stride would upload 0.75 records
      // per candle and desync every attribute from its record.
      const floats = n * VISUAL_RECORD_WORDS;
      if (floats > allocatedFloats) {
        gl.bufferData(gl.ARRAY_BUFFER, floats * 4, gl.DYNAMIC_DRAW);
        allocatedFloats = floats;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.f32, 0, floats);

      // NDC math is a ratio of CSS-pixel quantities, so dpr cancels out —
      // the shader needs no device-pixel inputs.
      setU1f(uniforms.halfWidth, width * 0.5);
      setU1f(uniforms.barSpacing, barSpacing);
      setU1f(uniforms.rightEdgeIndex, rightEdgeIndex);
      setU1f(uniforms.heightPx, height);
      // NDC half-width of a CSS-pixel width is `px / width`.
      setU1f(uniforms.bodyHalf, bodyPx / width);
      setU1f(uniforms.wickHalf, wickPx / width);

      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.bindVertexArray(null);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        gl.deleteBuffer(res.cornerVbo);
        gl.deleteBuffer(res.candleVbo);
        gl.deleteVertexArray(res.vao);
        gl.deleteProgram(res.program);
        const loseCtx = gl.getExtension('WEBGL_lose_context') as WEBGL_lose_context | null;
        loseCtx?.loseContext();
      } catch {
        // The context may already be gone — dispose must never throw.
      }
    },
  };
}
