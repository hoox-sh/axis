// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { type Component, For, Show } from 'solid-js';
import type { CoverageSegment } from '../../data/bars-gaps';
import { fmtTime } from './format';

const DATA_FILL = 'color-mix(in srgb, var(--color-green, #5ecf8a) 75%, transparent)';
const GAP_FILL = 'color-mix(in srgb, var(--color-red, #e85d4c) 70%, transparent)';

/** Horizontal coverage strip: green = data, red = gap. */
export const CompleteMap: Component<{
  segments: CoverageSegment[];
  complete: boolean;
  barCount: number;
  expectedBars: number;
  gaps: number;
}> = (props) => {
  const summary = () =>
    props.complete
      ? 'Full coverage'
      : props.gaps > 0
        ? `${props.gaps} gap${props.gaps === 1 ? '' : 's'}`
        : 'Partial';

  return (
    <div class="flex flex-col gap-1" data-testid="axis-complete-map">
      <div class="flex items-center justify-between text-[0.72rem] text-muted gap-2">
        <span>Coverage</span>
        <span class="tabular-nums truncate">
          {summary()}
          {' · '}
          {props.barCount.toLocaleString()}
          {props.expectedBars > 0 ? ` / ~${props.expectedBars.toLocaleString()}` : ''} bars
        </span>
      </div>
      <div
        class="h-4 rounded overflow-hidden flex border border-border"
        role="img"
        aria-label={
          props.complete ? 'Complete coverage' : `Coverage map with ${props.gaps} gaps`
        }
      >
        <Show
          when={props.segments.length}
          fallback={<div class="flex-1 bg-[var(--border)]" title="No data" />}
        >
          <For each={props.segments}>
            {(seg) => (
              <div
                class="h-full min-w-[2px]"
                style={{
                  flex: `${Math.max(seg.weight, 0.005)} 0 0`,
                  background: seg.kind === 'data' ? DATA_FILL : GAP_FILL,
                }}
                title={`${seg.kind === 'data' ? 'Data' : 'Gap'}: ${fmtTime(seg.fromSec)} → ${fmtTime(seg.toSec)}`}
              />
            )}
          </For>
        </Show>
      </div>
      <div class="flex gap-3 text-[0.68rem] text-muted">
        <span class="inline-flex items-center gap-1">
          <span class="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: DATA_FILL }} />
          Data
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: GAP_FILL }} />
          Gap
        </span>
      </div>
    </div>
  );
};
