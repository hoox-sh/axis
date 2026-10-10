// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { type Component, Show } from 'solid-js';
import {
  jobProgress,
  type DataSourceJob,
} from '../../data/data-source-manager';
import { Icons } from '../icons';
import { fmtDuration, fmtTime } from './format';
import { jobHealthLine, jobQuantityLine, jobStatusClass, jobStatusTone, statusLabel } from './jobs';

export const JobCard: Component<{
  job: DataSourceJob;
  applying: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onApply: () => void;
  onDismiss: () => void;
}> = (props) => {
  const pct = () => Math.round(jobProgress(props.job) * 100);
  const tone = () => jobStatusTone(props.job);
  const label = () => statusLabel(props.job);
  const running = () => props.job.status === 'running' || props.job.status === 'pending';
  const noteMuted = () => running();

  const quantity = () => jobQuantityLine(props.job);
  const health = () => jobHealthLine(props.job);
  const windowLabel = () => fmtDuration(props.job.targetFromSec, props.job.targetToSec);

  return (
    <article
      class="border border-border rounded-md p-2 flex flex-col gap-1.5"
      data-testid={`axis-datasource-job-${props.job.id}`}
      data-status={props.job.status}
      data-phase={props.job.phase}
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="font-medium truncate">
            {props.job.symbol} · {props.job.interval}
          </div>
          <div class="text-muted text-[0.72rem] truncate">{props.job.sourceId}</div>
        </div>
        <div class="text-right shrink-0">
          <div class={`text-[0.72rem] font-medium ${jobStatusClass(tone())}`}>{label()}</div>
          <div class="text-[0.72rem] text-muted tabular-nums">{pct()}%</div>
        </div>
      </div>

      <div
        class="h-1.5 rounded bg-[var(--border)] overflow-hidden"
        role="progressbar"
        aria-label={`${props.job.symbol} ${props.job.interval} ${label()}`}
        aria-valuenow={pct()}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          class="h-full bg-[var(--color-accent)] transition-[width] duration-200"
          style={{ width: `${pct()}%` }}
        />
      </div>

      <div class="text-[0.72rem] text-muted leading-snug tabular-nums">{quantity()}</div>
      <Show when={health()}>
        <div class="text-[0.72rem] text-muted leading-snug">{health()}</div>
      </Show>
      <div
        class="text-[0.72rem] text-muted tabular-nums"
        title={windowLabel() === '—' ? undefined : `Requested window ${windowLabel()}`}
      >
        {fmtTime(props.job.oldestSec ?? props.job.targetFromSec)}
        {' → '}
        {fmtTime(props.job.newestSec ?? props.job.targetToSec)}
      </div>

      <Show when={props.job.error}>
        <div class={`${noteMuted() ? 'text-muted' : 'text-red'} text-[0.72rem] leading-snug`}>
          {props.job.error}
        </div>
      </Show>

      <div class="flex flex-wrap gap-1 mt-0.5">
        <Show when={running()}>
          <button
            type="button"
            class="sc-btn sc-btn-ghost sc-btn-sm"
            onClick={() => props.onPause()}
            aria-label={`Pause ${props.job.symbol} ${props.job.interval}`}
          >
            Pause
          </button>
          <button
            type="button"
            class="sc-btn sc-btn-ghost sc-btn-sm"
            onClick={() => props.onCancel()}
            aria-label={`Cancel ${props.job.symbol} ${props.job.interval}`}
          >
            Cancel
          </button>
        </Show>
        <Show when={props.job.status === 'paused'}>
          <button
            type="button"
            class="sc-btn sc-btn-ghost sc-btn-sm"
            onClick={() => props.onResume()}
            aria-label={`Resume ${props.job.symbol} ${props.job.interval}`}
          >
            Resume
          </button>
          <button
            type="button"
            class="sc-btn sc-btn-ghost sc-btn-sm"
            onClick={() => props.onCancel()}
            aria-label={`Cancel ${props.job.symbol} ${props.job.interval}`}
          >
            Cancel
          </button>
        </Show>
        <Show when={props.job.status === 'complete' || props.job.barsFetched > 0}>
          <button
            type="button"
            class="sc-btn sc-btn-ghost sc-btn-sm"
            disabled={props.applying}
            onClick={() => props.onApply()}
            data-testid={`axis-datasource-apply-${props.job.id}`}
            title="Load full cached series (use Dataset manager for date range / max bars)"
          >
            <Icons.download />
            <span>{props.applying ? 'Loading…' : 'Load to chart'}</span>
          </button>
        </Show>
        <Show
          when={
            props.job.status === 'complete' ||
            props.job.status === 'error' ||
            props.job.status === 'cancelled'
          }
        >
          <button
            type="button"
            class="sc-btn sc-btn-ghost sc-btn-sm"
            onClick={() => props.onDismiss()}
            title="Remove from list"
            aria-label={`Dismiss ${props.job.symbol} ${props.job.interval} job`}
          >
            <Icons.x />
          </button>
        </Show>
      </div>
    </article>
  );
};
