// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * MVP Alerts TreeView CRUD (`axis.alerts`).
 * Persist list under workspaceState key `axis.alerts.v1`.
 * Not full PWA alerts parity — add/remove + list only.
 */

import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';

export const ALERTS_VIEW_ID = 'axis.alerts';
export const ALERTS_STORAGE_KEY = 'axis.alerts.v1';
export const ALERTS_ADD_COMMAND = 'axis.alerts.add';
export const ALERTS_REMOVE_COMMAND = 'axis.alerts.remove';

/** MVP alert row persisted in workspaceState. */
export type AlertEntry = {
  id: string;
  title: string;
  condition?: string;
  enabled: boolean;
};

/**
 * Minimal Memento surface so unit tests inject a Map without loading `vscode`.
 * Extension wiring binds `context.workspaceState` (get/update).
 */
export type WorkspaceStateHelpers = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | void | Promise<void>;
};

/** Injectable UI for add/remove commands (tests avoid real InputBox/QuickPick). */
export type AlertsUi = {
  showInputBox(
    options: {
      prompt?: string;
      placeHolder?: string;
      value?: string;
      ignoreFocusOut?: boolean;
    },
  ): Promise<string | undefined>;
  showQuickPick(
    items: ReadonlyArray<{ label: string; description?: string; alertId: string }>,
    options: { placeHolder?: string },
  ): Promise<{ label: string; description?: string; alertId: string } | undefined>;
  showInformationMessage?(message: string): void;
  showWarningMessage?(message: string): void;
};

export const EMPTY_ALERTS_V1: readonly AlertEntry[] = [];

/** Sanitize one unknown row into an AlertEntry or null. */
export function sanitizeAlertEntry(raw: unknown): AlertEntry | null {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!id || !title) return null;
    const condition =
      typeof row.condition === 'string' && row.condition.trim()
        ? row.condition.trim()
        : undefined;
    const enabled = row.enabled === false ? false : true;
    return condition !== undefined
      ? { id, title, condition, enabled }
      : { id, title, enabled };
  } catch {
    return null;
  }
}

