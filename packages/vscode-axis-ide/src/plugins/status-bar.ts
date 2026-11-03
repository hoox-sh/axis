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
 * AXIS Plugins StatusBar + QuickPick "popup" (`axis.plugins.statusMenu`).
 * VS Code cannot anchor a menu on a StatusBar item — QuickPick is the
 * supported stand-in. Never throws. Never embeds secrets.
 */

import * as vscode from 'vscode';
import type { ExtensionContext, QuickPickItem, StatusBarItem } from 'vscode';
import { runActivatePluginCommand } from './activate-command';
import { readActivePlugins, type WorkspaceStateHelpers } from './active';
import type { HostPluginRegistry } from './registry';
import type { ActivePluginsV1, PluginKind } from './types';

export const PLUGINS_STATUS_MENU_COMMAND = 'axis.plugins.statusMenu';
export const PLUGINS_STATUS_BAR_ID = 'axis.ide.plugins';
export const PLUGINS_STATUS_BAR_NAME = 'AXIS Plugins';
export const PLUGINS_STATUS_BAR_PRIORITY = 98;
/** How long `$(check)` stays on the StatusBar after a successful activate/switch. */
export const PLUGINS_STATUS_FLASH_MS = 1200;

/** Stable QuickPick action ids (tests + command dispatch). */
export const PLUGINS_STATUS_MENU_IDS = {
  openPlugins: 'openPlugins',
  switchSource: 'switchSource',
  switchStream: 'switchStream',
  switchEngine: 'switchEngine',
  switchStorage: 'switchStorage',
  openChart: 'openChart',
  runScript: 'runScript',
  liveStart: 'liveStart',
  liveStop: 'liveStop',
  probeWorkers: 'probeWorkers',
  setWorkerKey: 'setWorkerKey',
  setProKey: 'setProKey',
  showRunOutput: 'showRunOutput',
} as const;

export type PluginsStatusMenuId =
  (typeof PLUGINS_STATUS_MENU_IDS)[keyof typeof PLUGINS_STATUS_MENU_IDS];

export type PluginsStatusMenuItem = QuickPickItem & {
  id?: string;
};

type StatusBarSession = {
  item: StatusBarItem;
  helpers: WorkspaceStateHelpers;
  registry: HostPluginRegistry;
  onChanged?: () => void | Thenable<void>;
};

let session: StatusBarSession | undefined;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

const SWITCH_KINDS = ['source', 'stream', 'engine', 'storage'] as const;

const KIND_LABEL: Record<(typeof SWITCH_KINDS)[number], string> = {
  source: 'Source',
  stream: 'Stream',
  engine: 'Engine',
  storage: 'Storage',
};

const ACTION_COMMAND: Record<string, string> = {
  openChart: 'axis.openChart',
  runScript: 'axis.runScript',
  liveStart: 'axis.liveStart',
  liveStop: 'axis.liveStop',
  probeWorkers: 'axis.workers.probeAll',
  setWorkerKey: 'axis.secrets.setWorkerKey',
  setProKey: 'axis.secrets.setProKey',
  showRunOutput: 'axis.showRunOutput',
};

function warn(message: string): void {
  try {
    void vscode.window.showWarningMessage(message);
  } catch {
    // UI host unavailable
  }
}

function readKindId(active: ActivePluginsV1 | undefined, kind: PluginKind): string {
  try {
    const v = active?.[kind];
    if (typeof v !== 'string') return '';
    const trimmed = v.trim();
    return trimmed;
  } catch {
    return '';
  }
}

function displayId(active: ActivePluginsV1 | undefined, kind: PluginKind): string {
  const id = readKindId(active, kind);
  return id || '—';
}

/** Compact id for StatusBar text (first hyphen/underscore segment). */
export function compactPluginId(id: string | undefined | null): string {
  try {
    const raw = typeof id === 'string' ? id.trim() : '';
    if (!raw) return '—';
    const first = raw.split(/[-_]/)[0] || raw;
    return first.length > 16 ? first.slice(0, 16) : first;
  } catch {
    return '—';
  }
}

export type FormatPluginsStatusTextOptions = {
  /** When true, use `$(check)` instead of `$(plug)` (activate/switch flash). */
  flash?: boolean;
};

