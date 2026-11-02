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

/**
 * AXIS CLI resolution for the MCP stdio provider (KD-9).
 *
 * Order: `axis.mcp.command` → `which axis` → if `axis.mcp.allowNpx` then
 * `npx -y @hoox-sh/axis-cli` else null (soft-fail). Never assumes monorepo
 * `bun packages/cli/bin/axis.js` for Marketplace users.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** npm package used when `axis.mcp.allowNpx` is true. */
export const AXIS_CLI_NPX_PACKAGE = '@hoox-sh/axis-cli';

/** PATH binary name looked up after an empty `axis.mcp.command`. */
export const AXIS_CLI_NAME = 'axis';

export type AxisCliResolution = {
  command: string;
  /** Args inserted before `mcp …` (e.g. `['-y', '@hoox-sh/axis-cli']` for npx). */
  argsPrefix: string[];
};

/**
 * Minimal configuration surface — matches `WorkspaceConfiguration` keys under
 * the `axis` section (`mcp.command`, `mcp.allowNpx`).
 */
export type ResolveAxisCliConfig = {
  get<T>(section: string): T | undefined;
};

/** Injectable PATH lookup (tests stub this; default uses `which`). */
export type WhichFn = (
  command: string,
) => Promise<string | null | undefined> | string | null | undefined;

export type ResolveAxisCliOptions = {
  which?: WhichFn;
};

/** Default PATH probe — `which <cmd>`; returns null when missing. */
export async function defaultWhich(command: string): Promise<string | null> {
  const name = String(command || '').trim();
  if (!name) return null;
  try {
    const { stdout } = await execFileAsync('which', [name], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    const path = String(stdout || '').trim();
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the AXIS CLI used to spawn `axis mcp` stdio.
 * Returns null when soft-fail should advertise no MCP definition.
 */
export async function resolveAxisCli(
  cfg: ResolveAxisCliConfig,
  opts?: ResolveAxisCliOptions,
): Promise<AxisCliResolution | null> {
  const rawOverride = cfg.get<string>('mcp.command');
  const override =
    typeof rawOverride === 'string' ? rawOverride.trim() : '';
  if (override) {
    return { command: override, argsPrefix: [] };
  }

  const whichFn = opts?.which ?? defaultWhich;
  const onPath = await whichFn(AXIS_CLI_NAME);
  if (typeof onPath === 'string' && onPath.trim()) {
    return { command: AXIS_CLI_NAME, argsPrefix: [] };
  }

  if (cfg.get<boolean>('mcp.allowNpx') === true) {
    return {
      command: 'npx',
      argsPrefix: ['-y', AXIS_CLI_NPX_PACKAGE],
    };
  }

  return null;
}