/** Parse unknown workspaceState value into a clean alert array (never throws). */
export function parseAlertsV1(raw: unknown): AlertEntry[] {
  try {
    if (!Array.isArray(raw)) return [];
    const out: AlertEntry[] = [];
    const seen = new Set<string>();
    for (const row of raw) {
      const entry = sanitizeAlertEntry(row);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

/** Read `axis.alerts.v1` via helpers (never throws; empty on failure). */
export function readAlertsV1(helpers: WorkspaceStateHelpers): AlertEntry[] {
  try {
    const raw = helpers.get<unknown>(ALERTS_STORAGE_KEY);
    return parseAlertsV1(raw);
  } catch {
    return [...EMPTY_ALERTS_V1];
  }
}

/**
 * Write alert list to `axis.alerts.v1`.
 * Never throws — returns false on store failure.
 */
export async function writeAlertsV1(
  helpers: WorkspaceStateHelpers,
  list: readonly AlertEntry[],
): Promise<boolean> {
  try {
    const clean = parseAlertsV1(list);
    await Promise.resolve(helpers.update(ALERTS_STORAGE_KEY, clean));
    return true;
  } catch {
    return false;
  }
}

/** In-memory WorkspaceStateHelpers for unit tests (mock Memento). */
export function createMemoryWorkspaceState(
  initial?: Iterable<[string, unknown]>,
): WorkspaceStateHelpers & { readonly map: Map<string, unknown> } {
  const map = new Map<string, unknown>(initial);
  return {
    map,
    get<T>(key: string): T | undefined {
      return map.get(key) as T | undefined;
    },
    update(key: string, value: unknown): void {
      if (value === undefined) map.delete(key);
      else map.set(key, value);
    },
  };
}

export function newAlertId(): string {
  try {
    const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    /* fall through */
  }
  return `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type AlertTreeNode = {
  id: string;
  label: string;
  description?: string;
  alertId?: string;
  empty?: boolean;
  enabled?: boolean;
  condition?: string;
};

/** Root children for the Alerts tree (empty placeholder when none). */
export function alertsRootChildren(alerts: readonly AlertEntry[]): AlertTreeNode[] {
  if (!alerts.length) {
    return [{ id: 'alerts.empty', label: 'Add an alert', empty: true }];
  }
  return alerts.map((a) => ({
    id: `alert:${a.id}`,
    label: a.title,
    description: a.enabled
      ? a.condition || 'enabled'
      : a.condition
        ? `disabled · ${a.condition}`
        : 'disabled',
    alertId: a.id,
    enabled: a.enabled,
    condition: a.condition,
  }));
}

/** Defensive ThemeIcon — Bun vscode mocks may omit the constructor. */
function tryThemeIcon(id: string): vscode.ThemeIcon | undefined {
  try {
    const Ctor = (
      vscode as { ThemeIcon?: new (iconId: string) => vscode.ThemeIcon }
    ).ThemeIcon;
    if (typeof Ctor === 'function') return new Ctor(id);
  } catch {
    /* mock without ThemeIcon */
  }
  return undefined;
}

/** Untrusted markdown tooltip (no theme icons). */
function tryMarkdownTooltip(lines: readonly string[]): vscode.MarkdownString | string {
  const value = lines.filter((line) => line.length > 0).join('\n');
  try {
    const Ctor = (
      vscode as { MarkdownString?: new (value?: string) => vscode.MarkdownString }
    ).MarkdownString;
    if (typeof Ctor === 'function') {
      const md = new Ctor(value);
      try {
        md.supportThemeIcons = false;
      } catch {
        /* mock */
      }
      try {
        md.isTrusted = false;
      } catch {
        /* mock */
      }
      return md;
    }
  } catch {
    /* mock without MarkdownString */
  }
  return value;
}

/**
 * Tree change emitter that works under Bun unit mocks (some files mock `vscode`
 * without `EventEmitter` — last mock.module wins globally).
 */
function createTreeChangeEmitter<T>(): {
  event: vscode.Event<T>;
  fire(data: T): void;
} {
  const Emitter = (
    vscode as { EventEmitter?: new () => { event: vscode.Event<T>; fire(data: T): void } }
  ).EventEmitter;
  if (typeof Emitter === 'function') {
    return new Emitter();
  }
  const listeners = new Set<(data: T) => void>();
  return {
    event: ((listener: (data: T) => void) => {
      listeners.add(listener);
      return {
        dispose() {
          listeners.delete(listener);
        },
      };
    }) as vscode.Event<T>,
    fire(data: T) {
      for (const listener of listeners) listener(data);
    },
  };
}

/** Alerts TreeDataProvider (`axis.alerts`). */
export class AlertsTreeProvider
  implements vscode.TreeDataProvider<AlertTreeNode>
{
  private readonly _onDidChangeTreeData =
    createTreeChangeEmitter<AlertTreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly state: WorkspaceStateHelpers) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  list(): AlertEntry[] {
    return readAlertsV1(this.state);
  }

  getTreeItem(element: AlertTreeNode): vscode.TreeItem {
    // Defensive: Bun mock.module is global — last vscode mock may omit CollapsibleState.
    const collapsible = (
      vscode as {
        TreeItemCollapsibleState?: { None?: number };
      }
    ).TreeItemCollapsibleState;
    const none =
      collapsible && typeof collapsible.None === 'number' ? collapsible.None : 0;
    const item = new vscode.TreeItem(element.label, none);
    item.id = element.id;
    item.description = element.description;
    item.contextValue = element.empty
      ? 'axis.alerts.empty'
      : 'axis.alerts.entry';
    const iconId =
      !element.empty && element.enabled === false ? 'bell-slash' : 'bell';
    const icon = tryThemeIcon(iconId);
    if (icon) item.iconPath = icon;
    item.tooltip = tryMarkdownTooltip([
      'kind: alert',
      `id: ${element.alertId ?? element.id}`,
      element.condition ? `condition: ${element.condition}` : '',
    ]);
    return item;
  }

  getChildren(element?: AlertTreeNode): AlertTreeNode[] {
    if (element) return [];
    return alertsRootChildren(this.list());
  }
}

/** Pure add: append a new alert and persist. */
export async function addAlert(
  helpers: WorkspaceStateHelpers,
  input: { title: string; condition?: string; enabled?: boolean; id?: string },
): Promise<AlertEntry | null> {
  const title = String(input.title ?? '').trim();
  if (!title) return null;
  const condition =
    typeof input.condition === 'string' && input.condition.trim()
      ? input.condition.trim()
      : undefined;
  const entry: AlertEntry = {
    id: (input.id && String(input.id).trim()) || newAlertId(),
    title,
    enabled: input.enabled === false ? false : true,
    ...(condition !== undefined ? { condition } : {}),
  };
  const next = [...readAlertsV1(helpers), entry];
  const ok = await writeAlertsV1(helpers, next);
  return ok ? entry : null;
}

/** Pure remove by id; returns true when an entry was removed and persisted. */
export async function removeAlert(
  helpers: WorkspaceStateHelpers,
  id: string,
): Promise<boolean> {
  const target = String(id ?? '').trim();
  if (!target) return false;
  const list = readAlertsV1(helpers);
  const next = list.filter((a) => a.id !== target);
  if (next.length === list.length) return false;
  return writeAlertsV1(helpers, next);
}

/**
 * Add command flow: title InputBox → optional condition InputBox → persist + refresh.
 */
export async function runAddAlertCommand(
  helpers: WorkspaceStateHelpers,
  ui: AlertsUi,
  provider?: AlertsTreeProvider,
): Promise<AlertEntry | null> {
  const title = await ui.showInputBox({
    prompt: 'Alert title',
    placeHolder: 'e.g. BTC above 100k',
    ignoreFocusOut: true,
  });
  if (title === undefined) return null;
  const trimmed = title.trim();
  if (!trimmed) {
    ui.showWarningMessage?.('AXIS: Alert title is required.');
    return null;
  }

  const conditionRaw = await ui.showInputBox({
    prompt: 'Condition (optional)',
    placeHolder: 'e.g. close > 100000',
    ignoreFocusOut: true,
  });
  if (conditionRaw === undefined) return null;

  const entry = await addAlert(helpers, {
    title: trimmed,
    condition: conditionRaw.trim() || undefined,
  });
  if (!entry) {
    ui.showWarningMessage?.('AXIS: Could not save alert.');
    return null;
  }
  provider?.refresh();
  ui.showInformationMessage?.(`AXIS: Alert “${entry.title}” added.`);
  return entry;
}

/**
 * Remove command flow: QuickPick existing alerts → persist + refresh.
 */
export async function runRemoveAlertCommand(
  helpers: WorkspaceStateHelpers,
  ui: AlertsUi,
  provider?: AlertsTreeProvider,
): Promise<boolean> {
  const list = readAlertsV1(helpers);
  if (list.length === 0) {
    ui.showInformationMessage?.('AXIS: No alerts to remove.');
    return false;
  }
  const picked = await ui.showQuickPick(
    list.map((a) => ({
      label: a.title,
      description: a.enabled
        ? a.condition || a.id
        : `disabled · ${a.condition || a.id}`,
      alertId: a.id,
    })),
    { placeHolder: 'Remove alert' },
  );
  if (!picked) return false;
  const ok = await removeAlert(helpers, picked.alertId);
  if (ok) {
    provider?.refresh();
    ui.showInformationMessage?.(`AXIS: Alert “${picked.label}” removed.`);
  } else {
    ui.showWarningMessage?.('AXIS: Could not remove alert.');
  }
  return ok;
}

function defaultAlertsUi(): AlertsUi {
  return {
    async showInputBox(options) {
      return vscode.window.showInputBox(options);
    },
    async showQuickPick(items, options) {
      return vscode.window.showQuickPick([...items], options);
    },
    showInformationMessage(message) {
      void vscode.window.showInformationMessage(message);
    },
    showWarningMessage(message) {
      void vscode.window.showWarningMessage(message);
    },
  };
}

function workspaceStateFromContext(
  context: ExtensionContext,
): WorkspaceStateHelpers {
  return {
    get<T>(key: string): T | undefined {
      return context.workspaceState.get<T>(key);
    },
    update(key: string, value: unknown) {
      return context.workspaceState.update(key, value);
    },
  };
}

export type RegisterAlertsViewResult = {
  provider: AlertsTreeProvider;
  state: WorkspaceStateHelpers;
};

/**
 * Register Alerts TreeView + `axis.alerts.add` / `axis.alerts.remove`.
 * Does not edit package.json / extension.ts — merge the contributes fragment separately.
 */
export function registerAlertsView(
  context: ExtensionContext,
  opts?: {
    state?: WorkspaceStateHelpers;
    ui?: AlertsUi;
  },
): RegisterAlertsViewResult {
  const state = opts?.state ?? workspaceStateFromContext(context);
  const ui = opts?.ui ?? defaultAlertsUi();
  const provider = new AlertsTreeProvider(state);

  const view = vscode.window.createTreeView(ALERTS_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const addCmd = vscode.commands.registerCommand(ALERTS_ADD_COMMAND, () =>
    runAddAlertCommand(state, ui, provider),
  );
  const removeCmd = vscode.commands.registerCommand(
    ALERTS_REMOVE_COMMAND,
    () => runRemoveAlertCommand(state, ui, provider),
  );

  context.subscriptions.push(view, addCmd, removeCmd);
  return { provider, state };
}
