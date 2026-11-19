/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Studio Data summary gutter.
 *
 * The summary is pinned above the tabs, outside `.ax-page-canvas`. Without
 * the page band it paints flush to the rail while the inventory below keeps
 * `--ax-canvas-pad`. The float DSM panel does not use this band.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

function ruleBody(css: string, selector: string): string {
  const needle = `${selector} {`;
  const start = css.indexOf(needle);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open + 1);
  if (open < 0 || close < 0) return '';
  return css.slice(open + 1, close);
}

function mediaBlocks(css: string, query: string): string[] {
  const re = new RegExp(`@media\\s*\\(\\s*${query}\\s*\\)\\s*\\{`, 'g');
  const blocks: string[] = [];
  for (const m of css.matchAll(re)) {
    if (m.index == null) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      const ch = css[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          blocks.push(css.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return blocks;
}

describe('studio Data summary gutter', () => {
  const page = read('src/ui/dsm/DsmPage.tsx');
  const studio = read('src/ui/studio/studio.css');
  const dsm = read('src/ui/dsm/dsm.css');

  it('wraps the pinned summary in the page band, not the scrolling canvas', () => {
    const band = page.indexOf('<div class="ax-page-band">');
    const sectionEnd = page.indexOf('</StudioSection>', band);
    const bandEnd = page.indexOf('</div>', sectionEnd);
    const canvas = page.indexOf('<div class="ax-page-canvas">');
    expect(band).toBeGreaterThan(-1);
    expect(sectionEnd).toBeGreaterThan(band);
    expect(bandEnd).toBeGreaterThan(sectionEnd);
    const bandHtml = page.slice(band, bandEnd);
    expect(bandHtml).toContain('testId="axis-data-summary"');
    expect(bandHtml).not.toContain('ax-page-canvas');
    expect(canvas).toBeGreaterThan(bandEnd);
    expect(page.indexOf('testId="axis-data-datasets-section"')).toBeGreaterThan(canvas);
  });

  it('uses the shared canvas gutter, including the narrow override', () => {
    const band = ruleBody(studio, '.ax-page-band');
    expect(band).toContain('padding-left: var(--ax-canvas-pad)');
    expect(band).toContain('padding-right: var(--ax-canvas-pad)');
    expect(band).not.toMatch(/padding(?:-left|-right)?:\s*\d/);
    const narrow = mediaBlocks(studio, 'max-width:\\s*52rem').find((block) =>
      block.includes('.ax-page-canvas'),
    );
    expect(narrow).toBeTruthy();
    expect(narrow).toContain('.ax-page-band');
    const override = narrow.slice(narrow.indexOf('.ax-page-band'));
    expect(override).toContain('padding-left: 1.25rem');
    expect(override).toContain('padding-right: 1.25rem');
    expect(narrow).toContain('.ax-page-canvas');
  });

  it('does not pad the float panel summary', () => {
    const summary = ruleBody(dsm, '.ax-dsm-summary');
    expect(summary).not.toContain('padding');
    expect(read('src/ui/DataSourceManagerPanel.tsx')).toContain('class="ax-dsm-summary"');
    expect(read('src/ui/DataSourceManagerPanel.tsx')).not.toContain('ax-page-band');
  });
});
