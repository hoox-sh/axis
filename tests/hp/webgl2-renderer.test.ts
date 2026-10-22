/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * WebGL2 factory contract (HP PR 8).
 *
 * `createWebgl2Renderer` is the rung seam: it must return `null` — never
 * throw — for every environment where a WebGL2 context cannot be obtained
 * (headless Bun, a browser without WebGL2, a hostile or broken canvas),
 * because a `null` is what makes the caller fall through to LWC. The shader
 * strings themselves cannot be compiled here; the browser pass covers
 * those, this file pins the failure surface that Bun *can* exercise.
 */

import '../setup';
import { describe, expect, it } from 'bun:test';
import { createWebgl2Renderer } from '../../src/hp/render/webgl2-renderer';

function canvasWith(getContext: () => unknown): HTMLCanvasElement {
  return { getContext } as unknown as HTMLCanvasElement;
}

describe('createWebgl2Renderer never throws', () => {
  it('returns null when no context can be obtained', () => {
    expect(createWebgl2Renderer(canvasWith(() => null))).toBeNull();
  });

  it('returns null when getContext rejects the request', () => {
    expect(
      createWebgl2Renderer(
        canvasWith(() => {
          throw new Error('webgl2 unavailable');
        }),
      ),
    ).toBeNull();
  });

  it('returns null when getContext hands back a non-WebGL2 object', () => {
    expect(createWebgl2Renderer(canvasWith(() => ({})))).toBeNull();
  });

  it('returns null for a canvas without getContext at all', () => {
    expect(createWebgl2Renderer({} as unknown as HTMLCanvasElement)).toBeNull();
  });
});