/** Compact StatusBar text: `$(plug) src·eng` (or `$(check)` while flashing). Never embeds secrets. */
export function formatPluginsStatusText(
  active: ActivePluginsV1 | undefined,
  opts?: FormatPluginsStatusTextOptions,
): string {
  let flash = false;
  try {
    flash = opts?.flash === true;
  } catch {
    flash = false;
  }
  try {
    const src = compactPluginId(readKindId(active, 'source'));
    const eng = compactPluginId(readKindId(active, 'engine'));
    return `${flash ? '$(check)' : '$(plug)'} ${src}·${eng}`;
  } catch {
    return flash ? '$(check) —·—' : '$(plug) —·—';
  }
}

function clearFlashTimer(): void {
  try {
    if (flashTimer !== undefined) {
      clearTimeout(flashTimer);
    }
  } catch {
    // ignore
  }
  flashTimer = undefined;
}

/**
 * Markdown tooltip body listing active source/stream/engine/storage.
 * Trusted is applied by the caller (`MarkdownString.isTrusted = false`).
 * Never serializes extra/secret fields.
 */
export function formatPluginsStatusMarkdown(
  active: ActivePluginsV1 | undefined,
): string {
  try {
    const source = displayId(active, 'source');
    const stream = displayId(active, 'stream');
    const engine = displayId(active, 'engine');
    const storage = displayId(active, 'storage');
    return [
      '**AXIS Plugins**',
      '',
      `- Source: \`${source}\``,
      `- Stream: \`${stream}\``,
      `- Engine: \`${engine}\``,
      `- Storage: \`${storage}\``,
      '',
      'Click for plugin and chart actions.',
    ].join('\n');
  } catch {
    return '**AXIS Plugins**\n\nClick for plugin and chart actions.';
  }
}

function readSeparatorKind(): number | undefined {
  try {
    const k = (vscode as { QuickPickItemKind?: { Separator?: number } })
      .QuickPickItemKind?.Separator;
    return typeof k === 'number' ? k : undefined;
  } catch {
    return undefined;
  }
}

function isSeparator(item: unknown): boolean {
  try {
    const kind = readSeparatorKind();
    if (kind == null || item == null || typeof item !== 'object') return false;
    return (item as { kind?: unknown }).kind === kind;
  } catch {
    return false;
  }
}

function readLiveEnabled(): boolean {
  try {
    const v: unknown = vscode.workspace
      .getConfiguration('axis.live')
      .get('enabled', true);
    return v !== false;
  } catch {
    return true;
  }
}

export type BuildStatusMenuOptions = {
  liveEnabled?: boolean;
};

/** Build the status-menu QuickPick rows (never throws). */
export function buildPluginsStatusMenuItems(
  opts?: BuildStatusMenuOptions,
): PluginsStatusMenuItem[] {
  const items: PluginsStatusMenuItem[] = [];
  try {
    const liveEnabled = opts?.liveEnabled ?? readLiveEnabled();
    const sepKind = readSeparatorKind();
    const pushSep = (): void => {
      if (sepKind == null) return;
      items.push({ label: '', kind: sepKind });
    };

    items.push({
      id: PLUGINS_STATUS_MENU_IDS.openPlugins,
      label: 'Open Plugins view',
      description: 'axis.plugins',
    });
    pushSep();
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.switchSource,
      label: 'Switch Source…',
    });
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.switchStream,
      label: 'Switch Stream…',
    });
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.switchEngine,
      label: 'Switch Engine…',
    });
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.switchStorage,
      label: 'Switch Storage…',
    });
    pushSep();
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.openChart,
      label: 'Open Chart',
      description: 'axis.openChart',
    });
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.runScript,
      label: 'Run Script',
      description: 'axis.runScript',
    });
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.liveStart,
      label: 'Live Start',
      description: liveEnabled ? 'axis.live.enabled' : 'live off',
    });
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.liveStop,
      label: 'Live Stop',
      description: liveEnabled ? 'axis.liveStop' : 'live off',
    });
    pushSep();
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.probeWorkers,
      label: 'Probe Workers',
      description: 'axis.workers.probeAll',
    });
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.setWorkerKey,
      label: 'Secrets: Set Worker Key',
      description: 'axis.secrets.setWorkerKey',
    });
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.setProKey,
      label: 'Secrets: Set Pro Key',
      description: 'axis.secrets.setProKey',
    });
    items.push({
      id: PLUGINS_STATUS_MENU_IDS.showRunOutput,
      label: 'Show Run Output',
      description: 'axis.showRunOutput',
    });
  } catch {
    // return whatever was pushed
  }
  return items;
}

function alignLeft(): number {
  try {
    const left = vscode.StatusBarAlignment?.Left;
    return typeof left === 'number' ? left : 1;
  } catch {
    return 1;
  }
}

