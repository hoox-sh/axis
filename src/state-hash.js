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
 * Bidirectional URL hash ↔ legacy state sync for shareable chart links.
 *
 * On load, {@link applyHashState} hydrates `getState()` from `#symbol=…&…`.
 * {@link watchHashState} listens for state `change` and debounced
 * `history.replaceState` updates (no history spam). `_updating` prevents
 * feedback loops when applying hash → assign → change → push.
 *
 * Script source is base64(+URI-encoded) and only embedded if short enough
 * (&lt; 500 chars b64); total hash truncated at {@link MAX_HASH_LEN}.
 */

import { getState } from './state.js';

/** Fields always mirrored into the hash when non-empty. */
const HASH_KEYS = ['symbol', 'interval', 'engine', 'source', 'stream', 'timeRange'];
/** Browsers truncate very long URLs; keep head of the param string. */
const MAX_HASH_LEN = 2000;
/** Only these assign keys trigger a hash push (skip noise flushes). */
const MEANINGFUL_FIELDS = new Set(['symbol', 'interval', 'engine', 'source', 'stream', 'timeRange', 'script', 'mode']);

/** True while applying hash → state so pushHashState is skipped. */
let _updating = false;

/** Parse `location.hash` query form into a plain state partial. */
function parseHash() {
    const hash = location.hash.slice(1);
    if (!hash) return {};
    const params = new URLSearchParams(hash);
    const out = {};
    for (const [k, v] of params) {
        if (k === 'script') {
            try { out.script = decodeURIComponent(atob(v)); } catch (_) { out.script = v; }
        } else {
            out[k] = v;
        }
    }
    return out;
}

/** Serialize current state into a hash query string (may omit long scripts). */
function buildHash() {
    const state = getState();
    const params = new URLSearchParams();
    for (const k of HASH_KEYS) {
        const v = state.get(k);
        if (v != null && v !== '') params.set(k, String(v));
    }
    // Encode script (can be long) as base64; skip if too large for a share URL
    const script = state.get('script');
    if (script) {
        try {
            const b64 = btoa(encodeURIComponent(script));
            if (b64.length < 500) params.set('script', b64);
        } catch (_) { /* skip script in hash if encoding fails */ }
    }
    const s = params.toString();
    return s.length > MAX_HASH_LEN ? s.slice(0, MAX_HASH_LEN) : s;
}

/**
 * One-shot hydrate from hash at boot.
 * @returns {boolean} true if any hash keys were applied
 */
export function applyHashState() {
    const hashState = parseHash();
    if (Object.keys(hashState).length === 0) return false;
    _updating = true;
    getState().assign(hashState);
    _updating = false;
    return true;
}

/** Debounced push of current state into the URL hash. */
let _pushTimer = null;
export function pushHashState(e) {
    if (_updating) return;
    // Only push if a meaningful field changed (skip trivial flushes)
    if (e?.detail) {
        const changed = Object.keys(e.detail);
        if (!changed.some((k) => MEANINGFUL_FIELDS.has(k))) return;
    }
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
        const hash = buildHash();
        const newUrl = `${location.pathname}${location.search}#${hash}`;
        if (location.hash.slice(1) !== hash) {
            history.replaceState(null, '', newUrl);
        }
    }, 300);
}

/** Subscribe state → hash and browser back/forward → state. */
export function watchHashState() {
    getState().addEventListener('change', pushHashState);
    window.addEventListener('popstate', () => {
        if (_updating) return;
        _updating = true;
        const hashState = parseHash();
        if (Object.keys(hashState).length > 0) {
            getState().assign(hashState);
        }
        _updating = false;
    });
}
