// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pro surfaces for the active engine: API usage (`GET /auth/usage`) and a chart
 * thumbnail (`POST /preview/chart`).
 *
 * Both routes only exist on a PYNE Pro host, so every action degrades to a
 * message instead of an error, and neither is rendered unless it can apply
 * (usage needs a key, the thumbnail needs an applied script + bars).
 *
 * @module ui/runtime/EngineProPanel
 */

import { Show, createMemo, createSignal } from 'solid-js';
import { store } from '../../store';
import { fetchUsage, renderChartPreview, runQuickBacktest, type PreviewResult, type QuickBacktestResult, type UsageResult } from '../../engines/pro';
import { Icons } from '../icons';
import { HooxLoader } from '../HooxLoader';
import { StudioButton, StudioCode, StudioField, StudioHint, StudioSection, StudioStat } from '../studio';

export function EngineProPanel(props: { engine: string }) {
  const [usage, setUsage] = createSignal<UsageResult | null>(null);
  const [usageBusy, setUsageBusy] = createSignal(false);
  const [preview, setPreview] = createSignal<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = createSignal(false);
  const [previewName, setPreviewName] = createSignal('');
  const [backtest, setBacktest] = createSignal<QuickBacktestResult | null>(null);
  const [backtestBusy, setBacktestBusy] = createSignal(false);

  const apiKey = createMemo(() => {
    const cfg = (store.pluginsConfig?.[`engine:${props.engine}`] ||
      store.pluginsConfig?.[props.engine] ||
      {}) as Record<string, unknown>;
    return String(cfg.apiKey || '').trim();
  });

  /** Newest applied script with source — the thing a user means by "this chart". */
  const activeScript = createMemo(() => {
    const scripts = (store.scripts || []).filter((s) => s?.visible && String(s.code || '').trim());
    return scripts.length ? scripts[scripts.length - 1]! : null;
  });

  const closes = createMemo(() =>
    (store.bars || []).map((b) => Number(b.close)).filter((c) => Number.isFinite(c)),
  );

  const loadUsage = async () => {
    setUsageBusy(true);
    try {
      setUsage(await fetchUsage());
    } finally {
      setUsageBusy(false);
    }
  };

  const makeThumbnail = async () => {
    const script = activeScript();
    if (!script) return;
    setPreviewBusy(true);
    setPreviewName(script.name || script.id);
    try {
      setPreview(
        await renderChartPreview(script.code, closes(), {
          type: 'line',
          color: '#6366f1',
          width: 600,
          height: 300,
        }),
      );
    } finally {
      setPreviewBusy(false);
    }
  };

  const makeBacktest = async () => {
    const script = activeScript();
    if (!script) return;
    setBacktestBusy(true);
    try {
      const bars = store.bars || [];
      setBacktest(
        await runQuickBacktest(
          script.code,
          {
            open: bars.map((b) => Number(b.open)),
            high: bars.map((b) => Number(b.high)),
            low: bars.map((b) => Number(b.low)),
            close: bars.map((b) => Number(b.close)),
            volume: bars.map((b) => Number(b.volume ?? 0)),
          },
          { initialCapital: 10_000 },
        ),
      );
    } finally {
      setBacktestBusy(false);
    }
  };

  return (
    <>
      <Show when={props.engine === 'server' && apiKey()}>
        <StudioSection
          title="API usage"
          lead="Tier and call budget for the configured key (PYNE GET /auth/usage)."
        >
          <div class="ax-inline">
            <StudioButton
              variant="ghost"
              testId="axis-engine-usage"
              disabled={usageBusy()}
              onClick={() => void loadUsage()}
            >
              {usageBusy() ? <HooxLoader size="xs" /> : <Icons.activity />}
              Check usage
            </StudioButton>
          </div>
          <Show when={usage()}>
            {(u) => (
              <Show
                when={u().ok}
                fallback={
                  <StudioCode>{u().error || 'Usage unavailable'}</StudioCode>
                }
              >
                <div class="ax-grid ax-grid--3">
                  <StudioStat label="Tier" value={u().tier || '—'} />
                  <StudioStat
                    label="Calls used"
                    value={
                      u().callsUsed != null
                        ? `${u().callsUsed}${u().callsLimit != null ? ` / ${u().callsLimit}` : ''}`
                        : '—'
                    }
                  />
                  <StudioStat
                    label="Remaining"
                    value={u().callsRemaining != null ? String(u().callsRemaining) : '—'}
                  />
                </div>
                <Show when={u().keyId}>
                  <StudioHint>key {u().keyId}</StudioHint>
                </Show>
              </Show>
            )}
          </Show>
        </StudioSection>
      </Show>

      <Show when={props.engine === 'server'}>
        <StudioSection
          title="Quick backtest"
          lead="Run the newest applied strategy over the current bars (PYNE POST /backtest/quick)."
        >
          <Show
            when={activeScript()}
            fallback={<StudioHint>Apply a script to the chart to backtest it here.</StudioHint>}
          >
            <div class="ax-inline">
              <StudioButton
                variant="ghost"
                testId="axis-engine-backtest"
                disabled={backtestBusy() || !closes().length}
                onClick={() => void makeBacktest()}
              >
                {backtestBusy() ? <HooxLoader size="xs" /> : <Icons.trend />}
                Run quick backtest
              </StudioButton>
            </div>
          </Show>
          <Show when={backtest()}>
            {(b) => (
              <Show
                when={b().ok}
                fallback={<StudioCode>{b().error || 'Backtest unavailable'}</StudioCode>}
              >
                <div class="ax-grid ax-grid--3">
                  <StudioStat
                    label="Total PnL"
                    value={
                      typeof b().summary.total_pnl === 'number'
                        ? String(Math.round(b().summary.total_pnl as number))
                        : '—'
                    }
                  />
                  <StudioStat
                    label="Sharpe"
                    value={
                      typeof b().summary.sharpe_ratio === 'number'
                        ? (b().summary.sharpe_ratio as number).toFixed(2)
                        : '—'
                    }
                  />
                  <StudioStat
                    label="Trades"
                    value={b().trades.length ? String(b().trades.length) : '—'}
                  />
                </div>
                <StudioHint>
                  {b().bars ?? '?'} bars · initial {b().initialCapital ?? '?'} ·{' '}
                  {b().equityCurve.length} equity points
                </StudioHint>
                <Show when={b().equityChart}>
                  <img
                    data-testid="axis-engine-backtest-chart"
                    alt="Equity curve"
                    style={{ 'max-width': '100%', 'border-radius': '6px', display: 'block' }}
                    src={`data:image/png;base64,${b().equityChart}`}
                  />
                </Show>
              </Show>
            )}
          </Show>
        </StudioSection>
      </Show>

      <Show when={props.engine === 'server'}>
        <StudioSection
          title="Chart thumbnail"
          lead="Render the newest applied script over the current bars (PYNE POST /preview/chart)."
        >
          <Show
            when={activeScript()}
            fallback={<StudioHint>Apply a script to the chart to preview it here.</StudioHint>}
          >
            {(script) => (
              <>
                <StudioField label="Script">
                  <StudioCode>{script().name || script().id}</StudioCode>
                </StudioField>
                <div class="ax-inline">
                  <StudioButton
                    variant="ghost"
                    testId="axis-engine-thumbnail"
                    disabled={previewBusy() || !closes().length}
                    onClick={() => void makeThumbnail()}
                  >
                    {previewBusy() ? <HooxLoader size="xs" /> : <Icons.screenshot />}
                    Render thumbnail
                  </StudioButton>
                  <Show when={preview()?.ok && preview()?.chart}>
                    <a
                      class="ax-btn ax-btn--ghost"
                      download={`${previewName() || 'axis-preview'}.png`}
                      href={`data:image/png;base64,${preview()!.chart}`}
                      data-testid="axis-engine-thumbnail-save"
                    >
                      <Icons.download />
                      Save PNG
                    </a>
                  </Show>
                </div>
                <Show when={preview()}>
                  {(p) => (
                    <Show
                      when={p().ok && p().chart}
                      fallback={<StudioCode>{p().error || 'Preview unavailable'}</StudioCode>}
                    >
                      <img
                        data-testid="axis-engine-thumbnail-img"
                        alt={`Preview of ${previewName()}`}
                        style={{ 'max-width': '100%', 'border-radius': '6px', display: 'block' }}
                        src={`data:image/png;base64,${p().chart}`}
                      />
                      <StudioHint>
                        {p().bars ?? '?'} bars
                        {p().lastValue != null ? ` · last ${p().lastValue}` : ''}
                      </StudioHint>
                    </Show>
                  )}
                </Show>
              </>
            )}
          </Show>
        </StudioSection>
      </Show>
    </>
  );
}
