// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings → Notifications panel (shared by the modal dialog and the
 * studio Settings page). Toast preferences apply live and persist.
 *
 * Every toast is also written to System Logs; warn/error log entries raise
 * a toast automatically. Flood control: master switch, per-category
 * toggles, severity floor, dedupe window (repeats collapse to ×N), and a
 * cap on simultaneously visible toasts.
 *
 * @module ui/settings/NotificationsPanel
 */

import type { Component } from 'solid-js';
import { store, setStore, persist, clearToasts, DEFAULT_NOTIFICATIONS } from '../../store';
import type { LogLevel, NotificationCategory } from '../../store/types';
import {
  StudioButton,
  StudioField,
  StudioHint,
  StudioInput,
  StudioSection,
  StudioSelect,
  StudioToggle,
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

const touch = () => persist();

export const NotificationsPanel: Component = () => {
  const prefs = () => store.notifications || DEFAULT_NOTIFICATIONS;
  const setCat = (id: NotificationCategory, v: boolean) => {
    setStore('notifications', 'categories', id, v);
    touch();
  };

  return (
    <div class="ax-split-col">
      <StudioSection
        title="Toasts"
        lead="Transient bottom-right notices. Every toast is also written to System Logs; warn/error log entries raise a toast automatically."
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
            {LEVEL_OPTIONS.map((o) => (
              <option value={o.value}>{o.label}</option>
            ))}
          </StudioSelect>
        </StudioField>
      </StudioSection>

      <StudioSection
        title="Activity categories"
        lead="Toast per activity. Turn off noisy areas — their events stay in System Logs."
      >
        <div class="ax-toggle-grid">
          {CATEGORY_META.map((c) => (
            <StudioToggle
              id={`axis-notify-cat-${c.id}`}
              testId={`axis-notify-cat-${c.id}`}
              checked={prefs().categories?.[c.id] !== false}
              onChange={(v) => setCat(c.id, v)}
              label={c.label}
              hint={c.hint}
            />
          ))}
        </div>
      </StudioSection>

      <StudioSection
        title="Flood control"
        lead="Repeats of the same message collapse into one toast with a ×N badge."
      >
        <StudioField
          label="Auto-dismiss after (seconds)"
          for="axis-notify-duration"
          hint="Errors stick about twice as long. 1.5–30s."
        >
          <StudioInput
            id="axis-notify-duration"
            type="number"
            mono
            min={1.5}
            max={30}
            step={0.5}
            testId="axis-notify-duration"
            value={Math.round((prefs().durationMs || 4500) / 100) / 10}
            onChange={(v) => {
              const s = Math.min(30, Math.max(1.5, Number(v) || 4.5));
              setStore('notifications', 'durationMs', Math.round(s * 1000));
              touch();
            }}
          />
        </StudioField>
        <StudioField
          label="Max visible toasts"
          for="axis-notify-max"
          hint="Overflow drops the oldest lowest-severity toast first. 1–6."
        >
          <StudioInput
            id="axis-notify-max"
            type="number"
            mono
            min={1}
            max={6}
            step={1}
            testId="axis-notify-max"
            value={prefs().maxVisible ?? 3}
            onChange={(v) => {
              setStore(
                'notifications',
                'maxVisible',
                Math.min(6, Math.max(1, Math.round(Number(v) || 3))),
              );
              touch();
            }}
          />
        </StudioField>
        <StudioField
          label="Repeat window (seconds)"
          for="axis-notify-dedupe"
          hint="Same message inside this window bumps ×N instead of stacking. 0 disables."
        >
          <StudioInput
            id="axis-notify-dedupe"
            type="number"
            mono
            min={0}
            max={60}
            step={1}
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
          Tip: keep “Warnings and errors only” plus the categories you care about
          for a quiet setup that still surfaces failures.
        </StudioHint>
        <div class="ax-toolbar">
          <StudioButton
            variant="ghost"
            testId="axis-notify-reset"
            onClick={() => {
              setStore('notifications', {
                ...DEFAULT_NOTIFICATIONS,
                categories: { ...DEFAULT_NOTIFICATIONS.categories },
              });
              touch();
            }}
          >
            Reset defaults
          </StudioButton>
        </div>
      </StudioSection>
    </div>
  );
};
