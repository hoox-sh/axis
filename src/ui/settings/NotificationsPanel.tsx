// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings → Notifications panel (shared by the modal dialog and the
 * studio Settings page). Toast preferences apply live and persist.
 *
 * Browser Notification permission for price/script alerts lives here too
 * (same grant path as Alerts panel → Notifications).
 *
 * Every toast is also written to System Logs; warn/error log entries raise
 * a toast automatically. Flood control: master switch, per-category
 * toggles, severity floor, dedupe window (repeats collapse to ×N), and a
 * cap on simultaneously visible toasts.
 *
 * @module ui/settings/NotificationsPanel
 */

import { For, Show, createSignal, onCleanup, type Component } from 'solid-js';
import { notificationPermission, requestNotificationPermission } from '../../alerts';
import {
  store,
  setStore,
  persist,
  clearToasts,
  DEFAULT_NOTIFICATIONS,
  setPanelOpen,
} from '../../store';
import type { LogLevel, NotificationCategory } from '../../store/types';
import { Icons } from '../icons';
import {
  AppButton,
  StudioField,
  StudioHint,
  StudioInput,
  StudioSection,
  StudioSelect,
  StudioStatus,
  StudioToggle,
  useMicrofeedback,
  type StudioHealth,
} from '../studio';

const CATEGORY_META: { id: NotificationCategory; label: string; hint: string }[] = [
  {
    id: 'run',
    label: 'Script runs',
    hint: 'Run finished / failed, replay, backtest progress.',
  },
  {
    id: 'data',
    label: 'Market data',
    hint: 'Symbol loads, DSM backfill / gap-fill, watchlist, on-chain feeds.',
  },
  {
    id: 'stream',
    label: 'Live stream',
    hint: 'Connect, disconnect, reconnecting, live errors.',
  },
  {
    id: 'engine',
    label: 'Engine',
    hint: 'Engine ready / probe failed / execution mode fallback.',
  },
  {
    id: 'scripts',
    label: 'Scripts & storage',
    hint: 'Library save / delete / import, storage switch, plugins, git.',
  },
  {
    id: 'workspace',
    label: 'Workspace',
    hint: 'Settings saved, snapshots, layouts, screenshots.',
  },
  {
    id: 'system',
    label: 'System',
    hint: 'Boot, telemetry, MCP bridge, anything uncategorized.',
  },
];

const LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: 'info', label: 'Everything (info and up)' },
  { value: 'ok', label: 'Success and up (ok, warn, error)' },
  { value: 'warn', label: 'Warnings and errors only' },
  { value: 'error', label: 'Errors only' },
];

type BrowserPerm = NotificationPermission | 'unsupported';

function permHealth(perm: BrowserPerm): StudioHealth {
  switch (perm) {
    case 'granted':
      return 'healthy';
    case 'denied':
      return 'down';
    case 'unsupported':
      return 'skipped';
    default:
      return 'idle';
  }
}

function permLabel(perm: BrowserPerm): string {
  switch (perm) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Blocked';
    case 'unsupported':
      return 'Unsupported';
    default:
      return 'Not asked';
  }
}

const touch = () => persist();

/**
 * Notification preferences: per-category toggles, browser permission state, and
 * a permission request action. Category writes persist immediately through
 * `touch()`; the permission badge re-reads on `visibilitychange` so returning
 * from browser settings shows the new state without a reload.
 *
 * @param props - Optional close handler forwarded to the panel chrome.
 * @returns The notifications settings form.
 */
