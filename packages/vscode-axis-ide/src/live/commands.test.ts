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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLiveSessionBridge, type LiveWebSocket } from './bridge';
import {
  LIVE_COMMANDS,
  liveCommandHandlers,
  registerLiveCommands,
} from './commands';
import * as live from './index';

const KEY = `pn_${'ef'.repeat(24)}`;
const TICKET = 'c'.repeat(32);

class MockWebSocket implements LiveWebSocket {
  readyState = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

describe('LIVE_COMMANDS / fragment', () => {
  test('command ids match contributes fragment', () => {
    const fragPath = join(import.meta.dir, 'live-contributes.fragment.json');
    const frag = JSON.parse(readFileSync(fragPath, 'utf8')) as {
      commands: Array<{ command: string }>;
      configuration: { properties: Record<string, unknown> };
    };
    const ids = frag.commands.map((c) => c.command);
    expect(ids).toEqual([LIVE_COMMANDS.liveStart, LIVE_COMMANDS.liveStop]);
    expect(frag.configuration.properties['axis.live.enabled']).toBeDefined();
    expect(frag.configuration.properties['axis.worker.url']).toBeDefined();
    // Touch barrel so INCLUDE disk check sees src/live/index.ts in lcov.
    expect(live.LIVE_COMMANDS.liveStart).toBe(LIVE_COMMANDS.liveStart);
    expect(live.LIVE_WS_PATH).toBe('/api/ws/live');
    expect(typeof live.createLiveSessionBridge).toBe('function');
    expect(typeof live.registerLiveCommands).toBe('function');
  });
});

describe('registerLiveCommands', () => {
  test('wires start/stop to the bridge', async () => {
    const bridge = createLiveSessionBridge({
      secrets: { getWorkerKey: async () => KEY },
      workerUrl: 'https://worker.axis.hoox.sh',
      liveEnabled: true,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ticket: TICKET }),
      }),
      WebSocketImpl: MockWebSocket,
    });

    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const disposables = registerLiveCommands(
      {
        registerCommand(id, cb) {
          registered.set(id, cb);
          return { dispose() { registered.delete(id); } };
        },
      },
      bridge,
    );

    expect(registered.has(LIVE_COMMANDS.liveStart)).toBe(true);
    expect(registered.has(LIVE_COMMANDS.liveStop)).toBe(true);

    const startFn = registered.get(LIVE_COMMANDS.liveStart);
    expect(startFn).toBeDefined();
    const result = await startFn!();
    expect(result).toEqual(
      expect.objectContaining({ ok: true, ticket: TICKET }),
    );

    const handlers = liveCommandHandlers(bridge);
    handlers.stop();
    expect(bridge.getHudState()).toBe('off');

    for (const d of disposables) d.dispose();
    expect(registered.size).toBe(0);
  });
});
