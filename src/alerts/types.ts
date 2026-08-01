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
 * Alert domain types — shared by engine, storage, webhook, and UI.
 *
 * @module alerts/types
 */

/** Supported alert condition kinds. */
export type AlertKind =
  | 'price_cross'
  | 'price_above'
  | 'price_below'
  | 'pct_change'
  | 'drawing_touch'
  | 'pine_condition';

/**
 * Kind-specific parameters.
 * Common keys:
 * - price / prices — level(s) for price_* / drawing_touch
 * - pct, direction, basePrice — pct_change
 * - condition / value / threshold / op — pine_condition
 * - tolerance — drawing_touch
 */
export type AlertParams = Record<string, unknown>;

/** One user-defined alert (persisted in `axis.alerts.v1`). */
export interface Alert {
  id: string;
  name: string;
  enabled: boolean;
  symbol: string;
  kind: AlertKind;
  params: AlertParams;
  /** Epoch ms when created. */
  createdAt: number;
  /** Optional interval filter (empty/omitted = any). */
  interval?: string;
  /** Optional HTTP endpoint POSTed on fire. */
  webhookUrl?: string;
  /** Browser Notification on fire (default true when created via API). */
  notifyBrowser?: boolean;
  /** Minimum ms between fires. */
  cooldownMs?: number;
  /** Epoch ms of last fire. */
  lastFiredAt?: number;
}

/** Fields for {@link createAlert} (id/timestamps filled when omitted). */
export interface AlertCreateInput {
  id?: string;
  name: string;
  symbol: string;
  kind: AlertKind;
  params?: AlertParams;
  enabled?: boolean;
  createdAt?: number;
  interval?: string;
  webhookUrl?: string;
  notifyBrowser?: boolean;
  cooldownMs?: number;
}

/** Patch for {@link updateAlert} (id and createdAt are immutable). */
export type AlertUpdatePatch = Partial<Omit<Alert, 'id' | 'createdAt'>>;

/** Minimal bar slice for pct / drawing evaluation. */
export interface EvaluateBar {
  open: number;
  high: number;
  low: number;
  close: number;
  time?: number;
}

/** Market context passed to the pure evaluator. */
export interface EvaluateContext {
  symbol: string;
  /** Last / current price. */
  price: number;
  interval?: string;
  /** Override previous price for cross detection (else engine map). */
  prevPrice?: number;
  /** Optional recent bars (pct base, drawing high/low). */
  bars?: EvaluateBar[];
  /** Evaluation clock (epoch ms). */
  time?: number;
}

/** JSON body POSTed to webhooks. */
export interface WebhookPayload {
  alertId: string;
  name: string;
  symbol: string;
  price: number;
  kind: AlertKind;
  firedAt: number;
}

/** Versioned localStorage blob. */
export interface AlertsStoreV1 {
  version: 1;
  alerts: Alert[];
}