function applyTooltip(item: StatusBarItem, active: ActivePluginsV1): void {
  const body = formatPluginsStatusMarkdown(active);
  try {
    const Ctor = vscode.MarkdownString;
    if (typeof Ctor === 'function') {
      const md = new Ctor(body);
      try {
        md.isTrusted = false;
      } catch {
        // mock without isTrusted
      }
      item.tooltip = md;
      return;
    }
  } catch {
    // fall through to plain string
  }
  try {
    item.tooltip = body;
  } catch {
    // disposed
  }
}

export type RefreshPluginsStatusBarOptions = {
  /** Briefly show `$(check) src·eng` then revert after {@link PLUGINS_STATUS_FLASH_MS}. */
  flash?: boolean;
};

/** Refresh StatusBar text/tooltip from workspaceState. Never throws. */
export function refreshPluginsStatusBar(opts?: RefreshPluginsStatusBarOptions): void {
  try {
    if (!session) return;
    const active = readActivePlugins(session.helpers);
    let flash = false;
    try {
      flash = opts?.flash === true;
    } catch {
      flash = false;
    }
    clearFlashTimer();
    try {
      session.item.text = formatPluginsStatusText(active, { flash });
    } catch {
      // disposed
    }
    applyTooltip(session.item, active);
    if (flash) {
      try {
        flashTimer = setTimeout(() => {
          flashTimer = undefined;
          try {
            if (!session) return;
            const latest = readActivePlugins(session.helpers);
            session.item.text = formatPluginsStatusText(latest);
          } catch {
            // never throw from timer
          }
        }, PLUGINS_STATUS_FLASH_MS);
      } catch {
        try {
          session.item.text = formatPluginsStatusText(active);
        } catch {
          // disposed
        }
      }
    }
    try {
      session.item.show();
    } catch {
      // disposed
    }
  } catch {
    // never throw
  }
}

async function execCommand(command: string): Promise<void> {
  try {
    await vscode.commands.executeCommand(command);
  } catch {
    // command missing / host unavailable
  }
}

/** Open the AXIS activity container then focus `axis.plugins`. Never throws. */
export async function openPluginsView(): Promise<void> {
  try {
    try {
      await vscode.commands.executeCommand('workbench.view.extension.axis');
    } catch {
      // container command may be missing
    }
    const showView = (
      vscode.window as unknown as {
        showView?: (id: string) => Thenable<unknown>;
      }
    ).showView;
    if (typeof showView === 'function') {
      try {
        await showView.call(vscode.window, 'axis.plugins');
        return;
      } catch {
        // fall through to focus command
      }
    }
    try {
      await vscode.commands.executeCommand('axis.plugins.focus');
    } catch {
      try {
        await vscode.commands.executeCommand('workbench.view.extension.axis');
      } catch {
        // ignore
      }
    }
  } catch {
    try {
      await vscode.commands.executeCommand('workbench.view.extension.axis');
    } catch {
      // never throw
    }
  }
}

function pluginPickItems(kind: PluginKind): PluginsStatusMenuItem[] {
  const out: PluginsStatusMenuItem[] = [];
  try {
    const list = session?.registry.list(kind) ?? [];
    const active = session ? readActivePlugins(session.helpers) : {};
    const activeId = readKindId(active, kind);
    for (const plugin of list) {
      try {
        const id = String(plugin.id || '').trim();
        if (!id) continue;
        const name = String(plugin.name || id).trim() || id;
        let description: string | undefined;
        try {
          description = plugin.description != null ? String(plugin.description) : id;
        } catch {
          description = id;
        }
        out.push({
          id,
          label: id === activeId ? `$(check) ${name}` : name,
          description,
        });
      } catch {
        // skip hostile descriptor
      }
    }
  } catch {
    // list threw
  }
  return out;
}

