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
 * Alerts panel — list / create / edit / toggle / delete local alerts.
 *
 * Kinds: price, % change, drawing touch, indicator plot, Pine alert()/alertcondition(), on-chain.
 * Delivery: browser Notification, generic webhook, L2 webhook.
 *
 * The composer is collapsed by default once alerts exist, so the list keeps
 * the panel’s vertical space. Rows expose quick actions (edit, duplicate,
 * test webhook, copy condition) behind a `···` menu.
 *
 * FloatableShell id `alerts`. Engine lives in `src/alerts` (no Solid).
 */

import {
  type Component,
  type JSX,
  For,
  Show,
  createEffect,
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
  formatLastFiredRelative,
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
import { alertRowTone } from '../alerts/row-tone';
import { Icons } from './icons';
import { FloatableShell } from './panels/FloatableShell';
import { announce } from './sr-announce';
import { copyToClipboard } from './clipboard';

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
    <div class={`ax-alerts-field ${props.class || ''}`}>
      <span class="ax-alerts-label">{props.label}</span>
      {props.children}
    </div>
  );
}

/** Dockable alerts list + create/edit form. */
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
  const [query, setQuery] = createSignal('');
  const [composerOpen, setComposerOpen] = createSignal(items().length === 0);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [deliveryOpen, setDeliveryOpen] = createSignal(false);
  const [bulkOpen, setBulkOpen] = createSignal(false);
  const [rowMenuId, setRowMenuId] = createSignal<string | null>(null);
  const [now, setNow] = createSignal(Date.now());
  let searchInput: HTMLInputElement | undefined;
  let composerRef: HTMLElement | undefined;

  onMount(() => {
    const unsub = subscribeAlerts(refresh);
    onCleanup(unsub);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    onCleanup(() => window.clearInterval(tick));

    // `/` focuses the alert search while the panel is mounted.
    const onSlash = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      searchInput?.focus();
    };
    window.addEventListener('keydown', onSlash);
    onCleanup(() => window.removeEventListener('keydown', onSlash));
  });

  // Keep the chip in sync when Settings → Notifications grants/denies permission.
  createEffect(() => {
    if (isPanelOpen('alerts') || store.alertsPanel.open) {
      setNotifPerm(notificationPermission());
    }
  });
  if (typeof document !== 'undefined') {
    const onVis = () => {
      if (document.visibilityState === 'visible') setNotifPerm(notificationPermission());
    };
    document.addEventListener('visibilitychange', onVis);
    onCleanup(() => document.removeEventListener('visibilitychange', onVis));
  }

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
    const q = query().trim().toLowerCase();
    return items().filter((a) => {
      if (f !== 'all' && alertKindGroup(a.kind) !== f) return false;
      if (!q) return true;
      return `${a.name} ${a.symbol} ${formatAlertKind(a.kind)} ${formatAlertCondition(a)}`
        .toLowerCase()
        .includes(q);
    });
  });

  const counts = createMemo(() => {
    const c = {
      all: items().length,
      price: 0,
      drawing: 0,
      indicator: 0,
      onchain: 0,
      fired: 0,
      off: 0,
    };
    for (const a of items()) {
      const group = alertKindGroup(a.kind);
      if (
        group === 'price' ||
        group === 'drawing' ||
        group === 'indicator' ||
        group === 'onchain'
      ) {
        c[group] += 1;
      }
      if (!a.enabled) c.off += 1;
      else if (alertRowTone(a, now()) === 'fired') c.fired += 1;
    }
    return c;
  });

  const editingAlert = createMemo(() => items().find((a) => a.id === editingId()) || null);

  const filterChips = createMemo(() => {
    const c = counts();
    return FILTERS.map((f) => ({ ...f, n: c[f.id] }));
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
    const keys = listPlotKeys(id, store.indicatorSeries, scripts().find((s) => s.id === id)?.plots);
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

  const resetDraft = () => {
    setEditingId(null);
    setName('');
    setSymbol(store.symbol || 'BTCUSDT');
    setKind('price_cross');
    setPrice('');
    setPct('');
    setPctDirection('both');
    setDrawingId('');
    setTolerance('');
    setIndicatorId('');
    setPlotKey('');
    setOp('>');
    setThreshold('');
    setPineSource('any');
    setPineTitle('');
    setProtocolId(store.onchain?.lastProtocolSlug || '');
    setMinAbsPct(String(DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT));
    setDirection('both');
    setCooldownSec('');
    setWebhookUrl('');
    setL2WebhookUrl('');
    setNotifyBrowser(true);
    setBindInterval(false);
    setDeliveryOpen(false);
    setFormError('');
  };

  const openComposer = (alert?: Alert) => {
    resetDraft();
    if (alert) {
      setEditingId(alert.id);
      setName(alert.name);
      setSymbol((alert.symbol || '').toUpperCase());
      setKind(alert.kind);
      const p = alert.params || {};
      if (isPriceKind(alert.kind)) {
        if (p.price != null) setPrice(String(p.price));
      } else if (isPctKind(alert.kind)) {
        if (p.pct != null) setPct(String(p.pct));
        if (p.direction === 'up' || p.direction === 'down') setPctDirection(p.direction);
      } else if (isDrawingKind(alert.kind)) {
        if (p.drawingId != null) setDrawingId(String(p.drawingId));
        if (p.price != null) setPrice(String(p.price));
        if (p.tolerance != null) setTolerance(String(p.tolerance));
      } else if (isPineAlertKind(alert.kind)) {
        if (p.indicatorId != null) setIndicatorId(String(p.indicatorId));
        if (p.source === 'alert' || p.source === 'alertcondition') setPineSource(p.source);
        if (p.title != null) setPineTitle(String(p.title));
      } else if (isPlotConditionKind(alert.kind)) {
        if (p.indicatorId != null) setIndicatorId(String(p.indicatorId));
        if (p.plotKey != null) setPlotKey(String(p.plotKey));
        if (typeof p.op === 'string') setOp(p.op as (typeof PINE_COMPARE_OPS)[number]);
        if (p.threshold != null) setThreshold(String(p.threshold));
      } else if (isOnchainKind(alert.kind)) {
        if (p.protocolId != null) setProtocolId(String(p.protocolId));
        if (p.minAbsPct != null) setMinAbsPct(String(p.minAbsPct));
        if (p.direction === 'up' || p.direction === 'down') setDirection(p.direction);
      }
      setBindInterval(Boolean(alert.interval));
      setWebhookUrl(alert.webhookUrl || '');
      setL2WebhookUrl(alert.l2WebhookUrl || '');
      setNotifyBrowser(alert.notifyBrowser !== false);
      setCooldownSec(alert.cooldownMs ? String(Math.round(alert.cooldownMs / 1000)) : '');
      if (alert.webhookUrl || alert.l2WebhookUrl || alert.cooldownMs) setDeliveryOpen(true);
    }
    setComposerOpen(true);
    queueMicrotask(() => composerRef?.scrollIntoView({ block: 'nearest' }));
  };

  const closeComposer = () => {
    setComposerOpen(false);
    resetDraft();
  };

  const onSubmit = (e?: Event) => {
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
    const editing = editingAlert();
    if (editing) {
      updateAlert(editing.id, {
        name: result.input.name,
        symbol: result.input.symbol,
        kind: result.input.kind,
        params: result.input.params,
        interval: result.input.interval,
        webhookUrl: result.input.webhookUrl,
        l2WebhookUrl: result.input.l2WebhookUrl,
        notifyBrowser: result.input.notifyBrowser,
        cooldownMs: result.input.cooldownMs,
        enabled: editing.enabled,
      });
      setStatusMsg('Alert updated.');
      announce('Alert updated');
    } else {
      createAlert(result.input);
      setStatusMsg('Alert created.');
      announce('Alert created');
    }
    refresh();
    closeComposer();
  };

  const onDuplicate = (a: Alert) => {
    openComposer(a);
    setEditingId(null);
    setName(`${a.name} copy`);
    setStatusMsg('Duplicated into the composer — adjust and create.');
  };

  const onCopyCondition = async (a: Alert) => {
    const text = `${a.symbol} · ${formatAlertCondition(a)}`;
    if (await copyToClipboard(text)) {
      setStatusMsg('Alert condition copied.');
      announce('Alert condition copied');
    }
    setRowMenuId(null);
  };

  const onTestRowWebhook = async (a: Alert) => {
    const url = (a.webhookUrl || '').trim();
    if (!url) return;
    setRowMenuId(null);
    setStatusMsg('Testing webhook…');
    const res = await testWebhook(url);
    setStatusMsg(
      res.ok
        ? `Webhook OK${res.status != null ? ` (${res.status})` : ''}.`
        : `Webhook failed: ${res.error || 'unknown'}`,
    );
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

  const setAllEnabled = (enabled: boolean) => {
    for (const a of items()) {
      if (a.enabled !== enabled) updateAlert(a.id, { enabled });
    }
    refresh();
    setStatusMsg(enabled ? 'All alerts enabled.' : 'All alerts disabled.');
    announce(enabled ? 'All alerts enabled' : 'All alerts disabled');
  };

  const deleteAll = () => {
    if (!items().length) return;
    if (!confirm(`Delete all ${items().length} alerts?`)) return;
    for (const a of [...items()]) deleteAlert(a.id);
    refresh();
    setStatusMsg('All alerts deleted.');
    announce('All alerts deleted');
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
      if (res.ok)
        setStatusMsg(
          `${which === 'l2' ? 'L2 webhook' : 'Webhook'} OK${res.status != null ? ` (${res.status})` : ''}.`,
        );
      else
        setStatusMsg(
          `${which === 'l2' ? 'L2 webhook' : 'Webhook'} failed: ${res.error || 'unknown'}`,
        );
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

  const resetFilters = () => {
    setQuery('');
    setFilter('all');
    searchInput?.focus();
  };

  return (
    <Show when={isPanelOpen('alerts') || store.alertsPanel.open}>
      <FloatableShell id="alerts" testId="axis-alerts">
        <div class="ax-alerts flex flex-col flex-1 min-h-0">
          {/* ── Header ─────────────────────────────────────────────── */}
          <div class="ax-alerts-head">
            <div class="ax-alerts-head-row">
              <div class="ax-alerts-search">
                <Icons.search size={12} />
                <input
                  ref={searchInput}
                  type="search"
                  class="ax-alerts-search-input"
                  placeholder="Find alerts…"
                  aria-label="Find alerts"
                  data-testid="axis-alerts-search"
                  value={query()}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && (query() || filter() !== 'all')) {
                      e.preventDefault();
                      resetFilters();
                    }
                  }}
                />
                <Show when={query()} fallback={<kbd class="ax-alerts-kbd">/</kbd>}>
                  <button
                    type="button"
                    class="ax-alerts-search-clear"
                    title="Clear search"
                    aria-label="Clear alert search"
                    onClick={resetFilters}
                  >
                    <Icons.x size={10} />
                  </button>
                </Show>
              </div>
              <button
                type="button"
                class="ax-alerts-bell"
                classList={{
                  'is-granted': notifPerm() === 'granted',
                  'is-denied': notifPerm() === 'denied',
                }}
                title={`Browser notifications: ${notifPerm()} — click to request permission`}
                aria-label={`Browser notifications: ${notifPerm()}`}
                data-testid="axis-alerts-notif"
                onClick={() => void onRequestNotif()}
              >
                <Icons.alerts size={12} />
              </button>
              <button
                type="button"
                class="ax-alerts-new"
                classList={{ 'is-on': composerOpen() && !editingId() }}
                title="Create an alert"
                data-testid="axis-alerts-new"
                onClick={() => (composerOpen() && !editingId() ? closeComposer() : openComposer())}
              >
                <Icons.plus size={11} /> New
              </button>
            </div>

            <div class="ax-alerts-summary" data-testid="axis-alerts-summary">
              <span>{counts().all} alerts</span>
              <span class="is-armed">{counts().all - counts().off} armed</span>
              <Show when={counts().fired > 0}>
                <span class="is-fired">{counts().fired} fired</span>
              </Show>
              <Show when={counts().off > 0}>
                <span>{counts().off} off</span>
              </Show>
            </div>

            <Show when={statusMsg()}>
              <div
                class="ax-alerts-status"
                role="status"
                aria-live="polite"
                data-testid="axis-alerts-status"
              >
                {statusMsg()}
              </div>
            </Show>
          </div>

          {/* ── Composer ───────────────────────────────────────────── */}
          <Show when={composerOpen()}>
            <section
              ref={composerRef}
              class="ax-alerts-composer"
              aria-label={editingId() ? 'Edit alert' : 'Create alert'}
              data-testid="axis-alerts-composer"
            >
              <div class="ax-alerts-composer-head">
                <span class="ax-alerts-composer-title">
                  {editingId() ? 'Edit alert' : 'New alert'}
                </span>
                <Show when={editingAlert()}>
                  {(a) => <span class="ax-alerts-composer-sub">{a().name}</span>}
                </Show>
                <span class="ax-alerts-spacer" />
                <button
                  type="button"
                  class="ax-alerts-icon"
                  title="Close composer"
                  aria-label="Close alert composer"
                  data-testid="axis-alerts-composer-close"
                  onClick={closeComposer}
                >
                  <Icons.x size={11} />
                </button>
              </div>
              <form class="ax-alerts-form" onSubmit={onSubmit}>
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

                <div class="ax-alerts-grid-2">
                  <Show when={!isOnchainKind(kind())}>
                    <Field label="Symbol">
                      <input
                        class="sc-input w-full font-mono"
                        type="text"
                        value={symbol()}
                        onInput={(e) => setSymbol(e.currentTarget.value.toUpperCase())}
                        onFocus={() => {
                          if (!symbol().trim())
                            setSymbol((store.symbol || 'BTCUSDT').toUpperCase());
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
                  <div class="ax-alerts-with-action">
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
                      class="ax-alerts-mini"
                      title="Fill with last close"
                      data-testid="axis-alerts-use-last"
                      onClick={onUseLast}
                    >
                      Last
                    </button>
                  </div>
                </Show>

                <Show when={isPctKind(kind())}>
                  <div class="ax-alerts-grid-2">
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
                      <div class="ax-alerts-hint">
                        No priced drawings on {store.symbol || 'this symbol'}. Place a horizontal
                        line (or fib / trend) first, or enter a level below.
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
                          {(d) => <option value={d.id}>{drawingAlertLabel(d)}</option>}
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
                  <div class="ax-alerts-hint">
                    Fires on Pine <span class="font-mono">alert()</span> and{' '}
                    <span class="font-mono">alertcondition()</span> from a strategy or indicator run
                    (last bar only).
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
                        setPineSource(e.currentTarget.value as 'any' | 'alert' | 'alertcondition');
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
                      <div class="ax-alerts-hint">
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
                    <div class="ax-alerts-grid-2">
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
                      <div class="ax-alerts-with-action">
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
                          class="ax-alerts-mini"
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
                  <div class="ax-alerts-grid-2">
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

                {/* Delivery + cooldown stay folded unless the alert uses them. */}
                <button
                  type="button"
                  class="ax-alerts-disclosure"
                  aria-expanded={deliveryOpen()}
                  data-testid="axis-alerts-delivery-toggle"
                  onClick={() => setDeliveryOpen((v) => !v)}
                >
                  <Icons.chevronDown
                    size={10}
                    class={`ax-alerts-chevron${deliveryOpen() ? ' is-open' : ''}`}
                  />
                  <span>Delivery &amp; cooldown</span>
                  <span class="ax-alerts-disclosure-summary">
                    {notifyBrowser() ? 'browser' : 'silent'}
                    {webhookUrl() ? ' · webhook' : ''}
                    {l2WebhookUrl() ? ' · L2' : ''}
                    {cooldownSec() ? ` · ${cooldownSec()}s` : ''}
                  </span>
                </button>

                <Show when={deliveryOpen()}>
                  <div class="ax-alerts-delivery">
                    <label class="ax-alerts-check">
                      <input
                        type="checkbox"
                        checked={notifyBrowser()}
                        onChange={(e) => setNotifyBrowser(e.currentTarget.checked)}
                        data-testid="axis-alerts-notify"
                      />
                      <span>Browser notification</span>
                      <span class="ax-alerts-check-meta">({notifPerm()})</span>
                    </label>
                    <label class="ax-alerts-check">
                      <input
                        type="checkbox"
                        checked={bindInterval()}
                        onChange={(e) => setBindInterval(e.currentTarget.checked)}
                        data-testid="axis-alerts-bind-interval"
                      />
                      <span>This interval only</span>
                      <span class="ax-alerts-check-meta">{store.interval || ''}</span>
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
                    <div class="ax-alerts-test-row">
                      <button
                        type="button"
                        class="ax-alerts-mini"
                        disabled={testingWebhook() !== null || !webhookUrl().trim()}
                        title="POST a compact test payload"
                        data-testid="axis-alerts-test-webhook"
                        onClick={() => void runWebhookTest('webhook')}
                      >
                        Test webhook
                      </button>
                      <button
                        type="button"
                        class="ax-alerts-mini"
                        disabled={testingWebhook() !== null || !l2WebhookUrl().trim()}
                        title="POST an L2 test payload"
                        data-testid="axis-alerts-test-l2"
                        onClick={() => void runWebhookTest('l2')}
                      >
                        Test L2
                      </button>
                    </div>
                  </div>
                </Show>

                <Show when={formError()}>
                  <div class="ax-alerts-error" data-testid="axis-alerts-form-error">
                    {formError()}
                  </div>
                </Show>

                <div class="ax-alerts-composer-actions">
                  <button
                    type="submit"
                    class="sc-btn sc-btn-primary flex-1"
                    data-testid="axis-alerts-create"
                  >
                    {editingId() ? 'Save alert' : 'Create alert'}
                  </button>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost"
                    data-testid="axis-alerts-cancel"
                    onClick={closeComposer}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          </Show>

          {/* ── List ───────────────────────────────────────────────── */}
          <div class="ax-alerts-scroll">
            <div class="ax-alerts-list-head">
              <span class="ax-alerts-list-title">Alerts</span>
              <span class="ax-alerts-count" data-testid="axis-alerts-count">
                {filtered().length}
                {filter() !== 'all' || query() ? ` / ${items().length}` : ''}
              </span>
              <span class="ax-alerts-spacer" />
              <button
                type="button"
                class="ax-alerts-icon"
                classList={{ 'is-on': bulkOpen() }}
                title="Bulk alert actions"
                aria-label="Bulk alert actions"
                aria-expanded={bulkOpen()}
                data-testid="axis-alerts-bulk-toggle"
                onClick={() => setBulkOpen((v) => !v)}
              >
                <Icons.menu size={11} />
              </button>
            </div>

            <Show when={bulkOpen()}>
              <div class="ax-alerts-bulk" data-testid="axis-alerts-bulk">
                <button type="button" onClick={() => setAllEnabled(true)}>
                  <Icons.eye size={10} /> Enable all
                </button>
                <button type="button" onClick={() => setAllEnabled(false)}>
                  <Icons.eyeOff size={10} /> Disable all
                </button>
                <button type="button" class="is-danger" onClick={deleteAll}>
                  <Icons.trash size={10} /> Delete all
                </button>
              </div>
            </Show>

            <div class="ax-alerts-filters" role="tablist" aria-label="Filter alerts">
              <For each={filterChips()}>
                {(f) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={filter() === f.id}
                    class="ax-alerts-chip"
                    classList={{ 'is-active': filter() === f.id }}
                    data-testid={`axis-alerts-filter-${f.id}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span class="ax-alerts-chip-count">{f.n}</span>
                  </button>
                )}
              </For>
            </div>

            <Show
              when={filtered().length > 0}
              fallback={
                <div class="ax-alerts-empty" data-testid="axis-alerts-empty">
                  <span class="ax-alerts-empty-icon">
                    <Icons.alerts size={18} />
                  </span>
                  <p class="ax-alerts-empty-title">
                    {items().length === 0 ? 'No alerts yet' : 'No alerts match'}
                  </p>
                  <p class="ax-alerts-empty-sub">
                    {items().length === 0
                      ? 'Create a price, drawing, indicator, or on-chain alert.'
                      : 'Clear the search or pick another filter.'}
                  </p>
                  <Show
                    when={items().length === 0}
                    fallback={
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost ax-alerts-empty-btn"
                        onClick={resetFilters}
                      >
                        Reset filters
                      </button>
                    }
                  >
                    <button
                      type="button"
                      class="sc-btn sc-btn-primary ax-alerts-empty-btn"
                      onClick={() => openComposer()}
                    >
                      <Icons.plus size={11} /> New alert
                    </button>
                  </Show>
                </div>
              }
            >
              <ul class="ax-alerts-list" aria-label="Alerts">
                <For each={filtered()}>
                  {(a) => {
                    const tone = () => alertRowTone(a, now());
                    const menuOpen = () => rowMenuId() === a.id;
                    return (
                      <li
                        class="ax-alerts-row"
                        classList={{
                          'is-fired': tone() === 'fired',
                          'is-armed': tone() === 'armed',
                          'is-off': tone() === 'disabled',
                          'is-menu-open': menuOpen(),
                        }}
                        data-testid="axis-alerts-row"
                        data-alert-id={a.id}
                        data-enabled={a.enabled ? '1' : '0'}
                        data-tone={tone()}
                      >
                        <div class="ax-alerts-row-inner">
                          <button
                            type="button"
                            class="ax-alerts-toggle"
                            aria-pressed={a.enabled}
                            title={a.enabled ? 'Disable alert' : 'Enable alert'}
                            aria-label={a.enabled ? `Disable ${a.name}` : `Enable ${a.name}`}
                            data-testid="axis-alerts-toggle"
                            onClick={() => onToggle(a)}
                          >
                            <span class="ax-alerts-toggle-dot" />
                          </button>
                          <div class="ax-alerts-row-main">
                            <div class="ax-alerts-row-top">
                              <span
                                class="ax-alerts-kind"
                                data-group={alertKindGroup(a.kind)}
                                title={formatAlertKind(a.kind)}
                              >
                                {formatAlertKind(a.kind)}
                              </span>
                              <span class="ax-alerts-name" title={a.name}>
                                {a.name}
                              </span>
                            </div>
                            <div class="ax-alerts-cond" title={formatAlertCondition(a)}>
                              <span class="ax-alerts-symbol">{a.symbol}</span>
                              <span class="ax-alerts-dot-sep">·</span>
                              <span>{formatAlertCondition(a)}</span>
                              <Show when={a.interval}>
                                <span class="ax-alerts-interval">{a.interval}</span>
                              </Show>
                            </div>
                            <div class="ax-alerts-meta">
                              <span
                                class="ax-alerts-fired"
                                classList={{ 'is-recent': tone() === 'fired' }}
                                title={`Last fired: ${formatLastFired(a.lastFiredAt)}`}
                              >
                                {formatLastFiredRelative(a.lastFiredAt, now())}
                              </span>
                              <Show when={a.notifyBrowser !== false}>
                                <span class="ax-alerts-delivery-chip" title="Browser notification">
                                  <Icons.alerts size={9} />
                                </span>
                              </Show>
                              <Show when={a.webhookUrl}>
                                <span class="ax-alerts-delivery-chip" title={a.webhookUrl}>
                                  <Icons.cable size={9} />
                                </span>
                              </Show>
                              <Show when={a.l2WebhookUrl}>
                                <span class="ax-alerts-delivery-chip" title={a.l2WebhookUrl}>
                                  L2
                                </span>
                              </Show>
                              <Show when={a.cooldownMs}>
                                <span
                                  class="ax-alerts-delivery-chip"
                                  title={`Cooldown ${Math.round((a.cooldownMs || 0) / 1000)}s`}
                                >
                                  <Icons.clock size={9} />
                                </span>
                              </Show>
                            </div>
                          </div>
                          <div class="ax-alerts-row-actions">
                            <button
                              type="button"
                              class="ax-alerts-icon"
                              classList={{ 'is-on': a.notifyBrowser !== false }}
                              title={
                                a.notifyBrowser === false
                                  ? 'Enable browser notification'
                                  : 'Disable browser notification'
                              }
                              aria-label={
                                a.notifyBrowser === false
                                  ? `Enable notifications for ${a.name}`
                                  : `Disable notifications for ${a.name}`
                              }
                              data-testid="axis-alerts-row-notify"
                              onClick={() => onToggleNotify(a)}
                            >
                              <Icons.alerts size={11} />
                            </button>
                            <button
                              type="button"
                              class="ax-alerts-icon"
                              classList={{ 'is-on': menuOpen() }}
                              title="Alert actions"
                              aria-label={`Actions for ${a.name}`}
                              aria-expanded={menuOpen()}
                              data-testid="axis-alerts-row-menu"
                              onClick={() => setRowMenuId(menuOpen() ? null : a.id)}
                            >
                              <Icons.menu size={11} />
                            </button>
                          </div>
                        </div>

                        <Show when={menuOpen()}>
                          <div class="ax-alerts-row-menu" data-testid="axis-alerts-row-menu-row">
                            <button
                              type="button"
                              onClick={() => {
                                setRowMenuId(null);
                                openComposer(a);
                              }}
                            >
                              <Icons.pencil size={10} /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRowMenuId(null);
                                onDuplicate(a);
                              }}
                            >
                              <Icons.copy size={10} /> Duplicate
                            </button>
                            <button type="button" onClick={() => void onCopyCondition(a)}>
                              <Icons.copy size={10} /> Copy condition
                            </button>
                            <Show when={a.webhookUrl}>
                              <button type="button" onClick={() => void onTestRowWebhook(a)}>
                                <Icons.cable size={10} /> Test webhook
                              </button>
                            </Show>
                            <button
                              type="button"
                              class="is-danger"
                              onClick={() => {
                                setRowMenuId(null);
                                onDelete(a.id, a.name);
                              }}
                            >
                              <Icons.trash size={10} /> Delete
                            </button>
                          </div>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
