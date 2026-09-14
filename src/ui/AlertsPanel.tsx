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
 * Alerts panel — list / create / toggle / delete local alerts.
 *
 * Kinds: price, % change, drawing touch, indicator plot, Pine alert()/alertcondition(), on-chain.
 * Delivery: browser Notification, generic webhook, L2 webhook.
 *
 * FloatableShell id `alerts`. Engine lives in `src/alerts` (no Solid).
 */

import {
  type Component,
  type JSX,
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { store, isPanelOpen } from '../store';
import { drawingsForSymbol } from '../chart/drawings/sync';
import {
  listAlerts,
  createAlert,
  deleteAlert,
  updateAlert,
  testWebhook,
  requestNotificationPermission,
  notificationPermission,
  formatAlertCondition,
  formatLastFired,
  formatAlertKind,
  ALERT_KIND_GROUPS,
  alertKindGroup,
  subscribeAlerts,
  buildAlertFromDraft,
  drawingAlertLabel,
  pricesFromDrawing,
  listPlotKeys,
  lastNumericSample,
  PINE_COMPARE_OPS,
  buildL2WebhookPayload,
  isPriceKind,
  isOnchainKind,
  isPctKind,
  isDrawingKind,
  isIndicatorKind,
  isPineAlertKind,
  isPlotConditionKind,
  collectPineAlertEvents,
  listPineAlertTitles,
  DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT,
  type Alert,
  type AlertKind,
  type OnchainAlertDirection,
} from '../alerts';
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';
import { announce } from './sr-announce';

type FilterId = 'all' | 'price' | 'drawing' | 'indicator' | 'onchain';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'price', label: 'Price' },
  { id: 'drawing', label: 'Drawing' },
  { id: 'indicator', label: 'Indicator' },
  { id: 'onchain', label: 'On-chain' },
];

function lastClose(): number | null {
  const bars = store.bars;
  if (!Array.isArray(bars) || !bars.length) return null;
  const c = Number(bars[bars.length - 1]?.close);
  return Number.isFinite(c) ? c : null;
}

function Field(props: { label: string; class?: string; children: JSX.Element }) {
  return (
    <div class={`axis-alerts-field ${props.class || ''}`}>
      <span class="axis-alerts-label">{props.label}</span>
      {props.children}
    </div>
  );
}

