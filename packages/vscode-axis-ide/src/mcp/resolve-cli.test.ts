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

import { describe, expect, test } from 'bun:test';
import {
  AXIS_CLI_NAME,
  AXIS_CLI_NPX_PACKAGE,
  defaultWhich,
  resolveAxisCli,
  type ResolveAxisCliConfig,
} from './resolve-cli';

function cfg(values: Record<string, unknown>): ResolveAxisCliConfig {
  return {
    get<T>(section: string): T | undefined {
      return values[section] as T | undefined;
    },
  };
}

describe('resolveAxisCli', () => {
  test('branch 1: axis.mcp.command override wins over PATH and allowNpx', async () => {
    const whichCalls: string[] = [];
    const resolved = await resolveAxisCli(
      cfg({
        'mcp.command': '/opt/axis-custom',
        'mcp.allowNpx': true,
      }),
      {
        which: async (name) => {
          whichCalls.push(name);
          return '/usr/bin/axis';
        },
      },
    );
    expect(resolved).toEqual({
      command: '/opt/axis-custom',
      argsPrefix: [],
    });
    expect(whichCalls).toEqual([]);
  });

  test('branch 1: trims override; whitespace-only falls through', async () => {
    const resolved = await resolveAxisCli(
      cfg({ 'mcp.command': '  /usr/local/bin/axis  ' }),
      { which: async () => null },
    );
    expect(resolved).toEqual({
      command: '/usr/local/bin/axis',
      argsPrefix: [],
    });

    const fallthrough = await resolveAxisCli(
      cfg({ 'mcp.command': '   ', 'mcp.allowNpx': false }),
      { which: async () => null },
    );
    expect(fallthrough).toBeNull();
  });

  test('branch 2: which axis when command unset', async () => {
    const resolved = await resolveAxisCli(
      cfg({ 'mcp.command': '', 'mcp.allowNpx': false }),
      { which: async (name) => (name === AXIS_CLI_NAME ? '/usr/bin/axis' : null) },
    );
    expect(resolved).toEqual({ command: AXIS_CLI_NAME, argsPrefix: [] });
  });

  test('branch 3: allowNpx true → npx -y @hoox-sh/axis-cli', async () => {
    const resolved = await resolveAxisCli(
      cfg({ 'mcp.allowNpx': true }),
      { which: async () => null },
    );
    expect(resolved).toEqual({
      command: 'npx',
      argsPrefix: ['-y', AXIS_CLI_NPX_PACKAGE],
    });
  });

  test('soft-fail: allowNpx false/absent and no PATH → null', async () => {
    expect(
      await resolveAxisCli(cfg({}), { which: async () => null }),
    ).toBeNull();
    expect(
      await resolveAxisCli(
        cfg({ 'mcp.allowNpx': false }),
        { which: async () => undefined },
      ),
    ).toBeNull();
    // allowNpx must be strictly true — truthy non-boolean does not opt in.
    expect(
      await resolveAxisCli(
        cfg({ 'mcp.allowNpx': 1 as unknown as boolean }),
        { which: async () => null },
      ),
    ).toBeNull();
  });
});

describe('defaultWhich', () => {
  test('returns null for empty name', async () => {
    expect(await defaultWhich('')).toBeNull();
    expect(await defaultWhich('   ')).toBeNull();
  });

  test('returns null for a command that is not on PATH', async () => {
    expect(
      await defaultWhich('axis-cli-definitely-not-installed-xyz'),
    ).toBeNull();
  });
});
