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
 * Alerts panel — list / create / toggle / delete price + on-chain alerts.
 *
 * FloatableShell id `alerts`. Uses `src/alerts` (localStorage engine).
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { store, isPanelOpen } from '../store';
import {
  listAlerts,
  createAlert,
  createOnchainTvlSpikeAlert,
  deleteAlert,
  updateAlert,
  testWebhook,
  requestNotificationPermission,
  notificationPermission,
  formatAlertCondition,
  formatLastFired,
  formatAlertKind,
  ALERT_KINDS,
  DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT,
  type Alert,
  type AlertKind,
  type OnchainAlertDirection,
} from '../alerts';
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';

/** True when kind uses on-chain event params (protocol / % / direction). */
function isOnchainKind(k: AlertKind): boolean {
  return k === 'onchain_tvl_spike' || k === 'onchain_event';
}

/** True when kind uses a price threshold. */
function isPriceKind(k: AlertKind): boolean {
  return k === 'price_cross' || k === 'price_above' || k === 'price_below';
}

/** Dockable alerts list + create form (price + on-chain kinds). */
export const AlertsPanel: Component = () => {
  /** Local list mirror — alerts storage is not a Solid store. */
  const [items, setItems] = createSignal<Alert[]>(listAlerts());
  const refresh = () => setItems(listAlerts());

  const [name, setName] = createSignal('');
  const [symbol, setSymbol] = createSignal(store.symbol || 'BTCUSDT');
  const [kind, setKind] = createSignal<AlertKind>('price_cross');
  const [price, setPrice] = createSignal('');
  const [protocolId, setProtocolId] = createSignal(
    store.onchain?.lastProtocolSlug || '',
  );
  const [minAbsPct, setMinAbsPct] = createSignal(String(DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT));
  const [direction, setDirection] = createSignal<OnchainAlertDirection>('both');
  const [cooldownSec, setCooldownSec] = createSignal('');
  const [webhookUrl, setWebhookUrl] = createSignal('');
  const [formError, setFormError] = createSignal('');
  const [statusMsg, setStatusMsg] = createSignal('');
  const [notifPerm, setNotifPerm] = createSignal(notificationPermission());
  const [testingWebhook, setTestingWebhook] = createSignal(false);

  const onchainMode = createMemo(() => isOnchainKind(kind()));
  const priceMode = createMemo(() => isPriceKind(kind()));

  const parseCooldownMs = (): number | undefined => {
    const raw = cooldownSec().trim();
    if (!raw) return undefined;
    const sec = Number(raw);
    if (!Number.isFinite(sec) || sec < 0) return undefined;
    if (sec === 0) return undefined;
    return Math.round(sec * 1000);
  };

  const onKindChange = (next: AlertKind) => {
    setKind(next);
    if (isOnchainKind(next) && !protocolId().trim()) {
      const slug = store.onchain?.lastProtocolSlug || '';
      if (slug) setProtocolId(slug);
    }
  };

  const onCreate = (e?: Event) => {
    e?.preventDefault();
    setFormError('');
    setStatusMsg('');
    const k = kind();
    const webhook = webhookUrl().trim() || undefined;
    const cooldownMs = parseCooldownMs();
    if (cooldownSec().trim() && cooldownMs == null) {
      setFormError('Cooldown must be a non-negative number of seconds.');
      return;
    }

    if (isOnchainKind(k)) {
      const pid = protocolId().trim();
      if (!pid) {
        setFormError('Enter a protocol id (e.g. aave).');
        return;
      }
      const pct = Number(minAbsPct());
      if (!Number.isFinite(pct) || pct <= 0) {
        setFormError('minAbsPct must be a number greater than 0.');
        return;
      }
      const dir = direction();
      const sym = (symbol().trim() || pid || 'onchain').toLowerCase();
      const label =
        name().trim() ||
        `${pid} ${formatAlertKind(k)} ${dir === 'both' ? '±' : dir === 'up' ? '≥+' : '≤−'}${pct}%`;

      if (k === 'onchain_tvl_spike') {
        createOnchainTvlSpikeAlert({
          protocolId: pid,
          minAbsPct: pct,
          direction: dir,
          name: label,
          symbol: sym,
          webhookUrl: webhook,
          cooldownMs,
          enabled: true,
        });
      } else {
        // onchain_event — generic event match with optional % / direction
        createAlert({
          name: label,
          symbol: sym,
          kind: 'onchain_event',
          params: {
            protocolId: pid,
            minAbsPct: pct,
            direction: dir,
          },
          webhookUrl: webhook,
          cooldownMs,
          enabled: true,
        });
      }
      refresh();
      setName('');
      setStatusMsg('Alert created.');
      return;
    }

    // Price kinds (and any future non-onchain kinds using price threshold)
    const p = Number(price());
    if (!Number.isFinite(p) || p <= 0) {
      setFormError('Enter a valid price greater than 0.');
      return;
    }
    const sym = (symbol().trim() || store.symbol || 'BTCUSDT').toUpperCase();
    createAlert({
      name: name().trim() || `${sym} ${formatAlertKind(k)} ${p}`,
      symbol: sym,
      kind: k,
      params: { price: p },
      webhookUrl: webhook,
      cooldownMs,
      enabled: true,
    });
    refresh();
    setName('');
    setPrice('');
    setStatusMsg('Alert created.');
  };

  const onToggle = (a: Alert) => {
    updateAlert(a.id, { enabled: !a.enabled });
    refresh();
  };

  const onDelete = (id: string, label: string) => {
    if (!confirm(`Delete alert “${label}”?`)) return;
    deleteAlert(id);
    refresh();
    setStatusMsg('Alert deleted.');
  };

  const onTestWebhook = async () => {
    const url = webhookUrl().trim();
    if (!url) {
      setFormError('Set a webhook URL to test.');
      return;
    }
    setFormError('');
    setTestingWebhook(true);
    setStatusMsg('Testing webhook…');
    try {
      const res = await testWebhook(url);
      if (res.ok) setStatusMsg(`Webhook OK${res.status != null ? ` (${res.status})` : ''}.`);
      else setStatusMsg(`Webhook failed: ${res.error || 'unknown'}`);
    } finally {
      setTestingWebhook(false);
    }
  };

  const onRequestNotif = async () => {
    const perm = await requestNotificationPermission();
    setNotifPerm(perm);
    if (perm === 'granted') setStatusMsg('Notifications allowed.');
    else if (perm === 'denied') setStatusMsg('Notifications blocked by browser.');
    else if (perm === 'unsupported') setStatusMsg('Notifications not supported.');
    else setStatusMsg(`Notification permission: ${perm}`);
  };

  return (
    <Show when={isPanelOpen('alerts') || store.alertsPanel.open}>
      <FloatableShell id="alerts" testId="axis-alerts">
        <div class="axis-alerts flex-1 overflow-y-auto min-h-0 p-2 text-[0.85em] flex flex-col gap-2">
          <div class="axis-alerts-toolbar flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="sc-btn sc-btn-ghost text-[0.85em]"
              title="Request browser notification permission"
              data-testid="axis-alerts-notif"
              onClick={() => void onRequestNotif()}
            >
              <Icons.alert />
              Notifications
              <span class="text-text-faint font-mono text-[0.9em] ml-0.5">
                ({notifPerm()})
              </span>
            </button>
            <Show when={statusMsg()}>
              <span class="axis-alerts-status text-text-dim text-[0.85em] flex-1 min-w-0 truncate">
                {statusMsg()}
              </span>
            </Show>
          </div>

          <section class="axis-alerts-form" aria-label="Create alert">
            <div class="text-[0.78em] uppercase tracking-wider text-text-faint font-semibold mb-1 px-0.5">
              New alert
            </div>
            <form
              class="flex flex-col gap-1.5 bg-bg-elev border border-border-soft p-2"
              onSubmit={onCreate}
            >
              <label class="axis-alerts-field">
                <span class="axis-alerts-label">Name</span>
                <input
                  class="sc-input w-full"
                  type="text"
                  placeholder="Optional label"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  data-testid="axis-alerts-name"
                />
              </label>
              <div class="grid grid-cols-2 gap-1.5">
                <Show when={!onchainMode()}>
                  <label class="axis-alerts-field">
                    <span class="axis-alerts-label">Symbol</span>
                    <input
                      class="sc-input w-full font-mono"
                      type="text"
                      value={symbol()}
                      onInput={(e) => setSymbol(e.currentTarget.value.toUpperCase())}
                      onFocus={() => {
                        if (!symbol().trim()) setSymbol((store.symbol || 'BTCUSDT').toUpperCase());
                      }}
                      data-testid="axis-alerts-symbol"
                    />
                  </label>
                </Show>
                <label class={`axis-alerts-field ${onchainMode() ? 'col-span-2' : ''}`}>
                  <span class="axis-alerts-label">Kind</span>
                  <select
                    class="sc-input w-full"
                    value={kind()}
                    onChange={(e) => onKindChange(e.currentTarget.value as AlertKind)}
                    data-testid="axis-alerts-kind"
                  >
                    <For each={[...ALERT_KINDS]}>
                      {(k) => <option value={k}>{formatAlertKind(k)}</option>}
                    </For>
                  </select>
                </label>
              </div>

              <Show when={priceMode()}>
                <label class="axis-alerts-field">
                  <span class="axis-alerts-label">Price</span>
                  <input
                    class="sc-input w-full font-mono"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="Threshold"
                    value={price()}
                    onInput={(e) => setPrice(e.currentTarget.value)}
                    data-testid="axis-alerts-price"
                    required
                  />
                </label>
              </Show>

              <Show when={onchainMode()}>
                <label class="axis-alerts-field">
                  <span class="axis-alerts-label">Protocol id</span>
                  <input
                    class="sc-input w-full font-mono"
                    type="text"
                    placeholder="e.g. aave"
                    value={protocolId()}
                    onInput={(e) => setProtocolId(e.currentTarget.value)}
                    data-testid="axis-alerts-protocol"
                    required
                  />
                </label>
                <div class="grid grid-cols-2 gap-1.5">
                  <label class="axis-alerts-field">
                    <span class="axis-alerts-label">Min |%|</span>
                    <input
                      class="sc-input w-full font-mono"
                      type="number"
                      step="any"
                      min="0"
                      placeholder={String(DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT)}
                      value={minAbsPct()}
                      onInput={(e) => setMinAbsPct(e.currentTarget.value)}
                      data-testid="axis-alerts-min-abs-pct"
                    />
                  </label>
                  <label class="axis-alerts-field">
                    <span class="axis-alerts-label">Direction</span>
                    <select
                      class="sc-input w-full"
                      value={direction()}
                      onChange={(e) =>
                        setDirection(e.currentTarget.value as OnchainAlertDirection)
                      }
                      data-testid="axis-alerts-direction"
                    >
                      <option value="both">both</option>
                      <option value="up">up</option>
                      <option value="down">down</option>
                    </select>
                  </label>
                </div>
              </Show>

              <label class="axis-alerts-field">
                <span class="axis-alerts-label">Webhook URL</span>
                <input
                  class="sc-input w-full font-mono text-[0.9em]"
                  type="url"
                  placeholder="https://… (optional)"
                  value={webhookUrl()}
                  onInput={(e) => setWebhookUrl(e.currentTarget.value)}
                  data-testid="axis-alerts-webhook"
                />
              </label>
              <label class="axis-alerts-field">
                <span class="axis-alerts-label">Cooldown (sec)</span>
                <input
                  class="sc-input w-full font-mono"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="optional"
                  value={cooldownSec()}
                  onInput={(e) => setCooldownSec(e.currentTarget.value)}
                  data-testid="axis-alerts-cooldown"
                />
              </label>
              <Show when={formError()}>
                <div class="text-red text-[0.85em]" data-testid="axis-alerts-form-error">
                  {formError()}
                </div>
              </Show>
              <div class="flex flex-wrap gap-1.5 mt-0.5">
                <button
                  type="submit"
                  class="sc-btn sc-btn-primary flex-1"
                  data-testid="axis-alerts-create"
                >
                  Create
                </button>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost"
                  disabled={testingWebhook() || !webhookUrl().trim()}
                  title="POST a test payload to the webhook URL"
                  data-testid="axis-alerts-test-webhook"
                  onClick={() => void onTestWebhook()}
                >
                  Test webhook
                </button>
              </div>
            </form>
          </section>

          <section class="axis-alerts-list flex-1 min-h-0 flex flex-col" aria-label="Alerts">
            <div class="flex items-center justify-between gap-2 px-0.5 mb-1">
              <div class="text-[0.78em] uppercase tracking-wider text-text-faint font-semibold">
                Alerts{' '}
                <span class="text-text-faint font-mono normal-case tracking-normal">
                  ({items().length})
                </span>
              </div>
            </div>
            <Show
              when={items().length > 0}
              fallback={
                <div class="text-text-faint italic px-1 py-1 text-[0.85em]">
                  No alerts yet. Create one above.
                </div>
              }
            >
              <div class="flex flex-col gap-0.5">
                <For each={items()}>
                  {(a) => (
                    <div
                      class={`axis-alerts-row flex items-start gap-1.5 px-1.5 py-1.5 border ${
                        a.enabled
                          ? 'bg-bg-elev border-border-soft'
                          : 'bg-bg-hover border-border-soft opacity-70'
                      }`}
                      data-testid="axis-alerts-row"
                      data-alert-id={a.id}
                      data-enabled={a.enabled ? '1' : '0'}
                    >
                      <button
                        type="button"
                        class={`w-5 h-5 mt-0.5 text-[0.75em] flex items-center justify-center border-2 flex-shrink-0 ${
                          a.enabled
                            ? 'border-accent bg-accent/15 text-accent'
                            : 'border-border bg-bg-hover text-text-dim'
                        }`}
                        title={a.enabled ? 'Disable' : 'Enable'}
                        aria-pressed={a.enabled}
                        data-testid="axis-alerts-toggle"
                        onClick={() => onToggle(a)}
                      >
                        {a.enabled ? '●' : '○'}
                      </button>
                      <div class="min-w-0 flex-1">
                        <div class="text-text truncate font-medium leading-tight">{a.name}</div>
                        <div class="text-[0.78em] text-text-faint font-mono truncate">
                          {a.symbol} · {formatAlertCondition(a)}
                        </div>
                        <div class="text-[0.75em] text-text-faint mt-0.5">
                          Last fired: {formatLastFired(a.lastFiredAt)}
                          {a.webhookUrl ? (
                            <span class="ml-1.5 text-accent/80" title={a.webhookUrl}>
                              · webhook
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red flex-shrink-0"
                        title="Delete alert"
                        data-testid="axis-alerts-delete"
                        onClick={() => onDelete(a.id, a.name)}
                      >
                        <Icons.x />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>
      </FloatableShell>
    </Show>
  );
};
