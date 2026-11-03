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
 * Workers studio messages (`axis.workers` webview).
 * Pure — no `vscode` import. Never throws.
 * Cards expose status, latency, endpoint host, and a short error label only.
 */

export const WORKERS_STUDIO_STATUSES = [
  'healthy',
  'degraded',
  'down',
  'unknown',
  'idle',
  'skipped',
] as const;

export type WorkersStudioStatus = (typeof WORKERS_STUDIO_STATUSES)[number];

export type WorkerStudioCard = {
  id: string;
  name: string;
  summary: string;
  probe: string;
  endpoint: string;
  status: WorkersStudioStatus;
  latencyMs: number | null;
  detail: string;
};

export type WorkersStudioCounts = {
  healthy: number;
  degraded: number;
  down: number;
  unknown: number;
};

export type WorkersStudioSnapshot = {
  cards: WorkerStudioCard[];
  counts: WorkersStudioCounts;
  probed: boolean;
};

export type WorkersHostToWeb =
  | ({ type: 'workers.init' } & WorkersStudioSnapshot)
  | ({ type: 'workers.state' } & WorkersStudioSnapshot);

export type WorkersWebToHost =
  | { type: 'workers.ready' }
  | { type: 'workers.probeAll' }
  | { type: 'workers.probe'; id: string };

export type WorkersStudioMessage = WorkersHostToWeb | WorkersWebToHost;

const STATUS_SET = new Set<string>(WORKERS_STUDIO_STATUSES);
const SECRET_RE = /token|secret|password|api[_-]?key|authorization|bearer/i;
const MAX_DETAIL = 80;
const MAX_ID = 64;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Host only — no userinfo, path, query, or fragment. */
export function displayWorkerEndpoint(raw: unknown): string {
  const text = readString(raw, 500);
  if (!text) return '';
  try {
    const url = new URL(text);
    const host = url.host;
    if (!host || SECRET_RE.test(host)) return '';
    return host.slice(0, 200);
  } catch {
    const noFrag = text.split('#')[0] ?? '';
    const noQuery = noFrag.split('?')[0] ?? '';
    const at = noQuery.lastIndexOf('@');
    const hostish = (at >= 0 ? noQuery.slice(at + 1) : noQuery).split('/')[0] ?? '';
    const host = hostish.trim();
    if (!host || SECRET_RE.test(host) || host.includes('=')) return '';
    return host.slice(0, 200);
  }
}

function normalizeStatus(raw: unknown, hasResult: boolean): WorkersStudioStatus {
  if (!hasResult) return 'unknown';
  if (typeof raw === 'string' && STATUS_SET.has(raw)) {
    return raw as WorkersStudioStatus;
  }
  return 'unknown';
}

