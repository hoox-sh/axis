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
 * One alert row: condition summary, delivery chips, quick actions and the
 * `···` menu.
 *
 * Presentation plus callbacks only — the panel owns the alert list, the
 * composer draft and which row menu is open. Extracted from `AlertsPanel.tsx`.
 *
 * @module ui/alerts/AlertRow
 */

import { type Component, Show, createMemo } from 'solid-js';
import {
  alertKindGroup,
  formatAlertCondition,
  formatAlertKind,
  formatLastFired,
  formatLastFiredRelative,
  type Alert,
} from '../../alerts';
import { alertRowTone } from '../../alerts/row-tone';
import { Icons } from '../icons';

/** Props for {@link AlertRow}. */
export interface AlertRowProps {
  /** The alert to render. */
  alert: Alert;
  /** Current time (ms) — drives "fired 2m ago" and the row tone. */
  now: () => number;
  /** Whether this row's `···` menu is open. */
  menuOpen: boolean;
  /** Open or close the row menu (`null` closes). */
  onMenuOpenChange: (alert: Alert | null) => void;
  onToggle: (alert: Alert) => void;
  onToggleNotify: (alert: Alert) => void;
  /** Open the composer for this alert. */
  onEdit: (alert: Alert) => void;
  onDuplicate: (alert: Alert) => void;
  onCopyCondition: (alert: Alert) => void;
  onTestWebhook: (alert: Alert) => void;
  onDelete: (id: string, name: string) => void;
}

/** A single alert row. */
export const AlertRow: Component<AlertRowProps> = (props): JSX.Element => {
  const tone = createMemo(() => alertRowTone(props.alert, props.now()));

  return (
    <li
      class="ax-alerts-row"
      classList={{
        'is-fired': tone() === 'fired',
        'is-armed': tone() === 'armed',
        'is-off': tone() === 'disabled',
        'is-menu-open': props.menuOpen,
      }}
      data-testid="axis-alerts-row"
      data-alert-id={props.alert.id}
      data-enabled={props.alert.enabled ? '1' : '0'}
      data-tone={tone()}
    >
      <div class="ax-alerts-row-inner">
        <button
          type="button"
          class="ax-alerts-toggle"
          aria-pressed={props.alert.enabled}
          title={props.alert.enabled ? 'Disable alert' : 'Enable alert'}
          aria-label={
            props.alert.enabled ? `Disable ${props.alert.name}` : `Enable ${props.alert.name}`
          }
          data-testid="axis-alerts-toggle"
          onClick={() => props.onToggle(props.alert)}
        >
          <span class="ax-alerts-toggle-dot" />
        </button>
        <div class="ax-alerts-row-main">
          <div class="ax-alerts-row-top">
            <span
              class="ax-alerts-kind"
              data-group={alertKindGroup(props.alert.kind)}
              title={formatAlertKind(props.alert.kind)}
            >
              {formatAlertKind(props.alert.kind)}
            </span>
            <span class="ax-alerts-name" title={props.alert.name}>
              {props.alert.name}
            </span>
          </div>
          <div class="ax-alerts-cond" title={formatAlertCondition(props.alert)}>
            <span class="ax-alerts-symbol">{props.alert.symbol}</span>
            <span class="ax-alerts-dot-sep">·</span>
            <span>{formatAlertCondition(props.alert)}</span>
            <Show when={props.alert.interval}>
              <span class="ax-alerts-interval">{props.alert.interval}</span>
            </Show>
          </div>
          <div class="ax-alerts-meta">
            <span
              class="ax-alerts-fired"
              classList={{ 'is-recent': tone() === 'fired' }}
              title={`Last fired: ${formatLastFired(props.alert.lastFiredAt)}`}
            >
              {formatLastFiredRelative(props.alert.lastFiredAt, props.now())}
            </span>
            <Show when={props.alert.notifyBrowser !== false}>
              <span class="ax-alerts-delivery-chip" title="Browser notification">
                <Icons.alerts size={9} />
              </span>
            </Show>
            <Show when={props.alert.webhookUrl}>
              <span class="ax-alerts-delivery-chip" title={props.alert.webhookUrl}>
                <Icons.cable size={9} />
              </span>
            </Show>
            <Show when={props.alert.l2WebhookUrl}>
              <span class="ax-alerts-delivery-chip" title={props.alert.l2WebhookUrl}>
                L2
              </span>
            </Show>
            <Show when={props.alert.cooldownMs}>
              <span
                class="ax-alerts-delivery-chip"
                title={`Cooldown ${Math.round((props.alert.cooldownMs || 0) / 1000)}s`}
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
            classList={{ 'is-on': props.alert.notifyBrowser !== false }}
            title={
              props.alert.notifyBrowser === false
                ? 'Enable browser notification'
                : 'Disable browser notification'
            }
            aria-label={
              props.alert.notifyBrowser === false
                ? `Enable notifications for ${props.alert.name}`
                : `Disable notifications for ${props.alert.name}`
            }
            data-testid="axis-alerts-row-notify"
            onClick={() => props.onToggleNotify(props.alert)}
          >
            <Icons.alerts size={11} />
          </button>
          <button
            type="button"
            class="ax-alerts-icon"
            classList={{ 'is-on': props.menuOpen }}
            title="Alert actions"
            aria-label={`Actions for ${props.alert.name}`}
            aria-expanded={props.menuOpen}
            data-testid="axis-alerts-row-menu"
            onClick={() => props.onMenuOpenChange(props.menuOpen ? null : props.alert)}
          >
            <Icons.menu size={11} />
          </button>
        </div>
      </div>

      <Show when={props.menuOpen}>
        <div class="ax-alerts-row-menu" data-testid="axis-alerts-row-menu-row">
          <button
            type="button"
            onClick={() => {
              props.onMenuOpenChange(null);
              props.onEdit(props.alert);
            }}
          >
            <Icons.pencil size={10} /> Edit
          </button>
          <button
            type="button"
            onClick={() => {
              props.onMenuOpenChange(null);
              props.onDuplicate(props.alert);
            }}
          >
            <Icons.copy size={10} /> Duplicate
          </button>
          <button type="button" onClick={() => void props.onCopyCondition(props.alert)}>
            <Icons.copy size={10} /> Copy condition
          </button>
          <Show when={props.alert.webhookUrl}>
            <button type="button" onClick={() => void props.onTestWebhook(props.alert)}>
              <Icons.cable size={10} /> Test webhook
            </button>
          </Show>
          <button
            type="button"
            class="is-danger"
            onClick={() => {
              props.onMenuOpenChange(null);
              props.onDelete(props.alert.id, props.alert.name);
            }}
          >
            <Icons.trash size={10} /> Delete
          </button>
        </div>
      </Show>
    </li>
  );
};
