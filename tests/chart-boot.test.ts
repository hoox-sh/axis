/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Chart page-load splash is its own centered layer. The shared list
 * empty-state (flex-start) must not pull the logo back to the corner.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

describe('chart boot splash', () => {
  it('centers the logo, caption, and MCP connect action on the chart', () => {
    const host = readFileSync(join(root, 'src/chart/ChartHost.tsx'), 'utf8');
    expect(host).toContain('class="axis-chart-boot"');
    expect(host).toContain('axis-chart-boot-cluster');
    expect(host).toContain('<McpConnectCta />');
    expect(host).not.toContain('axis-empty-state absolute');

    const css = readFileSync(join(root, 'src/index.css'), 'utf8');
    const block = css.slice(css.indexOf('.axis-chart-boot {'), css.indexOf('.axis-chart-boot-title'));
    expect(block).toContain('align-items: center');
    expect(block).toContain('justify-content: center');
    expect(block).toContain('text-align: center');
  });

  it('keeps the expand arrow inside the drawing-tool button', () => {
    const src = readFileSync(join(root, 'src/chart/DrawingToolbar.tsx'), 'utf8');
    expect(src).toContain('class={`axis-draw-tool');
    expect(src).toContain('axis-draw-caret');
    expect(src).not.toContain('Icons.chevronRight');
    const css = readFileSync(join(root, 'src/index.css'), 'utf8');
    const caret = css.slice(css.indexOf('.axis-draw-caret {'), css.indexOf('.axis-draw-caret.is-down'));
    expect(caret).toContain('position: absolute');
    expect(caret).toContain('right: 1px');
    expect(caret).toContain('bottom: 1px');
  });
});
