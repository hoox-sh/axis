/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * One empty/error pattern for the chart pane: title, one sentence, one action.
 * No stack traces. Callers render the action; this module only classifies.
 *
 * @module ui/data-plane-notice
 */

export type DataPlaneActionId = 'retry' | 'open-data' | 'use-mock' | 'docs';

export interface DataPlaneNotice {
  title: string;
  sentence: string;
  action: DataPlaneActionId;
  actionLabel: string;
}

/** Published guide for venue / DSM failures. */
export const DATA_PLANE_DOCS_URL =
  'https://docs.hoox.sh/axis/docs/enduser/guides/data-source-manager';

/** First sentence of a status message, without a stack frame. */
export function cleanStatusLine(message: string): string {
  const flat = String(message || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  const cut = flat.split(/\s+at\s+/)[0] || flat;
  return cut.replace(/^(load failed:\s*)/i, '').slice(0, 160);
}

export function classifyDataPlaneNotice(opts: {
  status?: string;
  message?: string;
  symbol?: string;
  interval?: string;
}): DataPlaneNotice {
  const msg = String(opts.message || '');
  const low = msg.toLowerCase();
  const sym = (opts.symbol || '').trim();
  const iv = (opts.interval || '').trim();
  const where = sym ? `${sym}${iv ? ` ${iv}` : ''}` : '';

  if (/on-?chain/.test(low) && /returned a page|not valid json|<!doctype|<html|unexpected token/.test(low)) {
    return {
      title: 'On-chain feed returned a page',
      sentence: 'The proxy sent HTML instead of JSON.',
      action: 'docs',
      actionLabel: 'Docs',
    };
  }
  if (/<!doctype|<html|unexpected token|not valid json|returned a page/.test(low)) {
    return {
      title: 'Venue returned a page',
      sentence: 'The response was HTML, not market data.',
      action: 'open-data',
      actionLabel: 'Open Data',
    };
  }
  if (/pyodide|cold start|\bwasm\b/.test(low)) {
    return {
      title: 'Engine warming up',
      sentence: 'Pyodide is loading in this tab. The first open takes a moment.',
      action: 'docs',
      actionLabel: 'Docs',
    };
  }
  if (/\b(pyne-worker|worker unreachable)\b/.test(low)) {
    return {
      title: 'Worker unreachable',
      sentence: 'The calculation worker did not answer.',
      action: 'retry',
      actionLabel: 'Retry',
    };
  }
  if (/csv/.test(low) && /parse|invalid|header|column|malformed/.test(low)) {
    return {
      title: 'CSV did not parse',
      sentence: 'The file is not OHLCV this chart can read.',
      action: 'open-data',
      actionLabel: 'Open Data',
    };
  }
  if (/cors|failed to fetch|networkerror|network error/.test(low)) {
    return {
      title: 'Venue unreachable',
      sentence: 'The browser could not read that host.',
      action: 'use-mock',
      actionLabel: 'Use mock',
    };
  }
  if (/invalid symbol|unknown symbol|symbol required/.test(low)) {
    return {
      title: 'Unknown symbol',
      sentence: where ? `${where} is not on this venue.` : 'That symbol is not on this venue.',
      action: 'open-data',
      actionLabel: 'Open Data',
    };
  }
  if (opts.status === 'error' || /unknown source|load failed|venue down|unavailable/.test(low)) {
    const sentence = cleanStatusLine(msg);
    return {
      title: 'Could not load bars',
      sentence: sentence || 'The venue did not return candles.',
      action: 'retry',
      actionLabel: 'Retry',
    };
  }
  return {
    title: 'No bars',
    sentence: where ? `Load ${where} to paint the chart.` : 'Load a symbol to paint the chart.',
    action: 'retry',
    actionLabel: 'Load',
  };
}
