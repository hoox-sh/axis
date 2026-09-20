/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

describe('log panel layout', () => {
  it('system log rows give HH:mm:ss.sss its own column so it does not collide with level', () => {
    const src = readFileSync(join(root, 'src/ui/SystemLogs.tsx'), 'utf8');
    expect(src).toContain('w-[13ch]');
    expect(src).toContain('w-[6ch]');
    expect(src).not.toContain('w-[72px]');
  });

  it('empty-state copy has horizontal padding (script logs with no log.* lines)', () => {
    const css = readFileSync(join(root, 'src/index.css'), 'utf8');
    const block = css.slice(css.indexOf('.axis-empty-state'), css.indexOf('.axis-logs-strip'));
    expect(block).toContain('padding-inline');
    expect(block).not.toMatch(/padding:\s*8px\s+0/);
  });
});