function latencyOf(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

/** Short error label. Healthy / idle bodies are dropped. */
export function shortWorkerErrorLabel(
  status: WorkersStudioStatus,
  detail: unknown,
  error: unknown,
): string {
  if (
    status === 'healthy' ||
    status === 'unknown' ||
    status === 'idle' ||
    status === 'skipped'
  ) {
    return '';
  }
  const fromError = readString(error, 400);
  const fromDetail = readString(detail, 400);
  const raw = fromError || fromDetail;
  if (!raw) return status === 'degraded' ? 'degraded' : 'down';
  if (
    SECRET_RE.test(raw) ||
    raw.startsWith('{') ||
    raw.startsWith('[') ||
    raw.length > 180
  ) {
    return status === 'degraded' ? 'degraded' : 'down';
  }
  return raw.slice(0, MAX_DETAIL);
}

function cardFromFields(
  idRaw: unknown,
  nameRaw: unknown,
  summaryRaw: unknown,
  probeRaw: unknown,
  endpointRaw: unknown,
  fallbackEndpoint: unknown,
  statusRaw: unknown,
  hasResult: boolean,
  latencyRaw: unknown,
  detailRaw: unknown,
  errorRaw: unknown,
): WorkerStudioCard | null {
  const id = readString(idRaw, MAX_ID);
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return null;
  const name = readString(nameRaw, 120) || id;
  const status = normalizeStatus(statusRaw, hasResult);
  const endpoint =
    displayWorkerEndpoint(endpointRaw) || displayWorkerEndpoint(fallbackEndpoint);
  return {
    id,
    name,
    summary: readString(summaryRaw, 240),
    probe: readString(probeRaw, 40),
    endpoint,
    status,
    latencyMs: hasResult ? latencyOf(latencyRaw) : null,
    detail: shortWorkerErrorLabel(status, detailRaw, errorRaw),
  };
}

function readResults(snapshot: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  try {
    if (!isPlainObject(snapshot)) return map;
    const results = snapshot.results;
    if (!Array.isArray(results)) return map;
    for (const row of results) {
      try {
        if (!isPlainObject(row)) continue;
        const id = readString(row.id, MAX_ID);
        if (!id) continue;
        map.set(id, row);
      } catch {
        // skip hostile row
      }
    }
  } catch {
    return map;
  }
  return map;
}

export function countsFromWorkerCards(cards: readonly WorkerStudioCard[]): WorkersStudioCounts {
  const counts: WorkersStudioCounts = {
    healthy: 0,
    degraded: 0,
    down: 0,
    unknown: 0,
  };
  try {
    for (const card of cards) {
      if (card.status === 'healthy') counts.healthy += 1;
      else if (card.status === 'degraded') counts.degraded += 1;
      else if (card.status === 'down') counts.down += 1;
      else counts.unknown += 1;
    }
  } catch {
    return { healthy: 0, degraded: 0, down: 0, unknown: 0 };
  }
  return counts;
}

function snapshotProbed(snapshot: unknown): boolean {
  return isPlainObject(snapshot);
}

/**
 * Map catalog entries + optional probe snapshot to display cards.
 * Missing snapshot → status `unknown` (not healthy). Never throws.
 */
export function buildWorkersCards(catalog: unknown, snapshot: unknown): WorkerStudioCard[] {
  try {
    if (!Array.isArray(catalog)) return [];
    const results = readResults(snapshot);
    const out: WorkerStudioCard[] = [];
    for (const entry of catalog) {
      try {
        if (!isPlainObject(entry)) continue;
        const id = readString(entry.id, MAX_ID);
        const row = id ? results.get(id) : undefined;
        const card = cardFromFields(
          entry.id,
          entry.name,
          entry.summary,
          entry.probe,
          row ? row.endpoint : '',
          entry.defaultEndpoint,
          row ? row.status : undefined,
          Boolean(row),
          row ? row.latencyMs : null,
          row ? row.detail : '',
          row ? row.error : '',
        );
        if (card) out.push(card);
      } catch {
        // skip hostile catalog entry
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function workersStudioSnapshot(
  catalog: unknown,
  snapshot: unknown,
): WorkersStudioSnapshot {
  const cards = buildWorkersCards(catalog, snapshot);
  return {
    cards,
    counts: countsFromWorkerCards(cards),
    probed: snapshotProbed(snapshot),
  };
}

function hostMessage(
  type: 'workers.init' | 'workers.state',
  catalog: unknown,
  snapshot: unknown,
): WorkersHostToWeb {
  const view = workersStudioSnapshot(catalog, snapshot);
  return type === 'workers.init'
    ? { type: 'workers.init', ...view }
    : { type: 'workers.state', ...view };
}

/** Encode `workers.init` (never throws). */
export function encodeWorkersInit(catalog: unknown, snapshot: unknown): WorkersHostToWeb {
  return hostMessage('workers.init', catalog, snapshot);
}

/** Encode `workers.state` (never throws). */
export function encodeWorkersState(catalog: unknown, snapshot: unknown): WorkersHostToWeb {
  return hostMessage('workers.state', catalog, snapshot);
}

export function encodeWorkersReady(): WorkersWebToHost {
  return { type: 'workers.ready' };
}

export function encodeWorkersProbeAll(): WorkersWebToHost {
  return { type: 'workers.probeAll' };
}

export function encodeWorkersProbe(id: unknown): WorkersWebToHost | null {
  const text = readString(id, MAX_ID);
  if (!text || !/^[A-Za-z0-9._-]+$/.test(text)) return null;
  return { type: 'workers.probe', id: text };
}

function parseHostCards(raw: unknown): WorkerStudioCard[] | null {
  try {
    if (!Array.isArray(raw)) return null;
    const out: WorkerStudioCard[] = [];
    for (const item of raw) {
      try {
        if (!isPlainObject(item)) continue;
        const card = cardFromFields(
          item.id,
          item.name,
          item.summary,
          item.probe,
          item.endpoint,
          '',
          item.status,
          true,
          item.latencyMs,
          item.detail,
          item.error,
        );
        if (card) out.push(card);
      } catch {
        // skip hostile card
      }
    }
    return out;
  } catch {
    return null;
  }
}

function parseProbeId(raw: Record<string, unknown>): string | null {
  try {
    const payload = isPlainObject(raw.payload) ? raw.payload : undefined;
    const idRaw = raw.id ?? payload?.id;
    const encoded = encodeWorkersProbe(idRaw);
    return encoded && encoded.type === 'workers.probe' ? encoded.id : null;
  } catch {
    return null;
  }
}

/**
 * Parse a workers studio postMessage (either direction). Never throws.
 * Spoofed counts are ignored — counts are derived from cards.
 */
export function parseWorkersStudioMessage(raw: unknown): WorkersStudioMessage | null {
  try {
    if (!isPlainObject(raw)) return null;
    const type = raw.type;
    if (type === 'workers.ready') return { type: 'workers.ready' };
    if (type === 'workers.probeAll') return { type: 'workers.probeAll' };
    if (type === 'workers.probe') {
      const id = parseProbeId(raw);
      if (!id) return null;
      return { type: 'workers.probe', id };
    }
    if (type === 'workers.init' || type === 'workers.state') {
      const cards = parseHostCards(raw.cards);
      if (!cards) return null;
      const view: WorkersStudioSnapshot = {
        cards,
        counts: countsFromWorkerCards(cards),
        probed: raw.probed === true,
      };
      return type === 'workers.init'
        ? { type: 'workers.init', ...view }
        : { type: 'workers.state', ...view };
    }
    return null;
  } catch {
    return null;
  }
}
