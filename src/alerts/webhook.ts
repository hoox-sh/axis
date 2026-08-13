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
 * Alert delivery: webhook POST + optional browser Notification.
 *
 * Webhook body is a fixed JSON shape with no secrets — safe to log.
 * Failures are swallowed (return false) so evaluation never throws on
 * network/notification errors.
 *
 * @module alerts/webhook
 */

import type { Alert, WebhookPayload } from './types';

/** Default wall-clock budget for alert webhook POSTs. */
export const WEBHOOK_TIMEOUT_MS = 8_000;

/** Build the standard webhook JSON body for a fired alert. */
export function buildWebhookPayload(
  alert: Alert,
  price: number,
  firedAt: number,
): WebhookPayload {
  return {
    alertId: alert.id,
    name: alert.name,
    symbol: alert.symbol,
    price,
    kind: alert.kind,
    firedAt,
  };
}

/**
 * Strict webhook URL policy: https only, no credentials, no loopback / link-local /
 * RFC1918 literals (browser SSRF / hang surface).
 */
export function isAllowedWebhookUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return false;
  }
  // IPv6 loopback / link-local
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('[fe80')) return false;
  // IPv4 dotted literals only (hostnames allowed)
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  return true;
}

/**
 * POST JSON payload to the alert webhook URL.
 * @returns true if the request completed with a 2xx status
 */
export async function fireWebhook(
  url: string,
  payload: WebhookPayload,
  fetchImpl: typeof fetch = fetch,
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  if (!isAllowedWebhookUrl(url)) return false;
  const timeoutMs =
    typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : WEBHOOK_TIMEOUT_MS;
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (ac) {
    timer = setTimeout(() => {
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
  }
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: ac?.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

/**
 * Fire browser Notification when permission is already granted and
 * `alert.notifyBrowser !== false`. Does not call `requestPermission`
 * (that must be user-gesture driven by UI).
 *
 * @returns true if a Notification was constructed
 */
export function notifyBrowserAlert(
  alert: Alert,
  price: number,
  NotificationImpl: typeof Notification | undefined = typeof Notification !== 'undefined'
    ? Notification
    : undefined,
): boolean {
  if (alert.notifyBrowser === false) return false;
  if (!NotificationImpl) return false;
  try {
    if (NotificationImpl.permission !== 'granted') return false;
    const title = alert.name || `Alert: ${alert.symbol}`;
    const body = `${alert.symbol} ${alert.kind} @ ${price}`;
    new NotificationImpl(title, { body, tag: `axis-alert-${alert.id}` });
    return true;
  } catch {
    return false;
  }
}

/**
 * Deliver all side-effects for a fired alert (webhook + browser notify).
 * Safe to call without awaiting if fire-and-forget is preferred.
 */
export async function deliverAlert(
  alert: Alert,
  price: number,
  firedAt: number,
  opts?: {
    fetchImpl?: typeof fetch;
    NotificationImpl?: typeof Notification;
  },
): Promise<{ webhook: boolean; browser: boolean }> {
  const payload = buildWebhookPayload(alert, price, firedAt);
  let webhook = false;
  if (alert.webhookUrl) {
    webhook = await fireWebhook(
      alert.webhookUrl,
      payload,
      opts?.fetchImpl ?? fetch,
    );
  }
  const browser = notifyBrowserAlert(alert, price, opts?.NotificationImpl);
  return { webhook, browser };
}
