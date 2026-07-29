// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Side-effect bootstrap: register built-in plugins on the legacy registry.
 *
 * Importing this module once (from `main.js`) fills sources/streams/engines.
 * Idempotent via `registered` flag so tests can re-import safely.
 *
 * Adding a built-in = import + `registerSource|Stream|Engine` here.
 * Third-party plugins: `loadPluginFromUrl(url)` on `registry.js` after load.
 *
 * Solid app uses `src/plugins/bootstrap.ts` instead; keep lists in sync when
 * shipping new defaults.
 */

import { registry } from './registry.js';
import { binanceRest, mockWalk, csvUpload } from './sources/index.js';
import { binanceWs, mockPoll, none } from './streams/index.js';
import { serverEngine, pyodideEngine } from './engines/index.js';

let registered = false;

/** Register built-ins once per page/process lifetime. */
export function registerBuiltins() {
    if (registered) return;
    registered = true;
    registry
        .registerSource(binanceRest)
        .registerSource(mockWalk)
        .registerSource(csvUpload)
        .registerStream(binanceWs)
        .registerStream(mockPoll)
        .registerStream(none)
        .registerEngine(serverEngine)
        .registerEngine(pyodideEngine);
}

registerBuiltins();
