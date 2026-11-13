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
 * Alert composer — the create/edit form.
 *
 * Owns the whole draft: one signal per field, the kind-dependent pickers
 * (drawing, indicator plot, Pine title, on-chain protocol), the delivery
 * section, and the webhook test. The panel hands it a {@link ComposerRequest}
 * and gets `onSaved` back.
 *
 * Extracted from `AlertsPanel.tsx`, which had ~20 draft signals interleaved
 * with the list, filters and bulk actions.
 *
 * @module ui/alerts/Composer
 */

import { type Component, type JSX, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { store } from '../../store';
import { drawingsForSymbol } from '../../chart/drawings/sync';
import {
  ALERT_KIND_GROUPS,
  DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT,
  PINE_COMPARE_OPS,
  buildAlertFromDraft,
  buildL2WebhookPayload,
  collectPineAlertEvents,
  createAlert,
  drawingAlertLabel,
  formatAlertKind,
  isDrawingKind,
  isIndicatorKind,
  isOnchainKind,
  isPctKind,
  isPineAlertKind,
  isPlotConditionKind,
  isPriceKind,
  lastNumericSample,
  listPineAlertTitles,
  listPlotKeys,
  pricesFromDrawing,
  testWebhook,
  updateAlert,
  type Alert,
  type AlertKind,
  type OnchainAlertDirection,
} from '../../alerts';
import { Icons } from '../icons';
import { StudioInput } from '../studio';

/**
 * What the composer should open with.
 *
 * A fresh object per open is what re-seeds the draft, so the parent must not
 * mutate a live request.
 */
export interface ComposerRequest {
  /** Alert to edit, or the alert a duplicate starts from. */
  alert: Alert | null;
  /** Seed a **new** alert from `alert` instead of editing it. */
  duplicate?: boolean;
  /** Override the name (duplicate appends "copy"). */
  name?: string;
}

/** Props for {@link AlertComposer}. */
export interface ComposerProps {
  /** The request being edited. Never null — the panel gates rendering. */
  request: () => ComposerRequest;
  /** Live alert list, used for the "editing <name>" subtitle. */
  items: () => Alert[];
  /** Browser notification permission, shown next to the checkbox. */
  notifPerm: string;
  /** Bumped by the panel when permission is granted; enables the checkbox. */
  notifyGranted: number;
  /** Close and discard the draft. */
  onClose: () => void;
  /** A save succeeded; the panel refreshes, announces, and closes. */
  onSaved: (message: string) => void;
  /** Progress / webhook-test feedback for the panel's status line. */
  onStatus: (message: string) => void;
}

/** The latest chart close, or `null` when no bars are loaded. */
function lastClose(): number | null {
  const bars = store.bars;
  if (!Array.isArray(bars) || !bars.length) return null;
  const c = Number(bars[bars.length - 1]?.close);
  return Number.isFinite(c) ? c : null;
}

/** A labelled row inside the composer form. */
function Field(props: { label: string; class?: string; children: JSX.Element }) {
  return (
    <div class={`ax-alerts-field ${props.class || ''}`}>
      <span class="ax-alerts-label">{props.label}</span>
      {props.children}
    </div>
  );
}

/** Create/edit alert form. */
export const AlertComposer: Component<ComposerProps> = (props): JSX.Element => {
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
  const [testingWebhook, setTestingWebhook] = createSignal<'webhook' | 'l2' | null>(null);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [deliveryOpen, setDeliveryOpen] = createSignal(false);
  let composerRef: HTMLElement | undefined;

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

  const editingAlert = createMemo(() => {
    const id = editingId();
    if (!id) return null;
    return props.items().find((a) => a.id === id) || null;
  });

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

  /** Copy an existing alert's fields into the draft. */
  const loadFrom = (alert: Alert) => {
    setEditingId(alert.id);
    setName(alert.name);
    setSymbol((alert.symbol || '').toUpperCase());
    setKind(alert.kind);
    const p = alert.params || {};
    if (isPriceKind(alert.kind)) {
      if (p['price'] != null) setPrice(String(p['price']));
    } else if (isPctKind(alert.kind)) {
      if (p['pct'] != null) setPct(String(p['pct']));
      if (p['direction'] === 'up' || p['direction'] === 'down') setPctDirection(p['direction']);
    } else if (isDrawingKind(alert.kind)) {
      if (p['drawingId'] != null) setDrawingId(String(p['drawingId']));
      if (p['price'] != null) setPrice(String(p['price']));
      if (p['tolerance'] != null) setTolerance(String(p['tolerance']));
    } else if (isPineAlertKind(alert.kind)) {
      if (p['indicatorId'] != null) setIndicatorId(String(p['indicatorId']));
      if (p['source'] === 'alert' || p['source'] === 'alertcondition') setPineSource(p['source']);
      if (p['title'] != null) setPineTitle(String(p['title']));
    } else if (isPlotConditionKind(alert.kind)) {
      if (p['indicatorId'] != null) setIndicatorId(String(p['indicatorId']));
      if (p['plotKey'] != null) setPlotKey(String(p['plotKey']));
      if (typeof p['op'] === 'string') setOp(p['op'] as (typeof PINE_COMPARE_OPS)[number]);
      if (p['threshold'] != null) setThreshold(String(p['threshold']));
    } else if (isOnchainKind(alert.kind)) {
      if (p['protocolId'] != null) setProtocolId(String(p['protocolId']));
      if (p['minAbsPct'] != null) setMinAbsPct(String(p['minAbsPct']));
      if (p['direction'] === 'up' || p['direction'] === 'down') setDirection(p['direction']);
    }
    setBindInterval(Boolean(alert.interval));
    setWebhookUrl(alert.webhookUrl || '');
    setL2WebhookUrl(alert.l2WebhookUrl || '');
    setNotifyBrowser(alert.notifyBrowser !== false);
    setCooldownSec(alert.cooldownMs ? String(Math.round(alert.cooldownMs / 1000)) : '');
    if (alert.webhookUrl || alert.l2WebhookUrl || alert.cooldownMs) setDeliveryOpen(true);
  };

  // The panel's bell can grant permission while the composer is open.
  let lastGranted = 0;
  createEffect(() => {
    const n = props.notifyGranted;
    if (n > lastGranted) {
      lastGranted = n;
      setNotifyBrowser(true);
    }
  });

  // Seed the draft from the request. A fresh request object per open is what
  // re-runs this; the parent closes by dropping the request.
  createEffect(() => {
    const req = props.request();
    resetDraft();
    if (req.alert) loadFrom(req.alert);
    if (req.duplicate) setEditingId(null);
    if (req.name != null) setName(req.name);
    queueMicrotask(() => composerRef?.scrollIntoView({ block: 'nearest' }));
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

  const onSubmit = (e?: Event) => {
    e?.preventDefault();
    setFormError('');
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
      props.onSaved('Alert updated.');
    } else {
      createAlert(result.input);
      props.onSaved('Alert created.');
    }
  };

  const runWebhookTest = async (which: 'webhook' | 'l2') => {
    const url = (which === 'l2' ? l2WebhookUrl() : webhookUrl()).trim();
    if (!url) {
      setFormError(`Set a${which === 'l2' ? 'n L2' : ''} webhook URL to test.`);
      return;
    }
    setFormError('');
    setTestingWebhook(which);
    props.onStatus(which === 'l2' ? 'Testing L2 webhook…' : 'Testing webhook…');
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
        props.onStatus(
          `${which === 'l2' ? 'L2 webhook' : 'Webhook'} OK${res.status != null ? ` (${res.status})` : ''}.`,
        );
      else
        props.onStatus(
          `${which === 'l2' ? 'L2 webhook' : 'Webhook'} failed: ${res.error || 'unknown'}`,
        );
    } finally {
      setTestingWebhook(null);
    }
  };

  return (
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
          onClick={props.onClose}
        >
          <Icons.x size={11} />
        </button>
      </div>
      <form class="ax-alerts-form" onSubmit={onSubmit}>
        <Field label="Name">
          <StudioInput
            type="text"
            placeholder="Optional label"
            value={name()}
            onInput={setName}
            testId="axis-alerts-name"
          />
        </Field>

        <div class="ax-alerts-grid-2">
          <Show when={!isOnchainKind(kind())}>
            <Field label="Symbol">
              <StudioInput
                mono
                type="text"
                value={symbol()}
                onInput={(v) => setSymbol(v.toUpperCase())}
                onFocus={() => {
                  if (!symbol().trim())
                    setSymbol((store.symbol || 'BTCUSDT').toUpperCase());
                }}
                testId="axis-alerts-symbol"
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
              <StudioInput
                mono
                type="number"
                step="any"
                min={0}
                placeholder="Threshold"
                value={price()}
                onInput={setPrice}
                testId="axis-alerts-price"
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
              <StudioInput
                mono
                type="number"
                step="any"
                min={0}
                placeholder="e.g. 2"
                suffix="%"
                value={pct()}
                onInput={setPct}
                testId="axis-alerts-pct"
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
              <StudioInput
                mono
                type="number"
                step="any"
                min={0}
                placeholder="Level"
                value={price()}
                onInput={setPrice}
                testId="axis-alerts-price"
              />
            </Field>
          </Show>
          <Field label="Tolerance">
            <StudioInput
              mono
              type="number"
              step="any"
              min={0}
              placeholder="0 (exact)"
              value={tolerance()}
              onInput={setTolerance}
              testId="axis-alerts-tolerance"
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
                  <StudioInput
                    mono
                    type="number"
                    step="any"
                    placeholder="Value"
                    value={threshold()}
                    onInput={setThreshold}
                    testId="axis-alerts-threshold"
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
            <StudioInput
              mono
              type="text"
              placeholder="e.g. aave"
              value={protocolId()}
              onInput={setProtocolId}
              testId="axis-alerts-protocol"
            />
          </Field>
          <div class="ax-alerts-grid-2">
            <Field label="Min |%|">
              <StudioInput
                mono
                type="number"
                step="any"
                min={0}
                placeholder={String(DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT)}
                suffix="%"
                value={minAbsPct()}
                onInput={setMinAbsPct}
                testId="axis-alerts-min-abs-pct"
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
              <span class="ax-alerts-check-meta">({props.notifPerm})</span>
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
              <StudioInput
                mono
                type="url"
                placeholder="https://… (optional)"
                value={webhookUrl()}
                onInput={setWebhookUrl}
                copyable
                testId="axis-alerts-webhook"
              />
            </Field>
            <Field label="L2 webhook">
              <StudioInput
                mono
                type="url"
                placeholder="https://… PYNE/HOOX L2 (optional)"
                value={l2WebhookUrl()}
                onInput={setL2WebhookUrl}
                copyable
                testId="axis-alerts-l2"
              />
            </Field>
            <Field label="Cooldown (sec)">
              <StudioInput
                mono
                type="number"
                step={1}
                min={0}
                placeholder="optional"
                suffix="s"
                value={cooldownSec()}
                onInput={setCooldownSec}
                testId="axis-alerts-cooldown"
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
            onClick={props.onClose}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
};
