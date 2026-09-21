// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { type Component, Show } from 'solid-js';
import {
  jobProgress,
  type DataSourceJob,
} from '../../data/data-source-manager';
import { Icons } from '../icons';
import { fmtTime } from './format';
import { jobStatusClass, jobStatusTone, statusLabel } from './jobs';

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

  const stats = () => {
    const j = props.job;
    const parts = [`${j.barsFetched.toLocaleString()} bars`, `${j.pagesFetched} page${j.pagesFetched === 1 ? '' : 's'}`];
    if ((j.retries ?? 0) > 0) parts.push(`${j.retries} ${j.retries === 1 ? 'retry' : 'retries'}`);
    if (j.gapsFound > 0) {
      parts.push(`${j.gapsFound} gap${j.gapsFound === 1 ? '' : 's'}${j.gapsFilled ? `, filled ${j.gapsFilled}` : ''}`);
    } else if (j.datasetComplete) {
      parts.push('coverage full');
    } else if (j.status === 'complete') {
      parts.push('coverage partial');
    }
    return parts.join(' · ');
  };

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
          class="h-full bg-[var(--accent,var(--indigo,#6366f1))] transition-[width] duration-200"
          style={{ width: `${pct()}%` }}
        />
      </div>

      <div class="text-[0.72rem] text-muted leading-snug">{stats()}</div>
      <div class="text-[0.72rem] text-muted tabular-nums">
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
