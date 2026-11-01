/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Shared Spinner — source-level pin.
 *
 * Call sites used to hand-roll `Icons.loader class="animate-spin"`. The
 * shared component owns the accessible attributes and the stable test id.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

const CALL_SITES = [
  'src/indicators/IndicatorCard.tsx',
  'src/ui/OnChainPanel.tsx',
  'src/ui/ResultsModal.tsx',
  'src/ui/ScriptSettingsModal.tsx',
  'src/ui/StorageChangeDialog.tsx',
  'src/ui/SymbolModal.tsx',
] as const;

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

describe('Spinner', () => {
  const src = read('src/ui/Spinner.tsx');

  it('exports Spinner', () => {
    expect(src).toMatch(/export const Spinner\b/);
  });

  it('pins accessible loading attributes', () => {
    expect(src).toContain('data-testid="axis-spinner"');
    expect(src).toContain('aria-busy');
    expect(src).toContain('aria-label');
    expect(src).toContain('animate-spin');
    expect(src).toContain('role="status"');
  });
});

describe('Spinner call sites', () => {
  it('import the shared Spinner and no longer render Icons.loader', () => {
    for (const rel of CALL_SITES) {
      const src = read(rel);
      expect(
        src.includes("from './Spinner'") || src.includes("from '../ui/Spinner'"),
      ).toBe(true);
      expect(src).not.toContain('Icons.loader');
    }
  });
});
