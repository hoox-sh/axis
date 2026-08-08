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
 * DefiLlama public API fetch helpers (protocol TVL history + protocol search).
 *
 * No API key required. Browser CORS may fail against `api.llama.fi` —
 * callers can pass `baseUrl` pointing at a Worker proxy later.
 *
 * @module onchain/defillama
 */

import { normalizeProtocolSlug } from './adapters';
import type { OnchainDataset, TimePoint } from './types';

export const DEFILLAMA_PROVIDER_ID = 'defillama';
export const DEFILLAMA_DEFAULT_BASE = 'https://api.llama.fi';

const PROTOCOLS_TTL_MS = 10 * 60 * 1000;

export interface DefiLlamaProtocolSummary {
  slug: string;
  name: string;
  tvl?: number;
  category?: string;
  chains?: string[];
}

interface ProtocolsCache {
  fetchedAt: number;
  list: DefiLlamaProtocolSummary[];
}

let protocolsCache: ProtocolsCache | null = null;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function errMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Unknown error';
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Normalize a TVL history entry date to unix **seconds**.
 * DefiLlama typically uses seconds; also accept milliseconds.
 */
function toUnixSeconds(date: unknown): number | null {
  const n = Number(date);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Heuristic: values > year 2100 in seconds (~4e9) are likely ms
  if (n > 1e12) return Math.floor(n / 1000);
  if (n > 1e11) return Math.floor(n / 1000); // borderline ms
  return Math.floor(n);
}

/**
 * Parse DefiLlama protocol `tvl` array into sorted {@link TimePoint}s.
 * Entries: `{ date: unix_sec, totalLiquidityUSD: number }`.
 */
export function parseDefiLlamaTvlHistory(raw: unknown): TimePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: TimePoint[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const time = toUnixSeconds(rec.date);
    const value = Number(
      rec.totalLiquidityUSD ?? rec.tvl ?? rec.totalLiquidity ?? rec.value,
    );
    if (time == null || !Number.isFinite(value)) continue;
    out.push({ time, value });
  }
  out.sort((a, b) => a.time - b.time);
  // Dedup times (last wins)
  if (out.length < 2) return out;
  const deduped: TimePoint[] = [];
  for (const p of out) {
    const last = deduped[deduped.length - 1];
    if (last && last.time === p.time) {
      last.value = p.value;
    } else {
      deduped.push(p);
    }
  }
  return deduped;
}

function resolveBaseUrl(baseUrl?: string): string {
  const b = String(baseUrl || DEFILLAMA_DEFAULT_BASE).trim().replace(/\/+$/, '');
  return b || DEFILLAMA_DEFAULT_BASE;
}

/**
 * Fetch protocol TVL history from DefiLlama and return an {@link OnchainDataset}.
 *
 * @param slug Protocol slug (e.g. `aave`, `uniswap`)
 * @param opts.signal AbortSignal
 * @param opts.baseUrl Override API root (Worker proxy). Default `https://api.llama.fi`
 *
 * Note: browser CORS may fail; set `baseUrl` to a Worker proxy when needed.
 */