/** Dockable alerts list + create form. */
export const AlertsPanel: Component = () => {
  const [items, setItems] = createSignal<Alert[]>(listAlerts());
  const refresh = () => setItems(listAlerts());

  const [name, setName] = createSignal('');
  const [symbol, setSymbol] = createSignal(store.symbol || 'BTCUSDT');
  const [kind, setKind] = createSignal<AlertKind>('price_cross');
  const [price, setPrice] = createSignal('');
  const [pct, setPct] = createSignal('');
  const [pctDirection, setPctDirection] = createSignal<OnchainAlertDirection>('both');
  const [drawingId, setDrawingId] = createSignal('');
  const [tolerance, setTolerance] = createSignal('');
  const [indicatorId, setIndicatorId] = createSignal('');
  const [plotKey, setPlotKey] = createSignal('');
  const [op, setOp] = createSignal<(typeof PINE_COMPARE_OPS)[number]>('>');
  const [threshold, setThreshold] = createSignal('');
  const [pineSource, setPineSource] = createSignal<'any' | 'alert' | 'alertcondition'>('any');
  const [pineTitle, setPineTitle] = createSignal('');
  const [protocolId, setProtocolId] = createSignal(store.onchain?.lastProtocolSlug || '');
  const [minAbsPct, setMinAbsPct] = createSignal(String(DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT));
  const [direction, setDirection] = createSignal<OnchainAlertDirection>('both');
  const [cooldownSec, setCooldownSec] = createSignal('');
  const [webhookUrl, setWebhookUrl] = createSignal('');
  const [l2WebhookUrl, setL2WebhookUrl] = createSignal('');
  const [notifyBrowser, setNotifyBrowser] = createSignal(true);
  const [bindInterval, setBindInterval] = createSignal(false);
  const [formError, setFormError] = createSignal('');
  const [statusMsg, setStatusMsg] = createSignal('');
  const [notifPerm, setNotifPerm] = createSignal(notificationPermission());
  const [testingWebhook, setTestingWebhook] = createSignal<'webhook' | 'l2' | null>(null);
  const [filter, setFilter] = createSignal<FilterId>('all');

  onMount(() => {
    const unsub = subscribeAlerts(refresh);
    onCleanup(unsub);
  });

  const chartDrawings = createMemo(() =>
    drawingsForSymbol(store.drawings, store.symbol, { includeUntagged: true }).filter(
      (d) => pricesFromDrawing(d).length > 0,
    ),
  );

  const scripts = createMemo(() => store.scripts || []);

  const plotOptions = createMemo(() => {
    const id = indicatorId();
    if (!id) return [];
    const ind = scripts().find((s) => s.id === id);
    return listPlotKeys(id, store.indicatorSeries, ind?.plots);
  });

  const selectedDrawingPrices = createMemo(() => {
    const id = drawingId();
    if (!id) return [] as number[];
    const d = chartDrawings().find((x) => x.id === id);
    return d ? pricesFromDrawing(d) : [];
  });

  const pineTitles = createMemo(() => {
    const id = indicatorId();
    const run = (id && store.runResults?.[id]) || store.lastRun || null;
    const events = collectPineAlertEvents((run as Record<string, unknown>) || {});
    const src = pineSource();
    const titles = listPineAlertTitles(events);
    if (src === 'any') return titles;
    return titles.filter((t) => t.source === src);
  });

  const lastPlotPreview = createMemo(() => {
    const id = indicatorId();
    const plot = plotKey();
    if (!id || !plot) return null;
    return lastNumericSample(store.indicatorSeries[id]?.series?.[plot]);
  });

  const filtered = createMemo(() => {
    const f = filter();
    const list = items();
    if (f === 'all') return list;
    return list.filter((a) => alertKindGroup(a.kind) === f);
  });

  const onKindChange = (next: AlertKind) => {
    setKind(next);
    setFormError('');
    if (isOnchainKind(next) && !protocolId().trim()) {
      const slug = store.onchain?.lastProtocolSlug || '';
      if (slug) setProtocolId(slug);
    }
    if (isIndicatorKind(next) && !indicatorId()) {
      const first = scripts()[0];
      if (first) setIndicatorId(first.id);
    }
    if (isDrawingKind(next) && !drawingId()) {
      const first = chartDrawings()[0];
      if (first) setDrawingId(first.id);
    }
  };

  const onIndicatorChange = (id: string) => {
    setIndicatorId(id);
    const keys = listPlotKeys(
      id,
      store.indicatorSeries,
      scripts().find((s) => s.id === id)?.plots,
    );
    setPlotKey(keys[0]?.key || '');
  };

  const onUseLast = () => {
    const c = lastClose();
    if (c == null) {
      setFormError('No chart price yet — load a symbol first.');
      return;
    }
    setPrice(String(c));
    setFormError('');
  };

  const onUseLastPlot = () => {
    const v = lastPlotPreview();
    if (v == null) {
      setFormError('No plot sample yet — run the indicator first.');
      return;
    }
    setThreshold(String(v));
    setFormError('');
  };

  const onCreate = (e?: Event) => {
    e?.preventDefault();
    setFormError('');
    setStatusMsg('');
    const k = kind();
    const ind = scripts().find((s) => s.id === indicatorId());
    const result = buildAlertFromDraft({
      name: name(),
      symbol: symbol(),
      kind: k,
      chartSymbol: store.symbol || 'BTCUSDT',
      interval: store.interval,
      bindInterval: bindInterval(),
      price: price(),
      pct: pct(),
      pctDirection: pctDirection(),
      drawingId: drawingId(),
      drawingPrices: selectedDrawingPrices(),
      tolerance: tolerance(),
      indicatorId: indicatorId(),
      indicatorName: ind?.name || '',
      plotKey: plotKey(),
      op: op(),
      threshold: threshold(),
      pineSource: pineSource(),
      pineTitle: pineTitle(),
      protocolId: protocolId(),
      minAbsPct: minAbsPct(),
      direction: direction(),
      webhookUrl: webhookUrl(),
      l2WebhookUrl: l2WebhookUrl(),
      notifyBrowser: notifyBrowser(),
      cooldownSec: cooldownSec(),
    });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    createAlert(result.input);
    refresh();
    setName('');
    if (isPriceKind(k)) setPrice('');
    setStatusMsg('Alert created.');
    announce('Alert created');
  };

  const onToggle = (a: Alert) => {
    updateAlert(a.id, { enabled: !a.enabled });
    refresh();
  };

  const onToggleNotify = (a: Alert) => {
    updateAlert(a.id, { notifyBrowser: a.notifyBrowser === false });
    refresh();
  };

  const onDelete = (id: string, label: string) => {
    if (!confirm(`Delete alert “${label}”?`)) return;
    deleteAlert(id);
    refresh();
    setStatusMsg('Alert deleted.');
    announce('Alert deleted');
  };

  const runWebhookTest = async (which: 'webhook' | 'l2') => {
    const url = (which === 'l2' ? l2WebhookUrl() : webhookUrl()).trim();
    if (!url) {
      setFormError(`Set a${which === 'l2' ? 'n L2' : ''} webhook URL to test.`);
      return;
    }
    setFormError('');
    setTestingWebhook(which);
    setStatusMsg(which === 'l2' ? 'Testing L2 webhook…' : 'Testing webhook…');
    try {
      const payload =
        which === 'l2'
          ? buildL2WebhookPayload(
              {
                id: 'test',
                name: 'AXIS L2 webhook test',
                symbol: (symbol().trim() || store.symbol || 'TEST').toUpperCase(),
                kind: kind(),
                params: {},
                enabled: true,
                createdAt: Date.now(),
              },
              lastClose() ?? 0,
              Date.now(),
            )
          : undefined;
      const res = await testWebhook(url, payload ? { payload } : undefined);
      if (res.ok) setStatusMsg(`${which === 'l2' ? 'L2 webhook' : 'Webhook'} OK${res.status != null ? ` (${res.status})` : ''}.`);
      else setStatusMsg(`${which === 'l2' ? 'L2 webhook' : 'Webhook'} failed: ${res.error || 'unknown'}`);
    } finally {
      setTestingWebhook(null);
    }
  };

  const onRequestNotif = async () => {
    const perm = await requestNotificationPermission();
    setNotifPerm(perm);
    if (perm === 'granted') {
      setNotifyBrowser(true);
      setStatusMsg('Notifications allowed.');
    } else if (perm === 'denied') setStatusMsg('Notifications blocked by browser.');
    else if (perm === 'unsupported') setStatusMsg('Notifications not supported.');
    else setStatusMsg(`Notification permission: ${perm}`);
  };

  return (
    <Show when={isPanelOpen('alerts') || store.alertsPanel.open}>
      <FloatableShell id="alerts" testId="axis-alerts">
        <div class="axis-alerts flex-1 overflow-y-auto min-h-0 text-[12px] flex flex-col gap-2">
          <div class="axis-alerts-toolbar flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="sc-btn sc-btn-ghost text-[0.85em]"
              title="Request browser notification permission"
              data-testid="axis-alerts-notif"
              onClick={() => void onRequestNotif()}
            >
              <Icons.alerts size={12} />
              Notifications
              <span class="text-text-faint font-mono text-[0.9em] ml-0.5">({notifPerm()})</span>
            </button>
            <Show when={statusMsg()}>
              <span
                class="axis-alerts-status text-text-dim text-[0.85em] flex-1 min-w-0 truncate"
                role="status"
                aria-live="polite"
              >
                {statusMsg()}
              </span>
            </Show>
          </div>

          <section class="axis-alerts-form" aria-label="Create alert">
            <div class="text-[0.78em] uppercase tracking-wider text-text-faint font-semibold mb-1 px-0.5">
              New alert
            </div>
            <form
              class="flex flex-col gap-1.5 bg-bg-elev border border-border-soft p-2 rounded-md"
              onSubmit={onCreate}
            >
              <Field label="Name">
                <input
                  class="sc-input w-full"
                  type="text"
                  placeholder="Optional label"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  data-testid="axis-alerts-name"
                />
              </Field>

              <div class="grid grid-cols-2 gap-1.5">
                <Show when={!isOnchainKind(kind())}>
                  <Field label="Symbol">
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
                  </Field>
                </Show>
                <Field label="Kind" class={isOnchainKind(kind()) ? 'col-span-2' : ''}>
                  <select
                    class="sc-input w-full"
                    value={kind()}
                    onChange={(e) => onKindChange(e.currentTarget.value as AlertKind)}
                    data-testid="axis-alerts-kind"
                  >
                    <For each={[...ALERT_KIND_GROUPS]}>
                      {(g) => (
                        <optgroup label={g.label}>
                          <For each={[...g.kinds]}>
                            {(k) => <option value={k}>{formatAlertKind(k)}</option>}
                          </For>
                        </optgroup>
                      )}
                    </For>
                  </select>
                </Field>
              </div>

              <Show when={isPriceKind(kind())}>
                <div class="flex items-end gap-1.5">
                  <Field label="Price" class="flex-1">
                    <input
                      class="sc-input w-full font-mono"
                      type="number"
                      step="any"
                      min="0"
                      placeholder="Threshold"
                      value={price()}
                      onInput={(e) => setPrice(e.currentTarget.value)}
                      data-testid="axis-alerts-price"
                    />
                  </Field>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost text-[0.8em] mb-px"
                    title="Fill with last close"
                    data-testid="axis-alerts-use-last"
                    onClick={onUseLast}
                  >
                    Last
                  </button>
                </div>
              </Show>

              <Show when={isPctKind(kind())}>
                <div class="grid grid-cols-2 gap-1.5">
                  <Field label="% move">
                    <input
                      class="sc-input w-full font-mono"
                      type="number"
                      step="any"
                      min="0"
                      placeholder="e.g. 2"
                      value={pct()}
                      onInput={(e) => setPct(e.currentTarget.value)}
                      data-testid="axis-alerts-pct"
                    />
                  </Field>
                  <Field label="Direction">
                    <select
                      class="sc-input w-full"
                      value={pctDirection()}
                      onChange={(e) =>
                        setPctDirection(e.currentTarget.value as OnchainAlertDirection)
                      }
                      data-testid="axis-alerts-pct-dir"
                    >
                      <option value="both">both</option>
                      <option value="up">up</option>
                      <option value="down">down</option>
                    </select>
                  </Field>
                </div>
              </Show>

              <Show when={isDrawingKind(kind())}>
                <Show
                  when={chartDrawings().length > 0}
                  fallback={
                    <div class="text-text-faint italic text-[0.85em] px-0.5">
                      No priced drawings on {store.symbol || 'this symbol'}. Place a
                      horizontal line (or fib / trend) first.
                    </div>
                  }
                >
                  <Field label="Drawing">
                    <select
                      class="sc-input w-full"
                      value={drawingId()}
                      onChange={(e) => setDrawingId(e.currentTarget.value)}
                      data-testid="axis-alerts-drawing"
                    >
                      <option value="">Select drawing…</option>
                      <For each={chartDrawings()}>
                        {(d) => (
                          <option value={d.id}>{drawingAlertLabel(d)}</option>
                        )}
                      </For>
                    </select>
                  </Field>
                </Show>
                <Show when={!chartDrawings().length}>
                  <Field label="Price">
                    <input
                      class="sc-input w-full font-mono"
                      type="number"
                      step="any"
                      min="0"
                      placeholder="Level"
                      value={price()}
                      onInput={(e) => setPrice(e.currentTarget.value)}
                      data-testid="axis-alerts-price"
                    />
                  </Field>
                </Show>
                <Field label="Tolerance">
                  <input
                    class="sc-input w-full font-mono"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0 (exact)"
                    value={tolerance()}
                    onInput={(e) => setTolerance(e.currentTarget.value)}
                    data-testid="axis-alerts-tolerance"
                  />
                </Field>
              </Show>

              <Show when={isPineAlertKind(kind())}>
                <div class="text-text-faint text-[0.8em] px-0.5">
                  Fires on Pine <span class="font-mono">alert()</span> and{' '}
                  <span class="font-mono">alertcondition()</span> from a strategy or
                  indicator run (last bar only).
                </div>
                <Field label="Script">
                  <select
                    class="sc-input w-full"
                    value={indicatorId()}
                    onChange={(e) => onIndicatorChange(e.currentTarget.value)}
                    data-testid="axis-alerts-pine-script"
                  >
                    <option value="">Any script</option>
                    <For each={scripts()}>
                      {(s) => <option value={s.id}>{s.name || s.id}</option>}
                    </For>
                  </select>
                </Field>
                <Field label="Source">
                  <select
                    class="sc-input w-full font-mono"
                    value={pineSource()}
                    onChange={(e) => {
                      setPineSource(
                        e.currentTarget.value as 'any' | 'alert' | 'alertcondition',
                      );
                      setPineTitle('');
                    }}
                    data-testid="axis-alerts-pine-source"
                  >
                    <option value="any">alert() + alertcondition()</option>
                    <option value="alert">alert() only</option>
                    <option value="alertcondition">alertcondition() only</option>
                  </select>
                </Field>
                <Field label="Title (optional)">
                  <select
                    class="sc-input w-full"
                    value={pineTitle()}
                    onChange={(e) => setPineTitle(e.currentTarget.value)}
                    data-testid="axis-alerts-pine-title"
                  >
                    <option value="">Any title</option>
                    <For each={pineTitles()}>
                      {(t) => (
                        <option value={t.title}>
                          {t.title} ({t.source})
                        </option>
                      )}
                    </For>
                  </select>
                </Field>
              </Show>

              <Show when={isPlotConditionKind(kind())}>
                <Show
                  when={scripts().length > 0}
                  fallback={
                    <div class="text-text-faint italic text-[0.85em] px-0.5">
                      No indicators on the chart. Run a script, then alert on a plot.
                    </div>
                  }
                >
                  <Field label="Indicator">
                    <select
                      class="sc-input w-full"
                      value={indicatorId()}
                      onChange={(e) => onIndicatorChange(e.currentTarget.value)}
                      data-testid="axis-alerts-indicator"
                    >
                      <option value="">Select indicator…</option>
                      <For each={scripts()}>
                        {(s) => <option value={s.id}>{s.name || s.id}</option>}
                      </For>
                    </select>
                  </Field>
                  <Field label="Plot">
                    <select
                      class="sc-input w-full font-mono"
                      value={plotKey()}
                      onChange={(e) => setPlotKey(e.currentTarget.value)}
                      data-testid="axis-alerts-plot"
                      disabled={!indicatorId()}
                    >
                      <option value="">Select plot…</option>
                      <For each={plotOptions()}>
                        {(p) => <option value={p.key}>{p.title}</option>}
                      </For>
                    </select>
                  </Field>
                  <div class="grid grid-cols-2 gap-1.5">
                    <Field label="Op">
                      <select
                        class="sc-input w-full font-mono"
                        value={op()}
                        onChange={(e) =>
                          setOp(e.currentTarget.value as (typeof PINE_COMPARE_OPS)[number])
                        }
                        data-testid="axis-alerts-op"
                      >
                        <For each={[...PINE_COMPARE_OPS]}>
                          {(o) => <option value={o}>{o}</option>}
                        </For>
                      </select>
                    </Field>
                    <div class="flex items-end gap-1.5">
                      <Field label="Threshold" class="flex-1">
                        <input
                          class="sc-input w-full font-mono"
                          type="number"
                          step="any"
                          placeholder="Value"
                          value={threshold()}
                          onInput={(e) => setThreshold(e.currentTarget.value)}
                          data-testid="axis-alerts-threshold"
                        />
                      </Field>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost text-[0.8em] mb-px"
                        title="Fill with last plot sample"
                        data-testid="axis-alerts-use-plot"
                        disabled={lastPlotPreview() == null}
                        onClick={onUseLastPlot}
                      >
                        Last
                      </button>
                    </div>
                  </div>
                </Show>
              </Show>

              <Show when={isOnchainKind(kind())}>
                <Field label="Protocol id">
                  <input
                    class="sc-input w-full font-mono"
                    type="text"
                    placeholder="e.g. aave"
                    value={protocolId()}
                    onInput={(e) => setProtocolId(e.currentTarget.value)}
                    data-testid="axis-alerts-protocol"
                  />
                </Field>
                <div class="grid grid-cols-2 gap-1.5">
                  <Field label="Min |%|">
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
                  </Field>
                  <Field label="Direction">
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
                  </Field>
                </div>
              </Show>

              <div class="axis-alerts-delivery flex flex-col gap-1.5 pt-1 mt-0.5 border-t border-border-soft">
                <div class="text-[0.72em] uppercase tracking-wider text-text-faint font-semibold px-0.5">
                  Delivery
                </div>
                <label class="flex items-center gap-1.5 px-0.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={notifyBrowser()}
                    onChange={(e) => setNotifyBrowser(e.currentTarget.checked)}
                    data-testid="axis-alerts-notify"
                  />
                  <span>Browser notification</span>
                  <span class="text-text-faint font-mono text-[0.85em]">({notifPerm()})</span>
                </label>
                <label class="flex items-center gap-1.5 px-0.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={bindInterval()}
                    onChange={(e) => setBindInterval(e.currentTarget.checked)}
                    data-testid="axis-alerts-bind-interval"
                  />
                  <span>
                    This interval only
                    <span class="text-text-faint font-mono ml-1">{store.interval || ''}</span>
                  </span>
                </label>
                <Field label="Webhook URL">
                  <input
                    class="sc-input w-full font-mono text-[0.9em]"
                    type="url"
                    placeholder="https://… (optional)"
                    value={webhookUrl()}
                    onInput={(e) => setWebhookUrl(e.currentTarget.value)}
                    data-testid="axis-alerts-webhook"
                  />
                </Field>
                <Field label="L2 webhook">
                  <input
                    class="sc-input w-full font-mono text-[0.9em]"
                    type="url"
                    placeholder="https://… PYNE/HOOX L2 (optional)"
                    value={l2WebhookUrl()}
                    onInput={(e) => setL2WebhookUrl(e.currentTarget.value)}
                    data-testid="axis-alerts-l2"
                  />
                </Field>
              </div>

              <Field label="Cooldown (sec)">
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
              </Field>
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
                  disabled={testingWebhook() !== null || !webhookUrl().trim()}
                  title="POST a compact test payload"
                  data-testid="axis-alerts-test-webhook"
                  onClick={() => void runWebhookTest('webhook')}
                >
                  Test webhook
                </button>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost"
                  disabled={testingWebhook() !== null || !l2WebhookUrl().trim()}
                  title="POST an L2 test payload"
                  data-testid="axis-alerts-test-l2"
                  onClick={() => void runWebhookTest('l2')}
                >
                  Test L2
                </button>
              </div>
            </form>
          </section>

          <section class="axis-alerts-list flex-1 min-h-0 flex flex-col" aria-label="Alerts">
            <div class="flex items-center justify-between gap-2 px-0.5 mb-1">
              <div class="text-[0.78em] uppercase tracking-wider text-text-faint font-semibold">
                Alerts{' '}
                <span class="text-text-faint font-mono normal-case tracking-normal">
                  ({filtered().length}
                  {filter() !== 'all' ? ` / ${items().length}` : ''})
                </span>
              </div>
            </div>
            <div
              class="axis-alerts-filters flex flex-wrap gap-1 mb-1.5"
              role="tablist"
              aria-label="Filter alerts"
            >
              <For each={FILTERS}>
                {(f) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={filter() === f.id}
                    class={`axis-alerts-chip ${filter() === f.id ? 'is-active' : ''}`}
                    data-testid={`axis-alerts-filter-${f.id}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                  </button>
                )}
              </For>
            </div>
            <Show
              when={filtered().length > 0}
              fallback={
                <div class="axis-empty-state text-[12px] text-text-dim px-1 py-2">
                  {items().length === 0 ? 'No alerts' : 'No alerts in this filter.'}
                </div>
              }
            >
              <div class="flex flex-col gap-0.5">
                <For each={filtered()}>
                  {(a) => (
                    <div
                      class={`axis-alerts-row axis-list-row flex items-start gap-1.5 px-2 min-h-8 py-1 border-b ${
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
                        class={`w-5 h-5 mt-0.5 text-[0.75em] flex items-center justify-center border flex-shrink-0 rounded ${
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
                        <div class="flex items-center gap-1 min-w-0">
                          <span class="axis-alerts-kind-chip flex-shrink-0">
                            {formatAlertKind(a.kind)}
                          </span>
                          <div class="text-text truncate font-medium leading-tight">{a.name}</div>
                        </div>
                        <div class="text-[0.78em] text-text-faint font-mono truncate">
                          {a.symbol} · {formatAlertCondition(a)}
                          {a.interval ? ` · ${a.interval}` : ''}
                        </div>
                        <div class="text-[0.75em] text-text-faint mt-0.5 flex flex-wrap items-center gap-x-1.5">
                          <span>Last fired: {formatLastFired(a.lastFiredAt)}</span>
                          <Show when={a.notifyBrowser !== false}>
                            <span class="text-accent/80" title="Browser notification">
                              · notify
                            </span>
                          </Show>
                          <Show when={a.webhookUrl}>
                            <span class="text-accent/80" title={a.webhookUrl}>
                              · webhook
                            </span>
                          </Show>
                          <Show when={a.l2WebhookUrl}>
                            <span class="text-accent/80" title={a.l2WebhookUrl}>
                              · L2
                            </span>
                          </Show>
                        </div>
                      </div>
                      <div class="flex flex-col gap-0.5 flex-shrink-0">
                        <button
                          type="button"
                          class={`sc-btn sc-btn-ghost px-1 ${
                            a.notifyBrowser === false ? 'text-text-faint' : 'text-accent'
                          }`}
                          title={
                            a.notifyBrowser === false
                              ? 'Enable browser notification'
                              : 'Disable browser notification'
                          }
                          data-testid="axis-alerts-row-notify"
                          onClick={() => onToggleNotify(a)}
                        >
                          <Icons.alerts size={12} />
                        </button>
                        <button
                          type="button"
                          class="sc-btn sc-btn-ghost px-1 text-text-faint hover:text-red"
                          title="Delete alert"
                          data-testid="axis-alerts-delete"
                          onClick={() => onDelete(a.id, a.name)}
                        >
                          <Icons.x />
                        </button>
                      </div>
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