export const NotificationsPanel: Component<{ onClose?: () => void }> = (props): JSX.Element => {
  const prefs = () => store.notifications || DEFAULT_NOTIFICATIONS;
  const [notifPerm, setNotifPerm] = createSignal<BrowserPerm>(notificationPermission());
  const [grantMsg, setGrantMsg] = createSignal('');
  const [grantTone, setGrantTone] = createSignal<'ok' | 'err' | 'info'>('info');
  const grantFb = useMicrofeedback({ successHoldMs: 800, errorHoldMs: 1200 });
  const resetFb = useMicrofeedback({ successHoldMs: 700 });

  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      setNotifPerm(notificationPermission());
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    onCleanup(() => document.removeEventListener('visibilitychange', onVisibility));
  }

  const setCat = (id: NotificationCategory, v: boolean) => {
    setStore('notifications', 'categories', id, v);
    touch();
  };

  const catsOn = () =>
    CATEGORY_META.reduce((n, c) => n + (prefs().categories?.[c.id] !== false ? 1 : 0), 0);

  const onRequestNotif = async () => {
    setGrantMsg('');
    const perm = await requestNotificationPermission();
    setNotifPerm(perm);
    if (perm === 'granted') {
      setGrantTone('ok');
      setGrantMsg('Browser notifications allowed · alert fires can use the OS banner.');
      return;
    }
    if (perm === 'denied') {
      setGrantTone('err');
      setGrantMsg('Blocked by the browser. Re-enable in site settings, then try again.');
      throw new Error('denied');
    }
    if (perm === 'unsupported') {
      setGrantTone('err');
      setGrantMsg('This browser does not support Notification.');
      throw new Error('unsupported');
    }
    setGrantTone('info');
    setGrantMsg(`Permission: ${perm}`);
  };

  return (
    <div class="ax-split" data-testid="axis-settings-notifications">
      <div class="ax-split-col">
        <StudioSection
          title="Browser alerts"
          lead="OS banners when a price / script alert fires. Same grant as Alerts → Notifications."
          testId="axis-settings-browser-alerts"
          headerEnd={
            <StudioStatus status={permHealth(notifPerm())} label={permLabel(notifPerm())} />
          }
        >
          <StudioHint>
            Toasts below are in-app only. Browser permission is required for the Alerts panel
            “Browser notification” delivery option.
          </StudioHint>
          <div class="ax-toolbar">
            <AppButton
              design="soft"
              tone={notifPerm() === 'granted' ? 'ghost' : 'primary'}
              size="sm"
              testId="axis-settings-notif-grant"
              feedback={grantFb.state()}
              icon={<Icons.alerts />}
              disabled={notifPerm() === 'unsupported' || notifPerm() === 'granted'}
              title={
                notifPerm() === 'granted'
                  ? 'Already granted'
                  : notifPerm() === 'denied'
                    ? 'Blocked — open site settings to reset, then Retry'
                    : 'Request browser notification permission'
              }
              onClick={() => void grantFb.run(onRequestNotif)}
            >
              {notifPerm() === 'denied' ? 'Retry permission' : 'Allow notifications'}
            </AppButton>
            <AppButton
              design="soft"
              tone="ghost"
              size="sm"
              testId="axis-settings-open-alerts"
              title="Open the Alerts panel"
              onClick={() => {
                setPanelOpen('alerts', true);
                props.onClose?.();
              }}
            >
              Open Alerts
            </AppButton>
          </div>
          <Show when={grantMsg()}>
            <p
              class={
                grantTone() === 'ok'
                  ? 'ax-hint ax-hint--accent'
                  : grantTone() === 'err'
                    ? 'ax-error'
                    : 'ax-hint'
              }
              role={grantTone() === 'err' ? 'alert' : 'status'}
              data-testid="axis-settings-notif-grant-msg"
            >
              {grantMsg()}
            </p>
          </Show>
          <Show when={notifPerm() === 'denied'}>
            <StudioHint>
              Chrome / Edge: lock icon in the address bar → Site settings → Notifications. Firefox:
              Permissions in the address-bar panel.
            </StudioHint>
          </Show>
        </StudioSection>

        <StudioSection
          title="Toasts"
          lead="In-app notices (bottom-right). Also written to System Logs."
          testId="axis-settings-toasts"
          headerEnd={
            <StudioStatus
              status={prefs().enabled !== false ? 'healthy' : 'idle'}
              label={prefs().enabled !== false ? 'Toasts on' : 'Toasts off'}
            />
          }
        >
          <StudioToggle
            id="axis-notify-enabled"
            testId="axis-notify-enabled"
            checked={prefs().enabled !== false}
            onChange={(v) => {
              setStore('notifications', 'enabled', v);
              if (!v) clearToasts();
              touch();
            }}
            label="Enable toast notifications"
            hint="Off hides all toasts. System Logs keep recording everything."
          />
          <StudioField
            label="Show toasts for"
            for="axis-notify-level"
            hint="Severity floor. Errors always reach System Logs regardless."
          >
            <StudioSelect
              id="axis-notify-level"
              testId="axis-notify-level"
              value={prefs().levelMin || 'ok'}
              onChange={(v) => {
                setStore('notifications', 'levelMin', v as LogLevel);
                touch();
              }}
            >
              <For each={LEVEL_OPTIONS}>{(o) => <option value={o.value}>{o.label}</option>}</For>
            </StudioSelect>
          </StudioField>
        </StudioSection>
      </div>

      <div class="ax-split-col">
        <StudioSection
          title="Activity categories"
          lead="Toast per activity. Off still logs to System Logs."
          testId="axis-settings-notify-categories"
          headerEnd={
            <span class="ax-chip ax-chip--tag" data-testid="axis-notify-cats-count">
              {catsOn()}/{CATEGORY_META.length}
            </span>
          }
        >
          <div class="ax-toggle-grid">
            <For each={CATEGORY_META}>
              {(c) => (
                <StudioToggle
                  id={`axis-notify-cat-${c.id}`}
                  testId={`axis-notify-cat-${c.id}`}
                  checked={prefs().categories?.[c.id] !== false}
                  onChange={(v) => setCat(c.id, v)}
                  label={c.label}
                  hint={c.hint}
                />
              )}
            </For>
          </div>
        </StudioSection>

        <StudioSection
          title="Flood control"
          lead="Repeats of the same message collapse into one toast with a ×N badge."
          testId="axis-settings-notify-flood"
        >
          <StudioField
            label="Auto-dismiss after"
            for="axis-notify-duration"
            hint="Errors stick about twice as long. 1.5–30s."
          >
            <StudioInput
              id="axis-notify-duration"
              type="number"
              mono
              selectOnFocus
              min={1.5}
              max={30}
              step={0.5}
              suffix="s"
              testId="axis-notify-duration"
              value={Math.round((prefs().durationMs || 4000) / 100) / 10}
              onChange={(v) => {
                const s = Math.min(30, Math.max(1.5, Number(v) || 4));
                setStore('notifications', 'durationMs', Math.round(s * 1000));
                touch();
              }}
            />
          </StudioField>
          <StudioField
            label="Max visible toasts"
            for="axis-notify-max"
            hint="Calm default is 2. Overflow drops the oldest lowest-severity toast. 1–6."
          >
            <StudioInput
              id="axis-notify-max"
              type="number"
              mono
              selectOnFocus
              min={1}
              max={6}
              step={1}
              suffix="toasts"
              testId="axis-notify-max"
              value={prefs().maxVisible ?? 2}
              onChange={(v) => {
                setStore(
                  'notifications',
                  'maxVisible',
                  Math.min(6, Math.max(1, Math.round(Number(v) || 2))),
                );
                touch();
              }}
            />
          </StudioField>
          <StudioField
            label="Repeat window"
            for="axis-notify-dedupe"
            hint="Same message inside this window bumps ×N instead of stacking. 0s disables."
          >
            <StudioInput
              id="axis-notify-dedupe"
              type="number"
              mono
              selectOnFocus
              min={0}
              max={60}
              step={1}
              suffix="s"
              testId="axis-notify-dedupe"
              value={Math.round((prefs().dedupeWindowMs ?? 5000) / 1000)}
              onChange={(v) => {
                setStore(
                  'notifications',
                  'dedupeWindowMs',
                  Math.min(60000, Math.max(0, Math.round(Number(v) || 0) * 1000)),
                );
                touch();
              }}
            />
          </StudioField>
          <StudioHint>
            Quiet setup: “Warnings and errors only” plus the categories you care about.
          </StudioHint>
          <div class="ax-toolbar">
            <AppButton
              design="soft"
              tone="ghost"
              size="sm"
              testId="axis-notify-reset"
              feedback={resetFb.state()}
              onClick={() =>
                void resetFb.run(async () => {
                  setStore('notifications', {
                    ...DEFAULT_NOTIFICATIONS,
                    categories: { ...DEFAULT_NOTIFICATIONS.categories },
                  });
                  touch();
                })
              }
            >
              Reset defaults
            </AppButton>
          </div>
        </StudioSection>
      </div>
    </div>
  );
};
