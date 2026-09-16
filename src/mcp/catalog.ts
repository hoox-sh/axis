/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Live-app capabilities the PWA MCP host can invoke.
 *
 * @module mcp/catalog
 */

import type { CapabilitySpec } from './protocol';

export const APP_CAPABILITIES: readonly CapabilitySpec[] = [
  { id: 'app.capabilities', domain: 'app', description: 'List capability ids', mutates: false },
  { id: 'app.snapshot', domain: 'app', description: 'Sanitized workspace snapshot', mutates: false },
  { id: 'app.get', domain: 'app', description: 'Read a snapshot path', mutates: false },
  { id: 'app.set', domain: 'app', description: 'Patch an allowlisted store path', mutates: true },
  { id: 'app.command', domain: 'app', description: 'Run a command-palette command by id', mutates: true },
  { id: 'app.shortcut', domain: 'app', description: 'Fire a keyboard shortcut by id', mutates: true },
  { id: 'app.event', domain: 'app', description: 'Dispatch a window CustomEvent', mutates: true },

  { id: 'chart.get', domain: 'chart', description: 'Symbol, interval, type, layout, bar summary', mutates: false },
  { id: 'chart.set', domain: 'chart', description: 'Set symbol/interval/type/grid without loading', mutates: true },
  { id: 'chart.load', domain: 'chart', description: 'Load OHLCV for a symbol/interval/source', mutates: true },
  { id: 'chart.reload', domain: 'chart', description: 'Reload the current symbol', mutates: true },
  { id: 'chart.live', domain: 'chart', description: 'Start or stop the live stream', mutates: true },
  { id: 'chart.layout', domain: 'chart', description: 'Get/set grid mode or named layouts', mutates: true },
  { id: 'chart.theme', domain: 'chart', description: 'Get/set chart theme preset', mutates: true },
  { id: 'chart.type', domain: 'chart', description: 'Set chart type (candles, bars, line, …)', mutates: true },
  { id: 'chart.screenshot', domain: 'chart', description: 'Capture chart PNG (base64)', mutates: false },
  { id: 'chart.zoom', domain: 'chart', description: 'Zoom/pan/reset the active chart', mutates: true },

  { id: 'editor.get', domain: 'editor', description: 'Read the active Pine buffer', mutates: false },
  { id: 'editor.set', domain: 'editor', description: 'Replace the active Pine buffer', mutates: true },
  { id: 'editor.run', domain: 'editor', description: 'Run the editor document against loaded bars', mutates: true },
  { id: 'editor.diagnostics', domain: 'editor', description: 'Current editor diagnostics / pre-eval', mutates: false },

  { id: 'indicators.list', domain: 'indicators', description: 'Applied chart scripts', mutates: false },
  { id: 'indicators.add', domain: 'indicators', description: 'Add a script instance to the chart', mutates: true },
  { id: 'indicators.remove', domain: 'indicators', description: 'Remove a script by id', mutates: true },
  { id: 'indicators.update', domain: 'indicators', description: 'Patch name/visibility/inputs', mutates: true },
  { id: 'indicators.run', domain: 'indicators', description: 'Re-run visible (or one) script', mutates: true },

  { id: 'alerts.list', domain: 'alerts', description: 'List persisted alerts', mutates: false },
  { id: 'alerts.create', domain: 'alerts', description: 'Create an alert', mutates: true },
  { id: 'alerts.update', domain: 'alerts', description: 'Upsert an alert by id', mutates: true },
  { id: 'alerts.remove', domain: 'alerts', description: 'Delete an alert by id', mutates: true },

  { id: 'watchlist.get', domain: 'watchlist', description: 'Active list + symbols', mutates: false },
  { id: 'watchlist.add', domain: 'watchlist', description: 'Add a symbol to the active list', mutates: true },
  { id: 'watchlist.remove', domain: 'watchlist', description: 'Remove a symbol', mutates: true },
  { id: 'watchlist.lists', domain: 'watchlist', description: 'Create/rename/select named lists', mutates: true },

  { id: 'library.list', domain: 'library', description: 'Script library metadata', mutates: false },
  { id: 'library.read', domain: 'library', description: 'Read a library script', mutates: false },
  { id: 'library.write', domain: 'library', description: 'Write a library script', mutates: true },
  { id: 'library.remove', domain: 'library', description: 'Delete a library script', mutates: true },

  { id: 'results.get', domain: 'results', description: 'Last run + strategy snapshot', mutates: false },
  { id: 'logs.get', domain: 'logs', description: 'System log strip', mutates: false },
  { id: 'logs.append', domain: 'logs', description: 'Append a system log line', mutates: true },
  { id: 'logs.clear', domain: 'logs', description: 'Clear system logs', mutates: true },

  { id: 'panels.get', domain: 'panels', description: 'Panel chrome (open/dock)', mutates: false },
  { id: 'panels.set', domain: 'panels', description: 'Open/close/dock a panel', mutates: true },

  { id: 'plugins.list', domain: 'plugins', description: 'Registry summary + active set', mutates: false },
  { id: 'plugins.activate', domain: 'plugins', description: 'Activate source/stream/engine/storage', mutates: true },

  { id: 'theme.get', domain: 'theme', description: 'UI + chart theme', mutates: false },
  { id: 'theme.set', domain: 'theme', description: 'Set UI theme or chart preset', mutates: true },

  { id: 'workspace.export', domain: 'workspace', description: 'Export workspace snapshot JSON', mutates: false },
  { id: 'workspace.import', domain: 'workspace', description: 'Apply a workspace snapshot', mutates: true },

  { id: 'drawings.list', domain: 'drawings', description: 'User drawings on the chart', mutates: false },
  { id: 'drawings.clear', domain: 'drawings', description: 'Clear drawings (current symbol)', mutates: true },
  { id: 'drawings.tool', domain: 'drawings', description: 'Select drawing tool', mutates: true },

  { id: 'status.get', domain: 'status', description: 'Status bar + telemetry HUD', mutates: false },
];

export function findCapability(id: string): CapabilitySpec | undefined {
  return APP_CAPABILITIES.find((c) => c.id === id);
}

export const SETTABLE_PATHS = new Set([
  'symbol',
  'interval',
  'source',
  'engine',
  'exchange',
  'theme',
  'chartType',
  'uiScale',
  'live.active',
  'live.preferAfterLoad',
  'editor.doc',
  'editor.open',
  'watchlist.open',
]);