async function switchKind(kind: PluginKind): Promise<void> {
  try {
    const items = pluginPickItems(kind);
    if (items.length === 0) {
      warn(`AXIS: No ${kind} plugins registered.`);
      return;
    }
    const title = KIND_LABEL[kind as (typeof SWITCH_KINDS)[number]] ?? kind;
    let picked: unknown;
    try {
      picked = await vscode.window.showQuickPick(items, {
        canPickMany: false,
        placeHolder: `Switch ${title}…`,
        matchOnDescription: true,
      });
    } catch {
      return;
    }
    if (picked == null || isSeparator(picked)) return;
    let id = '';
    try {
      const rec = picked as { id?: unknown; description?: unknown; label?: unknown };
      if (typeof rec.id === 'string') id = rec.id.trim();
      if (!id && typeof rec.description === 'string') id = rec.description.trim();
    } catch {
      return;
    }
    if (!id || !session) return;
    const helpers = session.helpers;
    const onChanged = session.onChanged;
    await runActivatePluginCommand(helpers, { kind, id }, async () => {
      refreshPluginsStatusBar({ flash: true });
      if (onChanged) {
        try {
          await onChanged();
        } catch {
          // refresh is best-effort
        }
      }
    });
  } catch {
    // never throw
  }
}

function resolveActionId(
  picked: unknown,
  items: readonly PluginsStatusMenuItem[],
): string {
  try {
    if (picked == null || typeof picked !== 'object') return '';
    const rec = picked as { id?: unknown; label?: unknown };
    if (typeof rec.id === 'string' && rec.id.trim()) return rec.id.trim();
    const label = typeof rec.label === 'string' ? rec.label : '';
    if (!label) return '';
    const match = items.find((i) => i.label === label && i.id);
    return match?.id ?? '';
  } catch {
    return '';
  }
}

async function runMenuAction(id: string): Promise<void> {
  try {
    if (id === PLUGINS_STATUS_MENU_IDS.openPlugins) {
      await openPluginsView();
      return;
    }
    if (id === PLUGINS_STATUS_MENU_IDS.switchSource) {
      await switchKind('source');
      return;
    }
    if (id === PLUGINS_STATUS_MENU_IDS.switchStream) {
      await switchKind('stream');
      return;
    }
    if (id === PLUGINS_STATUS_MENU_IDS.switchEngine) {
      await switchKind('engine');
      return;
    }
    if (id === PLUGINS_STATUS_MENU_IDS.switchStorage) {
      await switchKind('storage');
      return;
    }
    const command = ACTION_COMMAND[id];
    if (command) {
      await execCommand(command);
    }
  } catch {
    // never throw
  }
}

async function runPluginsStatusMenu(): Promise<void> {
  try {
    const items = buildPluginsStatusMenuItems();
    let picked: unknown;
    try {
      picked = await vscode.window.showQuickPick(items, {
        canPickMany: false,
        placeHolder: 'AXIS plugin and chart actions',
        title: 'AXIS Plugins',
      });
    } catch {
      return;
    }
    if (picked == null || isSeparator(picked)) return;
    const id = resolveActionId(picked, items);
    if (!id) return;
    await runMenuAction(id);
  } catch {
    // never throw
  }
}

/** @internal Reset module session for unit tests. */
export function _resetPluginsStatusBarForTests(): void {
  clearFlashTimer();
  try {
    session?.item.dispose();
  } catch {
    // ignore
  }
  session = undefined;
}

/**
 * Create the AXIS Plugins StatusBar item and register
 * `axis.plugins.statusMenu`. Never throws.
 */
export function registerPluginsStatusBar(
  context: ExtensionContext,
  helpers: WorkspaceStateHelpers,
  registry: HostPluginRegistry,
  onChanged?: () => void | Thenable<void>,
): { item?: StatusBarItem } {
  try {
    if (session) {
      try {
        session.item.dispose();
      } catch {
        // previous item
      }
      session = undefined;
    }
    const item = vscode.window.createStatusBarItem(
      PLUGINS_STATUS_BAR_ID,
      alignLeft() as vscode.StatusBarAlignment,
      PLUGINS_STATUS_BAR_PRIORITY,
    );
    try {
      item.name = PLUGINS_STATUS_BAR_NAME;
    } catch {
      // mock without name
    }
    try {
      item.command = PLUGINS_STATUS_MENU_COMMAND;
    } catch {
      // mock without command
    }
    session = { item, helpers, registry, onChanged };
    refreshPluginsStatusBar();
    try {
      const disp = vscode.commands.registerCommand(
        PLUGINS_STATUS_MENU_COMMAND,
        async () => {
          try {
            await runPluginsStatusMenu();
          } catch {
            // never throw into the command host
          }
        },
      );
      try {
        context.subscriptions.push(disp, item);
      } catch {
        // subscriptions missing
      }
    } catch {
      try {
        context.subscriptions.push(item);
      } catch {
        // ignore
      }
    }
    try {
      item.show();
    } catch {
      // disposed
    }
    return { item };
  } catch {
    return {};
  }
}