export async function fetchDefiLlamaProtocolTvl(
  slug: string,
  opts?: { signal?: AbortSignal; baseUrl?: string },
): Promise<OnchainDataset> {
  const normalized = normalizeProtocolSlug(slug);
  if (!normalized) {
    throw new Error('DefiLlama: protocol slug is required');
  }

  const base = resolveBaseUrl(opts?.baseUrl);
  const url = `${base}/protocol/${encodeURIComponent(normalized)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      signal: opts?.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error(
      `DefiLlama: network error fetching protocol "${normalized}": ${errMessage(err)}. ` +
        'Browser CORS may block api.llama.fi — try a Worker proxy via baseUrl.',
    );
  }

  // Read as text first so HTML SPA shells (wrong host / missing proxy) surface clearly.
  const text = await res.text().catch(() => '');
  const trimmed = text.trim();
  const looksHtml =
    /^<!DOCTYPE/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed) ||
    (res.headers.get('content-type') || '').toLowerCase().includes('text/html');

  if (!res.ok) {
    const hint = trimmed ? ` — ${trimmed.slice(0, 160)}` : '';
    throw new Error(
      `DefiLlama: HTTP ${res.status} for protocol "${normalized}"${hint}`,
    );
  }

  if (looksHtml || !trimmed) {
    throw new Error(
      `DefiLlama: got HTML (not JSON) for protocol "${normalized}" from ${url}. ` +
        'The Backend URL is probably a chart host without /api/onchain (e.g. axis.hoox.sh). ' +
        'Use direct api.llama.fi, or point endpoint at an AXIS Worker (workers.dev / :8787).',
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed) as unknown;
  } catch (err) {
    throw new Error(
      `DefiLlama: invalid JSON for protocol "${normalized}": ${errMessage(err)} ` +
        `(url=${url}, body starts with ${JSON.stringify(trimmed.slice(0, 48))})`,
    );
  }

  if (!json || typeof json !== 'object') {
    throw new Error(`DefiLlama: unexpected response for protocol "${normalized}"`);
  }

  const body = json as Record<string, unknown>;
  const points = parseDefiLlamaTvlHistory(body.tvl);
  if (!points.length) {
    throw new Error(
      `DefiLlama: empty TVL history for protocol "${normalized}" (no usable tvl points)`,
    );
  }

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : normalized;
  const protocolSlug =
    typeof body.slug === 'string' && body.slug.trim()
      ? normalizeProtocolSlug(body.slug)
      : normalized;

  const asOf = nowSec();
  const instrument = {
    chainId: 'all',
    protocolId: protocolSlug,
    metric: 'tvl',
    symbol: `${name} TVL`,
  };

  return {
    id: `defillama-tvl:${protocolSlug}`,
    kind: 'scalar_series',
    instrument,
    resolution: '1d',
    points,
    series: { tvl: points },
    asOf,
    finality: 'finalized',
    provenance: {
      provider: DEFILLAMA_PROVIDER_ID,
      queryId: protocolSlug,
      url,
    },
  };
}

/**
 * Fetch / cache the DefiLlama protocols list (10 min TTL) and filter by name/slug.
 */
export async function searchDefiLlamaProtocols(
  query: string,
  limit = 20,
  opts?: { signal?: AbortSignal; baseUrl?: string },
): Promise<DefiLlamaProtocolSummary[]> {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const max =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), 100)
      : 20;

  const list = await loadProtocolsList(opts);
  if (!q) {
    // Default: highest TVL first
    return list.slice(0, max);
  }

  const scored: Array<{ p: DefiLlamaProtocolSummary; score: number }> = [];
  for (const p of list) {
    const slug = (p.slug || '').toLowerCase();
    const name = (p.name || '').toLowerCase();
    let score = 0;
    if (slug === q || name === q) score = 100;
    else if (slug.startsWith(q) || name.startsWith(q)) score = 80;
    else if (slug.includes(q) || name.includes(q)) score = 50;
    else continue;
    // Prefer higher TVL on ties
    score += Math.min(10, Math.log10((p.tvl || 0) + 1));
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.p);
}

async function loadProtocolsList(opts?: {
  signal?: AbortSignal;
  baseUrl?: string;
}): Promise<DefiLlamaProtocolSummary[]> {
  const now = Date.now();
  if (protocolsCache && now - protocolsCache.fetchedAt < PROTOCOLS_TTL_MS) {
    return protocolsCache.list;
  }

  const base = resolveBaseUrl(opts?.baseUrl);
  const url = `${base}/protocols`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      signal: opts?.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    // Stale cache is better than nothing
    if (protocolsCache?.list?.length) return protocolsCache.list;
    throw new Error(
      `DefiLlama: network error fetching protocols list: ${errMessage(err)}. ` +
        'Browser CORS may block api.llama.fi — try a Worker proxy via baseUrl.',
    );
  }

  if (!res.ok) {
    if (protocolsCache?.list?.length) return protocolsCache.list;
    throw new Error(`DefiLlama: HTTP ${res.status} fetching protocols list`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    if (protocolsCache?.list?.length) return protocolsCache.list;
    throw new Error(`DefiLlama: invalid JSON for protocols list: ${errMessage(err)}`);
  }

  const list = parseProtocolsList(json);
  // Sort by TVL desc for default browse
  list.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
  protocolsCache = { fetchedAt: now, list };
  return list;
}

function parseProtocolsList(raw: unknown): DefiLlamaProtocolSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: DefiLlamaProtocolSummary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const slugRaw =
      typeof rec.slug === 'string'
        ? rec.slug
        : typeof rec.name === 'string'
          ? rec.name
          : '';
    const slug = normalizeProtocolSlug(slugRaw);
    if (!slug) continue;
    const name =
      typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : slug;
    const tvl = Number(rec.tvl);
    const summary: DefiLlamaProtocolSummary = {
      slug,
      name,
      tvl: Number.isFinite(tvl) ? tvl : undefined,
    };
    if (typeof rec.category === 'string') summary.category = rec.category;
    if (Array.isArray(rec.chains)) {
      summary.chains = rec.chains.filter((c): c is string => typeof c === 'string');
    }
    out.push(summary);
  }
  return out;
}

/** @internal test helper */
export function _clearDefiLlamaProtocolsCache(): void {
  protocolsCache = null;
}
