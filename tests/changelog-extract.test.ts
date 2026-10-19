/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(import.meta.dir, '../scripts/generate-changelog.py');

function extract(md: string, version: string, tag?: string): { stdout: string; status: number } {
  const dir = mkdtempSync(join(tmpdir(), 'axis-cl-'));
  const path = join(dir, 'CHANGELOG.md');
  writeFileSync(path, md);
  const args = [SCRIPT, '--out', path, '--extract', version];
  if (tag) args.push('--tag', tag);
  const r = spawnSync('python3', args, { encoding: 'utf8' });
  return { stdout: r.stdout || '', status: r.status ?? 1 };
}

const SAMPLE = `# Changelog

## [Unreleased]

### Added
- pending

## [2.24.6] — 2026-10-18

### Added
- **MCP live plane**

### Fixed
- **auth timeout**

## [2.24.5] — 2026-10-17

### Fixed
- older

## Full history (recursive)

### 2026-10
`;

describe('generate-changelog.py --extract', () => {
  it('prints the Keep-a-Changelog section, not the desktop stub', () => {
    const { stdout, status } = extract(SAMPLE, '2.24.6', 'v2.24.6');
    expect(status).toBe(0);
    expect(stdout).toContain('## [2.24.6] — 2026-10-18');
    expect(stdout).toContain('**MCP live plane**');
    expect(stdout).toContain('**auth timeout**');
    expect(stdout).not.toContain('pending');
    expect(stdout).not.toContain('older');
    expect(stdout).not.toContain('Full history');
    expect(stdout).not.toContain('Desktop build of AXIS');
    expect(stdout).toContain('Desktop installers (Tauri 2)');
  });

  it('strips a v tag prefix to match ## [2.24.6]', () => {
    const { stdout, status } = extract(SAMPLE, 'v2.24.6', 'v2.24.6');
    expect(status).toBe(0);
    expect(stdout).toContain('## [2.24.6] — 2026-10-18');
    expect(stdout).toContain('**MCP live plane**');
    expect(stdout).not.toContain('No `## [');
  });

  it('strips a desktop-v tag prefix to match ## [2.24.6]', () => {
    const { stdout, status } = extract(SAMPLE, 'desktop-v2.24.6', 'desktop-v2.24.6');
    expect(status).toBe(0);
    expect(stdout).toContain('## [2.24.6] — 2026-10-18');
    expect(stdout).toContain('**MCP live plane**');
    expect(stdout).not.toContain('No `## [');
    expect(stdout).not.toContain('desktop-v2.24.6');
  });

  it('falls back without the generic stub when the section is missing', () => {
    const { stdout, status } = extract('# Changelog\n\n## [Unreleased]\n', '9.9.9', 'v9.9.9');
    expect(status).toBe(0);
    expect(stdout).toContain('AXIS v9.9.9');
    expect(stdout).toContain('No `## [9.9.9]` section');
    expect(stdout).not.toContain('Desktop build of AXIS (Tauri 2)');
  });

  it('falls back with a stripped desktop-v version in the warning body', () => {
    const { stdout, status } = extract('# Changelog\n\n## [Unreleased]\n', 'desktop-v9.9.9', 'desktop-v9.9.9');
    expect(status).toBe(0);
    expect(stdout).toContain('AXIS desktop-v9.9.9');
    expect(stdout).toContain('No `## [9.9.9]` section');
    expect(stdout).not.toContain('No `## [desktop-v9.9.9]`');
  });
});
