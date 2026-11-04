// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Studio **Debug** page — the runtime switch for chart/engine debug logging,
 * log-ring controls, and a formatted live view of the rotating
 * `axis.debug.log.*` ring.
 *
 * Same flag as Settings → General → Debug logs (`localStorage.axis.debug`).
 * A `VITE_AXIS_DEBUG` build forces it on; the toggle then shows that state
 * instead of pretending it can turn logging off.
 *
 * @module ui/debug/DebugPage
 */

import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  axisDebugLogStats,
  axisDebugSource,
  clearAxisDebugLog,
  downloadAxisDebugLog,
  isAxisDebug,
  onAxisDebugChange,
  readAxisDebugLog,
  setAxisDebug,
  type AxisDebugSource,
} from '../../debug';
import { copyToClipboard } from '../clipboard';
import { Icons } from '../icons';
import {
  AppButton,
  StudioChip,
  StudioHint,
  StudioInput,
  StudioSection,
  StudioStat,
  StudioStatus,
  StudioToggle,
} from '../studio';

/** Live-view refresh cadence while the page is open and not paused. */
const REFRESH_MS = 1000;

/** Cap rendered rows so a long ring cannot stall the DOM. */
const MAX_ROWS = 500;

type ScopeFilter = 'all' | 'chart' | 'engine';

type DebugRow = {
  id: number;
  /** `HH:mm:ss.SSS` (empty for unparsed lines). */
  time: string;
  scope: string;
  event: string;
  data: string;
  raw: string;
};

const LINE_RE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s+\[([^\]]+)\]\s+(\S+)(?:\s+(.*))?$/;

function shortValue(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === 'string') {
    return value.length > 60 ? `"${value.slice(0, 60)}…"` : JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  } catch {
    return '…';
  }
}

/** `{"n":10,"fit":true}` → `n=10  fit=true`; non-JSON passes through. */
function formatData(raw: string): string {
  if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => `${key}=${shortValue(value)}`)
        .join('  ');
    }
  } catch {
    /* not JSON — show the raw tail */
  }
  return raw;
}

function parseRows(text: string): DebugRow[] {
  const rows: DebugRow[] = [];
  let id = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const match = LINE_RE.exec(line);
    if (!match) {
      rows.push({ id: id++, time: '', scope: 'raw', event: '', data: line, raw: line });
      continue;
    }
    const [, iso, scope, event, data] = match;
    rows.push({
      id: id++,
      time: iso.slice(11, 23),
      scope,
      event,
      data: formatData(data ?? ''),
      raw: line,
    });
  }
  return rows;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function sourceLabel(source: AxisDebugSource): string {
  switch (source) {
    case 'env':
      return 'Forced by .env';
    case 'storage':
      return 'On · this browser';
    default:
      return 'Off';
  }
}

