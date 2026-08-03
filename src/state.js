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
 * Central, localStorage-persisted state for the legacy shell.
 *
 * One source of truth for pre-Solid UI (`main.js`, topbar, settings, etc.):
 * every module reads/writes via {@link getState} / `assign`. Emits
 * `CustomEvent('change', { detail: partial })` on mutation.
 *
 * Prefer Solid `src/store/` for the Vite app; keep default keys aligned when
 * adding settings so hash-sync and migrations stay coherent.
 *
 * Storage key `pynescript.axis.v1`; older keys are copied forward on load.
 */

const STORAGE_KEY = 'pynescript.axis.v1';
/** Older app-state keys; content is copied into STORAGE_KEY once. */
const LEGACY_STORAGE_KEYS = [
    'pynescript.axis.v2',
];

const DEFAULT_STATE = Object.freeze({
    endpoint: 'http://localhost:5002', // pyne Pro API / Worker base
    engine: 'server',           // 'server' | 'pyodide' | <custom registry id>
    source: 'binance-rest',     // 'binance-rest' | 'mock-walk' | 'csv-upload' | <custom>
    stream: 'binance-ws',       // 'binance-ws' | 'mock-poll' | 'none' | <custom>
    symbol: 'BTCUSDT',
    interval: '1d',
    mode: 'local',              // 'local' | 'cloud'
    apiKey: '',
    script: '',
    plugins: [],                // [{id, kind, name, source:'inline'|'url'}]
    pluginsConfig: {},          // { '<pluginId>': { ...user-set fields from configSchema } }
    timeRange: 'ALL',
});

/** In-memory mirror of last successful load/save to avoid rereading localStorage. */
let _savedData = null;

function readKey(key) {
    try {
        return localStorage.getItem(key);
    } catch (_) {
        return null;
    }
}

function load() {
    if (_savedData) return _savedData;
    try {
        let raw = readKey(STORAGE_KEY);
        if (!raw) {
            for (const legacy of LEGACY_STORAGE_KEYS) {
                raw = readKey(legacy);
                if (raw) {
                    try { localStorage.setItem(STORAGE_KEY, raw); } catch (_) { /* quota */ }
                    break;
                }
            }
        }
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        _savedData = parsed && typeof parsed === 'object' ? parsed : null;
        return _savedData;
    } catch (_) {
        return null;
    }
}

function save(partial) {
    try {
        const prev = _savedData || {};
        const next = { ...prev, ...partial };
        // Only stamp savedAt for explicit saves (not every keystroke or trivial state flush)
        _savedData = next;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
    } catch (_) { /* quota */ }
}

/**
 * Immutable bag + EventTarget. Top-level object is frozen; nested plugin
 * config objects are still mutable by reference — callers should replace via assign.
 */
class State extends EventTarget {
    constructor(initial = {}) {
        super();
        this._data = { ...DEFAULT_STATE, ...initial };
        Object.freeze(this._data);
    }

    /** @param {string} [key] omit to get full data object */
    get(key) { return key ? this._data[key] : this._data; }

    /**
     * Merge `partial`, persist to localStorage, fire `change` with the partial.
     * No-op on empty/null partial. Does not set `savedAt` (use {@link persist}).
     */
    assign(partial) {
        if (!partial || typeof partial !== 'object' || !Object.keys(partial).length) return;
        const next = { ...this._data, ...partial };
        this._data = Object.freeze(next);
        save(next);
        this.dispatchEvent(new CustomEvent('change', { detail: partial }));
    }

    /** Shallow copy of current fields (not frozen). */
    snapshot() { return { ...this._data }; }

    /** Explicit save stamp for "user pressed Save" (not every keystroke). */
    persist() {
        const stamped = { ...this._data, savedAt: Date.now() };
        this._data = Object.freeze(stamped);
        save(stamped);
    }
}

/** Singleton instance after {@link initState}; null before bootstrap. */
let _state = null;
export function getState() { return _state; }
/** Create or return singleton, hydrating from localStorage once. */
export function initState() {
    if (_state) return _state;
    const stored = load();
    _state = new State(stored || {});
    return _state;
}
/** Wipe storage keys and reinstall defaults (tests / factory reset). */
export function resetState() {
    localStorage.removeItem(STORAGE_KEY);
    for (const legacy of LEGACY_STORAGE_KEYS) {
        try { localStorage.removeItem(legacy); } catch (_) { /* */ }
    }
    _savedData = null;
    _state = new State();
    return _state;
}

export { STORAGE_KEY };
