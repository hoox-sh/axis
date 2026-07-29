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
 * Legacy in-process plugin registry (pre-Solid path).
 *
 * All historical sources / live streams / Pine engines register here as
 * plain objects with `{ id, name, kind, description, configSchema?, … }`.
 * `kind` is `'source' | 'stream' | 'engine'`. Assert helpers enforce the
 * minimum contract (`fetchHistorical` / `start` / `run`).
 *
 * Prefer `src/plugins/registry.ts` for the Vite + Solid app; this module
 * remains for `main.js`, registry-bootstrap, and older unit tests.
 * Types: `registry.d.ts`.
 */

class Registry {
    constructor() {
        /** @type {Map<string, import('./registry').Source>} */
        this._sources = new Map();
        /** @type {Map<string, import('./registry').Stream>} */
        this._streams = new Map();
        /** @type {Map<string, import('./registry').Engine>} */
        this._engines = new Map();
    }

    // --- Source (historical OHLCV) ---
    registerSource(source) {
        this._assertSource(source);
        this._sources.set(source.id, source);
        return this;
    }
    getSource(id) { return this._sources.get(id); }
    listSources() { return [...this._sources.values()]; }

    // --- Stream (live bars; start() returns stop fn) ---
    registerStream(stream) {
        this._assertStream(stream);
        this._streams.set(stream.id, stream);
        return this;
    }
    getStream(id) { return this._streams.get(id); }
    listStreams() { return [...this._streams.values()]; }

    // --- Engine (Pine run → plots/events) ---
    registerEngine(engine) {
        this._assertEngine(engine);
        this._engines.set(engine.id, engine);
        return this;
    }
    getEngine(id) { return this._engines.get(id); }
    listEngines() { return [...this._engines.values()]; }

    // --- Bulk ---
    /** Drop all plugins (tests). */
    clear() { this._sources.clear(); this._streams.clear(); this._engines.clear(); }
    /** Lightweight catalog snapshot for Manager / UI without methods. */
    summary() {
        return {
            sources: this.listSources().map((s) => ({ id: s.id, name: s.name, description: s.description })),
            streams: this.listStreams().map((s) => ({ id: s.id, name: s.name, description: s.description })),
            engines: this.listEngines().map((e) => ({ id: e.id, name: e.name, description: e.description })),
        };
    }

    _assertSource(s) {
        if (!s || typeof s !== 'object') throw new Error('source: not an object');
        if (!s.id || !s.name) throw new Error('source: id and name required');
        if (s.kind !== 'source') throw new Error(`source: kind must be 'source' (got ${s.kind})`);
        if (typeof s.fetchHistorical !== 'function') throw new Error('source: fetchHistorical() required');
    }
    _assertStream(s) {
        if (!s || typeof s !== 'object') throw new Error('stream: not an object');
        if (!s.id || !s.name) throw new Error('stream: id and name required');
        if (s.kind !== 'stream') throw new Error(`stream: kind must be 'stream' (got ${s.kind})`);
        if (typeof s.start !== 'function') throw new Error('stream: start() required');
    }
    _assertEngine(e) {
        if (!e || typeof e !== 'object') throw new Error('engine: not an object');
        if (!e.id || !e.name) throw new Error('engine: id and name required');
        if (e.kind !== 'engine') throw new Error(`engine: kind must be 'engine' (got ${e.kind})`);
        if (typeof e.run !== 'function') throw new Error('engine: run() required');
    }
}

/** Process-wide singleton used by legacy bootstrap and tests. */
export const registry = new Registry();
export { Registry };

/**
 * Dynamic-import a plugin module URL and register by `kind`.
 * Module may `default`-export, export `plugin`, or export the object itself.
 */
export async function loadPluginFromUrl(url) {
    const mod = await import(/* @vite-ignore */ url);
    const plugin = mod.default || mod.plugin || mod;
    if (!plugin || !plugin.kind) throw new Error(`Plugin at ${url} did not export a plugin object`);
    if (plugin.kind === 'source') registry.registerSource(plugin);
    else if (plugin.kind === 'stream') registry.registerStream(plugin);
    else if (plugin.kind === 'engine') registry.registerEngine(plugin);
    else throw new Error(`Plugin at ${url} has unknown kind: ${plugin.kind}`);
    return plugin;
}