export function DebugPage(_props: { onClose?: () => void }) {
  const [paused, setPaused] = createSignal(false);
  const [follow, setFollow] = createSignal(true);
  const [scope, setScope] = createSignal<ScopeFilter>('all');
  const [query, setQuery] = createSignal('');
  const [debugOn, setDebugOn] = createSignal(isAxisDebug());
  const [source, setSource] = createSignal<AxisDebugSource>(axisDebugSource());
  const [logText, setLogText] = createSignal(readAxisDebugLog());
  const [stats, setStats] = createSignal(axisDebugLogStats());
  const [copied, setCopied] = createSignal(false);
  let listRef: HTMLDivElement | undefined;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  /** Re-read the ring. `setLogText` is a no-op when the text is unchanged. */
  const refresh = () => {
    setLogText(readAxisDebugLog());
    const next = axisDebugLogStats();
    setStats((prev) =>
      prev.files === next.files && prev.lines === next.lines && prev.bytes === next.bytes
        ? prev
        : next,
    );
  };

  // Poll the ring while the page is open. Pause freezes the view without
  // stopping the writer (chart/engine keep appending).
  createEffect(() => {
    if (paused()) return;
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    onCleanup(() => clearInterval(id));
  });

  const unsub = onAxisDebugChange((on, next) => {
    setDebugOn(on);
    setSource(next);
    refresh();
  });
  onCleanup(() => {
    unsub();
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  const allRows = createMemo(() => parseRows(logText()));

  const filteredRows = createMemo(() => {
    const wanted = scope();
    const needle = query().trim().toLowerCase();
    return allRows().filter(
      (row) =>
        (wanted === 'all' || row.scope === wanted) &&
        (!needle || row.raw.toLowerCase().includes(needle)),
    );
  });

  const shownRows = createMemo(() => {
    const rows = filteredRows();
    return rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : rows;
  });

  const lastTime = createMemo(() => {
    const rows = allRows();
    return rows.length ? rows[rows.length - 1].time : '—';
  });

  // Follow the tail unless the user is reading history.
  createEffect(() => {
    const count = shownRows().length;
    if (!follow() || !listRef) return;
    void count;
    listRef.scrollTop = listRef.scrollHeight;
  });

  const flashCopied = () => {
    setCopied(true);
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopied(false), 1200);
  };

  const onCopy = async () => {
    const text = filteredRows()
      .map((row) => row.raw)
      .join('\n');
    if (await copyToClipboard(text)) flashCopied();
  };

  const onDownload = () => {
    downloadAxisDebugLog();
    refresh();
  };

  const onClear = () => {
    clearAxisDebugLog();
    refresh();
  };

  const envForced = () => source() === 'env';

  return (
    <div class="ax-page-stack">
      <div class="ax-page-canvas">
        <div class="ax-split">
          <div class="ax-split-col">
            <StudioSection
              title="Debug logging"
              lead="Verbose [axis:chart] / [axis:engine] console lines plus a rotating localStorage ring. Applies immediately — no rebuild or .env edit."
              testId="axis-debug-controls"
              headerEnd={
                <StudioStatus
                  status={debugOn() ? 'healthy' : 'idle'}
                  label={sourceLabel(source())}
                />
              }
            >
              <StudioToggle
                id="axis-debug-page-toggle"
                testId="axis-debug-toggle"
                checked={debugOn()}
                disabled={envForced()}
                onChange={(v) => setAxisDebug(v)}
                label="Enable debug logs"
                hint={
                  envForced()
                    ? 'VITE_AXIS_DEBUG is set in .env — remove it (and rebuild) to control this toggle here.'
                    : 'Off by default. Filter DevTools by [axis: and download the ring as a .log file.'
                }
              />
              <div class="ax-toolbar">
                <AppButton
                  design="soft"
                  tone="ghost"
                  size="sm"
                  testId="axis-debug-download"
                  disabled={stats().lines === 0}
                  icon={<Icons.download />}
                  title="Download the rotating debug log"
                  onClick={onDownload}
                >
                  Download
                </AppButton>
                <AppButton
                  design="soft"
                  tone="ghost"
                  size="sm"
                  testId="axis-debug-copy"
                  disabled={filteredRows().length === 0}
                  icon={copied() ? <Icons.check /> : <Icons.copy />}
                  title="Copy the visible lines"
                  onClick={() => void onCopy()}
                >
                  {copied() ? 'Copied' : 'Copy'}
                </AppButton>
                <AppButton
                  design="soft"
                  tone="danger"
                  size="sm"
                  testId="axis-debug-clear"
                  disabled={stats().lines === 0}
                  icon={<Icons.trash />}
                  title="Delete every rotated debug log file"
                  onClick={onClear}
                >
                  Clear
                </AppButton>
              </div>
              <StudioHint>
                Also in DevTools: <code>window.__AXIS_DEBUG__.set(true)</code> /{' '}
                <code>.download()</code> / <code>.stats()</code>.
              </StudioHint>
            </StudioSection>
          </div>

          <div class="ax-split-col">
            <StudioSection
              title="Log ring"
              lead="Four rotated files in localStorage (64 KiB each). The oldest is dropped when the current file fills."
              testId="axis-debug-ring"
            >
              <div class="ax-grid ax-grid--3">
                <StudioStat label="Files" value={stats().files} testId="axis-debug-stat-files" />
                <StudioStat label="Lines" value={stats().lines} testId="axis-debug-stat-lines" />
                <StudioStat
                  label="Size"
                  value={formatBytes(stats().bytes)}
                  testId="axis-debug-stat-bytes"
                />
              </div>
              <StudioHint>
                Last event {lastTime()} · newest file <code>axis.debug.log.0</code> ·{' '}
                {paused() ? 'view paused' : `refreshing every ${REFRESH_MS / 1000}s`}
              </StudioHint>
            </StudioSection>
          </div>
        </div>

        <StudioSection
          title="Live log"
          lead="Chart actions and engine/live-wire events, newest last."
          testId="axis-debug-live"
          headerEnd={
            <>
              <span class="ax-chip ax-chip--tag" data-testid="axis-debug-live-count">
                {shownRows().length}
                {filteredRows().length !== allRows().length ? `/${allRows().length}` : ''}
              </span>
              <StudioChip
                pressed={paused()}
                onClick={() => setPaused((p) => !p)}
                testId="axis-debug-pause"
                title={paused() ? 'Resume live refresh' : 'Pause live refresh'}
              >
                {paused() ? 'Resume' : 'Pause'}
              </StudioChip>
              <StudioChip
                pressed={follow()}
                onClick={() => setFollow((f) => !f)}
                testId="axis-debug-follow"
                title="Scroll to the newest line automatically"
              >
                Follow
              </StudioChip>
            </>
          }
        >
          <div class="ax-toolbar ax-debug-filters">
            <div class="ax-chip-row">
              <StudioChip
                pressed={scope() === 'all'}
                onClick={() => setScope('all')}
                testId="axis-debug-scope-all"
              >
                All
              </StudioChip>
              <StudioChip
                pressed={scope() === 'chart'}
                onClick={() => setScope('chart')}
                testId="axis-debug-scope-chart"
              >
                Chart
              </StudioChip>
              <StudioChip
                pressed={scope() === 'engine'}
                onClick={() => setScope('engine')}
                testId="axis-debug-scope-engine"
              >
                Engine
              </StudioChip>
            </div>
            <StudioInput
              icon={<Icons.search />}
              placeholder="Filter events, scopes, or values…"
              value={query()}
              onInput={setQuery}
              clearable
              mono
              class="ax-debug-search"
              ariaLabel="Filter debug log lines"
              testId="axis-debug-search"
            />
          </div>

          <div class="ax-debug-live">
            <div class="ax-debug-live-head">
              <span class="ax-debug-live-title">
                <Icons.systemLogs size={13} /> axis.debug.log
              </span>
              <span class="ax-debug-live-note">
                {debugOn() ? 'logging on' : 'logging off'} · {stats().files} file
                {stats().files === 1 ? '' : 's'} · {formatBytes(stats().bytes)}
              </span>
            </div>
            <div
              ref={listRef}
              class="ax-debug-live-list"
              role="log"
              aria-live="off"
              aria-label="Debug log lines"
              data-testid="axis-debug-live-list"
            >
              <Show
                when={shownRows().length > 0}
                fallback={
                  <div class="ax-debug-empty" data-testid="axis-debug-empty">
                    <Show
                      when={debugOn()}
                      fallback={
                        <>
                          Logging is off. Turn on <strong>Enable debug logs</strong> above, then
                          interact with the chart or run a script.
                        </>
                      }
                    >
                      Waiting for chart or engine events… pan the chart, reload a symbol, or start
                      the live stream.
                    </Show>
                  </div>
                }
              >
                <For each={shownRows()}>
                  {(row) => (
                    <div class="ax-debug-row" data-scope={row.scope}>
                      <span class="ax-debug-time">{row.time || '—'}</span>
                      <span class={`ax-debug-scope ax-debug-scope--${row.scope}`}>{row.scope}</span>
                      <span class="ax-debug-event" title={row.event}>
                        {row.event || '—'}
                      </span>
                      <span class="ax-debug-data" title={row.raw}>
                        {row.data}
                      </span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
          <Show when={filteredRows().length > MAX_ROWS}>
            <StudioHint>
              Showing the newest {MAX_ROWS} of {filteredRows().length} matching lines. Download the
              ring for the full history.
            </StudioHint>
          </Show>
        </StudioSection>
      </div>
    </div>
  );
}
