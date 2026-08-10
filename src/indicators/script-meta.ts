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
 * Pure helpers for Scripts panel cards — kind, pane placement, engine labels,
 * last-run status. Safe for unit tests (no DOM).
 *
 * @module indicators/script-meta
 */

import type { Indicator } from '../store/types';

export type ScriptKind = 'indicator' | 'strategy' | 'library' | 'unknown';

export type LastRunStatus = 'ok' | 'error' | 'none';

export type EngineFamily = 'server' | 'pyodide' | 'worker' | 'other';

/** Pine declaration kind from source (best-effort). */
export function detectScriptKind(code: string): ScriptKind {
  const src = String(code ?? '');
  // Prefer declaration order: strategy / library / indicator
  if (/\bstrategy\s*\(/.test(src)) return 'strategy';
  if (/\blibrary\s*\(/.test(src)) return 'library';
  if (/\bindicator\s*\(/.test(src)) return 'indicator';
  return 'unknown';
}

/**
 * Pine language version from `//@version=N` (or `// @version = N`).
 * Returns the numeric token only (`"5"`, `"6"`); `null` when absent.
 */
export function detectPineVersion(code: string): string | null {
  const m = String(code ?? '').match(/\/\/\s*@version\s*=\s*(\d+)\b/i);
  return m?.[1] ?? null;
}

/** Human label for library / Scripts panel cards. */
export function scriptKindLabel(kind: ScriptKind): string {
  switch (kind) {
    case 'strategy':
      return 'Strategy';
    case 'library':
      return 'Library';
    case 'indicator':
      return 'Indicator';
    default:
      return 'Unknown';
  }
}

/** Compact badge text (IND / STR / LIB). */
export function scriptKindShort(kind: ScriptKind): string {
  switch (kind) {
    case 'strategy':
      return 'STR';
    case 'library':
      return 'LIB';
    case 'indicator':
      return 'IND';
    default:
      return '?';
  }
}

/**
 * Relative-ish updated time for library cards.
 * Uses compact absolute locale string when older than ~7 days.
 */
export function formatScriptUpdatedAt(
  ts: number | undefined | null,
  now: number = Date.now(),
): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return '';
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'just now';
  if (sec < 90) return '1m ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 36) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

/**
 * Fill {@link ScriptMeta}-like fields from Pine source when missing.
 * Used by storage list/write so library cards can show kind + version.
 */
export function metaFromScriptContent(
  content: string | undefined | null,
  base?: {
    scriptKind?: ScriptKind;
    pineVersion?: string;
  },
): { scriptKind: ScriptKind; pineVersion?: string } {
  const code = String(content ?? '');
  const detected = detectScriptKind(code);
  const scriptKind: ScriptKind =
    base?.scriptKind && base.scriptKind !== 'unknown'
      ? base.scriptKind
      : detected;
  const pineVersion =
    (base?.pineVersion && String(base.pineVersion).trim()) ||
    detectPineVersion(code) ||
    undefined;
  return { scriptKind, pineVersion };
}

/**
 * Explicit `overlay=` in `indicator()` / `strategy()` when present.
 * `null` = not declared (Pine defaults apply at run time).
 */
export function detectDeclaredOverlay(code: string): boolean | null {
  const src = String(code ?? '');
  const m = src.match(
    /\b(?:indicator|strategy)\s*\(\s*[^)]*?\boverlay\s*=\s*(true|false)\b/i,
  );
  if (!m?.[1]) return null;
  return m[1].toLowerCase() === 'true';
}

/** True when the script is painted on the price pane (overlay). */
export function isPricePane(ind: Pick<Indicator, 'paneId'>): boolean {
  return ind.paneId === 'price';
}

/** Short pane label for tooltips. */
export function panePlacementLabel(ind: Pick<Indicator, 'paneId'>): string {
  if (ind.paneId === 'price') return 'Price pane (overlay)';
  if (ind.paneId === 'volume') return 'Volume pane';
  return `Sub-pane · ${ind.paneId}`;
}

/** Collapse engine plugin id to a family for badges. */
export function engineFamily(engineId: string): EngineFamily {
  const id = String(engineId || '').toLowerCase();
  if (!id || id === 'server' || id.includes('server') || id.includes('flask')) {
    return 'server';
  }
  if (id.includes('pyodide') || id.includes('client') || id === 'offline') {
    return 'pyodide';
  }
  if (id.includes('worker') || id.includes('edge') || id.includes('cloudflare')) {
    return 'worker';
  }
  return 'other';
}

export function engineFamilyLabel(fam: EngineFamily, engineId: string): string {
  switch (fam) {
    case 'server':
      return `Engine: Server / Pro API (${engineId || 'server'}) — Pine runs on the backend`;
    case 'pyodide':
      return `Engine: Client (Pyodide) (${engineId}) — Pine runs in the browser`;
    case 'worker':
      return `Engine: Worker / edge (${engineId}) — Pine via Cloudflare or edge host`;
    default:
      return `Engine: ${engineId || 'unknown'}`;
  }
}

/** Inspect last run payload for this script id. */
export function lastRunStatus(run: unknown): LastRunStatus {
  if (run == null || typeof run !== 'object') return 'none';
  const r = run as { status?: string; error?: unknown };
  if (r.status === 'error' || r.error) return 'error';
  if (r.status === 'success' || r.status === 'ok' || r.status == null) {
    // Missing status with no error is treated as ok (runner default)
    if (r.status == null && r.error) return 'error';
    return 'ok';
  }
  return 'none';
}

export function lastRunStatusTitle(status: LastRunStatus): string {
  switch (status) {
    case 'ok':
      return 'Last run succeeded';
    case 'error':
      return 'Last run failed — open Results / Scriptlogs';
    default:
      return 'No run result cached for this script yet';
  }
}

export type LiveRerunOn = 'every-tick' | 'bar-close';

/** Toggle every-tick ↔ bar-close (global live policy). */
export function cycleLiveRerunOn(current: string | undefined): LiveRerunOn {
  return current === 'bar-close' ? 'every-tick' : 'bar-close';
}

/**
 * Human tooltip for live re-run policy (global store.live.rerunOn).
 * Shown on script cards so composition is obvious during Live.
 * @param interactive When true, append “click to switch” hint.
 */
export function liveRerunTitle(
  liveActive: boolean,
  rerunOn: 'every-tick' | 'bar-close' | string,
  interactive = false,
): string {
  let base: string;
  if (!liveActive) {
    base =
      rerunOn === 'bar-close'
        ? 'Live is off · policy: bar close (when Live is enabled, re-run only on closed bars)'
        : 'Live is off · policy: every tick (when Live is enabled, re-run on each update)';
  } else if (rerunOn === 'bar-close') {
    base =
      'Live re-run on bar close only (venue closed flag or bar time advance) — not every tick';
  } else {
    base = 'Live re-run on every tick / bar update (can be heavy)';
  }
  if (interactive) {
    base +=
      rerunOn === 'bar-close'
        ? ' · Click → every tick'
        : ' · Click → bar close only';
  }
  return base;
}

/** Active multi-chart slot summary for Scripts panel context. */
export function activeChartContext(opts: {
  symbol: string;
  interval: string;
  slotCount: number;
  activeSlotId?: string;
}): { line: string; title: string } {
  const sym = (opts.symbol || '—').toUpperCase();
  const iv = opts.interval || '—';
  if (opts.slotCount > 1) {
    return {
      line: `${sym} · ${iv} · ${opts.slotCount} charts`,
      title: `Active chart ${opts.activeSlotId || ''}: ${sym} ${iv} (${opts.slotCount} slots). Scripts re-run on the active composition; switch charts in the layout menu.`,
    };
  }
  return {
    line: `${sym} · ${iv}`,
    title: `Chart context: ${sym} ${iv} — historical source + live stream feed this symbol`,
  };
}
