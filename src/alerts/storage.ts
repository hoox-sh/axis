// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Local-first alert persistence (`axis.alerts.v1`).
 *
 * Primary backend: `localStorage`. Falls back to an in-memory map when
 * localStorage is unavailable (SSR / restricted contexts / tests without LS).
 *
 * @module alerts/storage
 */

import type { Alert, AlertsStoreV1 } from './types';

/** localStorage key for the alerts blob. */
export const ALERTS_STORAGE_KEY = 'axis.alerts.v1';

/** In-memory fallback when localStorage is missing or throws. */
let memoryStore: Alert[] | null = null;

/** Last localStorage persist failure (quota / blocked), if any. */
let lastPersistError: string | null = null;

/** Human status of the last {@link saveAlerts} persist attempt. */
export function lastAlertsPersistError(): string | null {
  return lastPersistError;
}

/** Cached parse of the last-seen LS blob (F13: one JSON.parse per change). */
let cachedRaw: string | null | undefined;
let cachedList: Alert[] | null = null;

function cloneList(list: Alert[]): Alert[] {
  return list.map((a) => ({ ...a, params: { ...a.params } }));
}

type AlertsListener = () => void;
const listeners = new Set<AlertsListener>();

/** Subscribe to persist writes. Returns an unsubscribe function. */
export function subscribeAlerts(fn: AlertsListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notifyAlertsListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* listener errors must not break persist */
    }
  }
}

function lsAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

function lsGet(key: string): string | null {
  try {
    if (!lsAvailable()) return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): boolean {
  try {
    if (!lsAvailable()) return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function lsRemove(key: string): void {
  try {
    if (!lsAvailable()) return;
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Validate and coerce a raw object into an Alert, or null if unusable. */
export function parseAlert(raw: unknown): Alert | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.name !== 'string') return null;
  if (typeof o.symbol !== 'string') return null;
  if (typeof o.kind !== 'string') return null;
  if (typeof o.createdAt !== 'number' || !Number.isFinite(o.createdAt)) return null;

  const params =
    o.params && typeof o.params === 'object' && !Array.isArray(o.params)
      ? ({ ...(o.params as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  const alert: Alert = {
    id: o.id,
    name: o.name,
    enabled: o.enabled !== false,
    symbol: o.symbol,
    kind: o.kind as Alert['kind'],
    params,
    createdAt: o.createdAt,
  };

  if (typeof o.interval === 'string' && o.interval) alert.interval = o.interval;
  if (typeof o.webhookUrl === 'string' && o.webhookUrl) alert.webhookUrl = o.webhookUrl;
  if (typeof o.l2WebhookUrl === 'string' && o.l2WebhookUrl) {
    alert.l2WebhookUrl = o.l2WebhookUrl;
  }
  if (typeof o.notifyBrowser === 'boolean') alert.notifyBrowser = o.notifyBrowser;
  if (typeof o.cooldownMs === 'number' && Number.isFinite(o.cooldownMs)) {
    alert.cooldownMs = o.cooldownMs;
  }
  if (typeof o.lastFiredAt === 'number' && Number.isFinite(o.lastFiredAt)) {
    alert.lastFiredAt = o.lastFiredAt;
  }

  return alert;
}

/** Parse the storage blob; returns [] on missing/corrupt data. */
export function parseAlertsBlob(raw: string | null): Alert[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (Array.isArray(data)) {
      return data.map(parseAlert).filter((a): a is Alert => a != null);
    }
    if (data && typeof data === 'object') {
      const blob = data as Partial<AlertsStoreV1>;
      if (Array.isArray(blob.alerts)) {
        return blob.alerts.map(parseAlert).filter((a): a is Alert => a != null);
      }
    }
  } catch {
    /* corrupt */
  }
  return [];
}

function serialize(alerts: Alert[]): string {
  const blob: AlertsStoreV1 = { version: 1, alerts };
  return JSON.stringify(blob);
}

/**
 * Load all alerts from localStorage (or memory fallback).
 * Always returns a new array of shallow-cloned alerts.
 * The LS blob is parsed at most once per distinct raw value (F13).
 */
export function loadAlerts(): Alert[] {
  const raw = lsGet(ALERTS_STORAGE_KEY);
  if (raw != null) {
    if (cachedList && raw === cachedRaw) return cloneList(cachedList);
    const list = parseAlertsBlob(raw);
    cachedRaw = raw;
    cachedList = list;
    memoryStore = cloneList(list);
    return cloneList(memoryStore);
  }
  if (memoryStore) {
    return cloneList(memoryStore);
  }
  return [];
}

/**
 * Persist the full alert list. Updates memory fallback always;
 * writes localStorage when available.
 * @returns true when the durable LS write succeeded (or LS is unavailable
 *   and memory-only mode applies); false on quota/blocked failure — see
 *   {@link lastAlertsPersistError} (F15).
 */
export function saveAlerts(alerts: Alert[]): boolean {
  const copy = cloneList(alerts);
  memoryStore = copy;
  cachedList = copy;
  let ok = true;
  if (lsAvailable()) {
    const json = serialize(copy);
    ok = lsSet(ALERTS_STORAGE_KEY, json);
    if (ok) {
      cachedRaw = json;
      lastPersistError = null;
    } else {
      lastPersistError = 'alerts persist failed: localStorage quota or access denied';
    }
  } else {
    cachedRaw = serialize(copy);
    lastPersistError = null;
  }
  notifyAlertsListeners();
  return ok;
}

/** Replace one alert by id (or no-op if missing). Returns updated list. */
export function upsertAlert(alert: Alert): Alert[] {
  const list = loadAlerts();
  const idx = list.findIndex((a) => a.id === alert.id);
  if (idx >= 0) list[idx] = { ...alert, params: { ...alert.params } };
  else list.push({ ...alert, params: { ...alert.params } });
  saveAlerts(list);
  return list;
}

/** Remove alert by id. Returns whether something was removed. */
export function removeAlert(id: string): boolean {
  const list = loadAlerts();
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  saveAlerts(next);
  return true;
}

/** Clear all alerts from storage (tests). */
export function clearAlertsStorage(): void {
  memoryStore = null;
  cachedRaw = undefined;
  cachedList = null;
  lastPersistError = null;
  lsRemove(ALERTS_STORAGE_KEY);
}

/** Test helper: seed memory without touching a real LS if desired. */
export function _setMemoryAlertsForTests(alerts: Alert[] | null): void {
  memoryStore = alerts ? cloneList(alerts) : null;
  cachedRaw = undefined;
  cachedList = null;
}
