// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';
import { isVersionOlderThan } from '../semver';

function isCI(): boolean {
  return !!(process.env.CI || process.env.GITHUB_ACTIONS);
}

function versionFromPyneVsix(filePath: string): string | undefined {
  const m = /^pyne-vscode-(.+)\.vsix$/i.exec(path.basename(filePath));
  return m?.[1];
}

/** Prefer the highest release-segment version among candidate VSIX paths. */
function pickNewestPyneVsix(paths: string[]): string | undefined {
  let best: string | undefined;
  let bestVer: string | undefined;
  for (const p of paths) {
    const ver = versionFromPyneVsix(p);
    if (!ver) continue;
    if (!bestVer || isVersionOlderThan(bestVer, ver)) {
      best = p;
      bestVer = ver;
    }
  }
  return best;
}

/** Prefer AXIS_IDE_PYNE_VSIX; else newest pyne-vscode-*.vsix in sibling checkouts. */
function findPyneVsix(): string | undefined {
  const override = process.env.AXIS_IDE_PYNE_VSIX?.trim();
  if (override) {
    return fs.existsSync(override) ? override : undefined;
  }

  const dirs = [
    path.resolve(__dirname, '../../../../../pynescript/vscode-extension'),
    path.resolve(__dirname, '../../../../../pyne/vscode-extension'),
  ];

  const found: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (/^pyne-vscode-.*\.vsix$/i.test(name)) {
        found.push(path.join(dir, name));
      }
    }
  }
  return pickNewestPyneVsix(found);
}

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './index');
    const vscodeExecutablePath = await downloadAndUnzipVSCode('1.95.0');

    const pyneVsix = findPyneVsix();
    if (!pyneVsix) {
      const hint =
        'Set AXIS_IDE_PYNE_VSIX to a pyne-vscode-*.vsix path, or place one under a sibling pynescript/pyne checkout.';
      if (isCI()) {
        console.error(`[axis-ide test] Missing hoox-sh.pyne VSIX (required in CI). ${hint}`);
        process.exit(1);
      }
      console.warn(`[axis-ide test] No PYNE VSIX found; activation may fail. ${hint}`);
    } else {
      const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
      console.log(`[axis-ide test] Installing dependency VSIX: ${pyneVsix}`);
      const install = spawnSync(cli, [...cliArgs, '--install-extension', pyneVsix], {
        encoding: 'utf8',
        stdio: 'inherit',
      });
      if (install.status !== 0) {
        const msg = '[axis-ide test] PYNE VSIX install failed.';
        if (isCI()) {
          console.error(msg);
          process.exit(1);
        }
        console.warn(`${msg} Continuing locally (activation may soft-fail).`);
      }
    }

    // Keep hoox-sh.pyne loadable — do not pass --disable-extensions.
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-workspace-trust'],
    });
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exit(1);
  }
}

void main();
