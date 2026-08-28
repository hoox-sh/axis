// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * High-detail cumulative-equity area chart for the Strategy report.
 *
 * Gradient fill, zero baseline, horizontal gridlines with money axis labels,
 * underwater (drawdown) shading between equity and running peak, trade-index
 * x-axis, and a hover crosshair + tooltip. Pure SVG (viewBox 820×280) so it
 * scales crisply inside the studio canvas.
 *
 * @module ui/EquityChart
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import type { EquityStep } from '../results/strategy';
import { formatMoney, formatPct } from '../results/strategy';

const W = 820;
const H = 280;
const PAD_L = 58;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 28;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

function fmtAxis(v: number): string {
  const sign = v < 0 ? '−' : v > 0 ? '+' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}${(a / 1_000).toFixed(1)}k`;
  if (a > 0 && a < 1) return `${sign}${a.toFixed(2)}`;
  return `${sign}${a.toFixed(0)}`;
}

export const EquityChart: Component<{ steps: EquityStep[] }> = (props) => {
  const [hover, setHover] = createSignal<number | null>(null);

  const model = createMemo(() => {
    const steps = props.steps;
    const eq = steps.map((s) => s.equity);
    const series = [0, ...eq];
    const n = series.length;
    let min = Math.min(0, ...series);
    let max = Math.max(0, ...series);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const x = (k: number) => PAD_L + (n <= 1 ? PLOT_W / 2 : (k / (n - 1)) * PLOT_W);
    const y = (v: number) => PAD_T + PLOT_H - ((v - min) / (max - min)) * PLOT_H;

    const linePts = series.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`);
    const linePath = `M ${linePts.join(' L ')}`;
    const areaPath =
      `M ${x(0).toFixed(1)},${y(series[0]!).toFixed(1)} ` +
      linePts.slice(1).map((p) => `L ${p}`).join(' ') +
      ` L ${x(n - 1).toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)}` +
      ` L ${x(0).toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)} Z`;

    // Underwater (drawdown) region: equity up to running peak
    const ddForward = steps.map((s, k) => `${x(k + 1).toFixed(1)},${y(s.equity).toFixed(1)}`);
    const ddBack = steps
      .map((s, k) => `${x(k + 1).toFixed(1)},${y(s.peak).toFixed(1)}`)
      .reverse();
    const ddPath =
      ddForward.length > 0
        ? `M ${ddForward[0]} ` +
          ddForward.slice(1).map((p) => `L ${p}`).join(' ') +
          ' ' +
          ddBack.map((p) => `L ${p}`).join(' ') +
          ' Z'
        : '';

    const zeroY = min <= 0 && max >= 0 ? y(0) : null;

    const yTicks = Array.from({ length: 5 }, (_, k) => min + ((max - min) * k) / 4);
    const xTickIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor((3 * (n - 1)) / 4), n - 1];

    const final = series[n - 1]!;
    const positive = final >= 0;

    return {
      n,
      x,
      y,
      linePath,
      areaPath,
      ddPath,
      zeroY,
      yTicks,
      xTickIdx,
      positive,
      final,
    };
  });

  const onMove = (e: MouseEvent & { currentTarget: SVGSVGElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const m = model();
    const k = m.n <= 1 ? 0 : Math.round(((vx - PAD_L) / PLOT_W) * (m.n - 1));
    setHover(Math.max(0, Math.min(m.n - 1, k)));
  };

  const hoverStep = () => {
    const h = hover();
    if (h == null) return null;
    const m = model();
    const idx = Math.max(0, h - 1); // series index 0 = origin; steps start at 1
    const step = props.steps[idx];
    return {
      x: m.x(h),
      y: m.y(m.n > 0 ? (h === 0 ? 0 : props.steps[h - 1]!.equity) : 0),
      tradeNo: step ? step.i : 0,
      equity: h === 0 ? 0 : step?.equity ?? 0,
      drawdownPct: step ? step.drawdownPct : 0,
    };
  };

  return (
    <div class="ax-equity">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        class="ax-equity-svg"
        preserveAspectRatio="none"
        role="img"
        aria-label="Cumulative PnL equity curve"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="ax-equity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--color-accent-2)" stop-opacity="0.34" />
            <stop offset="100%" stop-color="var(--color-accent-2)" stop-opacity="0.02" />
          </linearGradient>
          <linearGradient id="ax-equity-fill-neg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--color-red)" stop-opacity="0.30" />
            <stop offset="100%" stop-color="var(--color-red)" stop-opacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines + y labels */}
        <For each={model().yTicks}>
          {(v) => {
            const yy = model().y(v);
            return (
              <g>
                <line
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={yy}
                  y2={yy}
                  class="ax-equity-grid"
                />
                <text x={PAD_L - 8} y={yy + 3} class="ax-equity-axis" text-anchor="end">
                  {fmtAxis(v)}
                </text>
              </g>
            );
          }}
        </For>

        {/* Zero baseline */}
        <Show when={model().zeroY != null}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={model().zeroY!}
            y2={model().zeroY!}
            class="ax-equity-zero"
          />
        </Show>

        {/* Drawdown (underwater) shading */}
        <Show when={model().ddPath}>
          <path d={model().ddPath} class="ax-equity-dd" />
        </Show>

        {/* Area + line */}
        <path
          d={model().areaPath}
          fill={model().positive ? 'url(#ax-equity-fill)' : 'url(#ax-equity-fill-neg)'}
        />
        <path
          d={model().linePath}
          fill="none"
          class={model().positive ? 'ax-equity-line-pos' : 'ax-equity-line-neg'}
        />

        {/* X axis labels */}
        <For each={model().xTickIdx}>
          {(k) => {
            const m = model();
            const label = k === 0 ? '0' : (props.steps[k - 1]?.i ?? k).toString();
            return (
              <text x={m.x(k)} y={H - 8} class="ax-equity-axis" text-anchor="middle">
                {label}
              </text>
            );
          }}
        </For>

        {/* Hover crosshair */}
        <Show when={hoverStep()}>
          {(h) => (
            <g>
              <line x1={h().x} x2={h().x} y1={PAD_T} y2={PAD_T + PLOT_H} class="ax-equity-cross" />
              <circle cx={h().x} cy={h().y} r="4" class="ax-equity-dot" />
            </g>
          )}
        </Show>
      </svg>

      {/* Hover tooltip */}
      <Show when={hoverStep()}>
        {(h) => (
          <div
            class="ax-equity-tip"
            style={{
              left: `${(h().x / W) * 100}%`,
              top: `${(h().y / H) * 100}%`,
            }}
          >
            <div class="ax-equity-tip-row">
              <span>Trade</span>
              <span class="ax-equity-tip-val">#{h().tradeNo}</span>
            </div>
            <div class="ax-equity-tip-row">
              <span>Equity</span>
              <span class="ax-equity-tip-val">{formatMoney(h().equity)}</span>
            </div>
            <div class="ax-equity-tip-row">
              <span>Drawdown</span>
              <span class="ax-equity-tip-val ax-equity-tip-dd">{formatPct(h().drawdownPct)}</span>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};
