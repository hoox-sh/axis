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
import {
  listAlerts,
  deleteAlert,
  updateAlert,
  testWebhook,
  requestNotificationPermission,
  notificationPermission,
  formatAlertCondition,
  formatAlertKind,
  alertKindGroup,
  subscribeAlerts,
  type Alert,
} from '../alerts';
import { alertRowTone } from '../alerts/row-tone';
import { Icons } from './icons';
import { AlertRow } from './alerts/AlertRow';
import { AlertComposer, type ComposerRequest } from './alerts/Composer';
import { FloatableShell } from './panels/FloatableShell';
import { announce } from './sr-announce';
import { copyToClipboard } from './clipboard';
import { bindSlashToSearch } from './focus-search';

type FilterId = 'all' | 'price' | 'drawing' | 'indicator' | 'onchain';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'price', label: 'Price' },
  { id: 'drawing', label: 'Drawing' },
  { id: 'indicator', label: 'Indicator' },
  { id: 'onchain', label: 'On-chain' },
];

/** Dockable alerts list + create/edit form. */
export const AlertsPanel: Component = () : JSX.Element => {
  const [items, setItems] = createSignal<Alert[]>(listAlerts());
  const refresh = () => setItems(listAlerts());

  const [statusMsg, setStatusMsg] = createSignal('');
  const [notifPerm, setNotifPerm] = createSignal(notificationPermission());
  const [filter, setFilter] = createSignal<FilterId>('all');
  const [query, setQuery] = createSignal('');
  // `null` = composer closed. A fresh request object per open re-seeds the draft.
  const [composerRequest, setComposerRequest] = createSignal<ComposerRequest | null>(
    items().length === 0 ? { alert: null } : null,
  );
  /** Bumped when the browser grants notification permission mid-edit. */
  const [notifyGranted, setNotifyGranted] = createSignal(0);
  const [bulkOpen, setBulkOpen] = createSignal(false);
  const [rowMenuId, setRowMenuId] = createSignal<string | null>(null);
  const [now, setNow] = createSignal(Date.now());
  let searchInput: HTMLInputElement | undefined;

  onMount(() => {
    const unsub = subscribeAlerts(refresh);
    onCleanup(unsub);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    onCleanup(() => window.clearInterval(tick));

    // `/` focuses the alert search while the panel is mounted.
    onCleanup(bindSlashToSearch(() => searchInput));
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

  const filterChips = createMemo(() => {
    const c = counts();
    return FILTERS.map((f) => ({ ...f, n: c[f.id] }));
  });

  const composerOpen = () => composerRequest() !== null;
  /** The alert being edited (duplicate counts as a new alert). */
  const editingRequest = () => {
    const r = composerRequest();
    return r?.alert && !r.duplicate ? r.alert : null;
  };
  const openComposer = (alert?: Alert) => setComposerRequest({ alert: alert ?? null });
  const closeComposer = () => setComposerRequest(null);
  const onComposerSaved = (message: string) => {
    setStatusMsg(message);
    announce(message);
    refresh();
    closeComposer();
  };

  const onDuplicate = (a: Alert) => {
    setComposerRequest({ alert: a, duplicate: true, name: `${a.name} copy` });
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

  const onRequestNotif = async () => {
    const perm = await requestNotificationPermission();
    setNotifPerm(perm);
    if (perm === 'granted') {
      // The draft lives in the composer; nudge it to enable the checkbox.
      setNotifyGranted((n) => n + 1);
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
                classList={{ 'is-on': composerOpen() && !editingRequest() }}
                title="Create an alert"
                data-testid="axis-alerts-new"
                onClick={() => (composerOpen() && !editingRequest() ? closeComposer() : openComposer())}
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
          {/* ── Composer ───────────────────────────────────────────── */}
          <Show when={composerRequest()}>
            {(req) => (
              <AlertComposer
                request={req}
                items={items}
                notifPerm={notifPerm()}
                notifyGranted={notifyGranted()}
                onClose={closeComposer}
                onSaved={onComposerSaved}
                onStatus={setStatusMsg}
              />
            )}
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
                  {(a) => (
                    <AlertRow
                      alert={a}
                      now={now}
                      menuOpen={rowMenuId() === a.id}
                      onMenuOpenChange={(alert) =>
                        setRowMenuId(alert && rowMenuId() !== alert.id ? alert.id : null)
                      }
                      onToggle={onToggle}
                      onToggleNotify={onToggleNotify}
                      onEdit={openComposer}
                      onDuplicate={onDuplicate}
                      onCopyCondition={onCopyCondition}
                      onTestWebhook={onTestRowWebhook}
                      onDelete={onDelete}
                    />
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
