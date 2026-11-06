// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { type Component, Show } from 'solid-js';
import { jobProgress, type DataSourceJob } from '../../data/data-source-manager';
import { Icons } from '../icons';
import { fmtDuration, fmtTime } from './format';
import { jobHealthLine, jobQuantityLine, jobStatusTone, statusLabel } from './jobs';

/**
 * One backfill job row: progress, status chip, quantity/health lines, and the
 * pause/resume/cancel/apply/dismiss actions appropriate to its state. Notes stay
 * muted while the job is still running so the numbers read first.
 *
 * @param props - Job snapshot plus the action callbacks owned by the list.
 * @returns The job card markup.
 */
export const JobCard: Component<{
  job: DataSourceJob;
  applying: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onApply: () => void;
  onDismiss: () => void;
}> = (props): JSX.Element => {
  const pct = () => Math.round(jobProgress(props.job) * 100);
  const tone = () => jobStatusTone(props.job);
  const label = () => statusLabel(props.job);
  const running = () => props.job.status === 'running' || props.job.status === 'pending';
  const noteMuted = () => running();

  const quantity = () => jobQuantityLine(props.job);
  const health = () => jobHealthLine(props.job);
  const windowLabel = () => fmtDuration(props.job.targetFromSec, props.job.targetToSec);
  const name = () => `${props.job.symbol} ${props.job.interval}`;

  return (
    <article
      class="ax-dsm-job"
      classList={{
        'is-run': tone() === 'run',
        'is-ok': tone() === 'ok',
        'is-warn': tone() === 'warn',
        'is-bad': tone() === 'bad',
        'is-muted': tone() === 'muted',
      }}
      data-testid={`axis-datasource-job-${props.job.id}`}
      data-status={props.job.status}
      data-phase={props.job.phase}
      data-tone={tone()}
    >
      <div class="ax-dsm-job-head">
        <span class="ax-dsm-job-dot" aria-hidden="true" />
        <div class="ax-dsm-job-title">
          <span class="ax-dsm-job-symbol">{props.job.symbol}</span>
          <span class="ax-dsm-job-tf">{props.job.interval}</span>
        </div>
        <span class="ax-dsm-job-status">{label()}</span>
        <span class="ax-dsm-job-pct">{pct()}%</span>
      </div>
      <div class="ax-dsm-job-source" title={`Source: ${props.job.sourceId}`}>
        {props.job.sourceId}
      </div>

      <div
        class="ax-dsm-progress"
        role="progressbar"
        aria-label={`${props.job.symbol} ${props.job.interval} ${label()}`}
        aria-valuenow={pct()}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div class="ax-dsm-progress-fill" style={{ width: `${pct()}%` }} />
      </div>

      <div class="ax-dsm-job-meta">
        <span title="Fetched bars, window span, and venue pages">{quantity()}</span>
      </div>
      <Show when={health()}>
        <div class="ax-dsm-job-health">{health()}</div>
      </Show>
      <div
        class="ax-dsm-job-window"
        title={windowLabel() === '—' ? undefined : `Requested window ${windowLabel()}`}
      >
        {fmtTime(props.job.oldestSec ?? props.job.targetFromSec)}
        <span class="ax-dsm-arrow">→</span>
        {fmtTime(props.job.newestSec ?? props.job.targetToSec)}
      </div>

      <Show when={props.job.error}>
        <div class="ax-dsm-job-error" classList={{ 'is-muted': noteMuted() }}>
          {props.job.error}
        </div>
      </Show>

      <div class="ax-dsm-job-actions">
        <Show when={running()}>
          <button
            type="button"
            class="ax-dsm-mini"
            onClick={() => props.onPause()}
            aria-label={`Pause ${name()}`}
            data-testid={`axis-datasource-pause-${props.job.id}`}
          >
            Pause
          </button>
          <button
            type="button"
            class="ax-dsm-mini is-danger"
            onClick={() => props.onCancel()}
            aria-label={`Cancel ${name()}`}
            data-testid={`axis-datasource-cancel-${props.job.id}`}
          >
            Cancel
          </button>
        </Show>
        <Show when={props.job.status === 'paused'}>
          <button
            type="button"
            class="ax-dsm-mini"
            onClick={() => props.onResume()}
            aria-label={`Resume ${name()}`}
            data-testid={`axis-datasource-resume-${props.job.id}`}
          >
            <Icons.play size={10} /> Resume
          </button>
          <button
            type="button"
            class="ax-dsm-mini is-danger"
            onClick={() => props.onCancel()}
            aria-label={`Cancel ${name()}`}
            data-testid={`axis-datasource-cancel-${props.job.id}`}
          >
            Cancel
          </button>
        </Show>
        <Show when={props.job.status === 'complete' || props.job.barsFetched > 0}>
          <button
            type="button"
            class="ax-dsm-mini is-accent"
            disabled={props.applying}
            onClick={() => props.onApply()}
            data-testid={`axis-datasource-apply-${props.job.id}`}
            title="Load full cached series (use Dataset manager for date range / max bars)"
          >
            <Icons.download size={10} />
            <span>{props.applying ? 'Loading…' : 'Load to chart'}</span>
          </button>
        </Show>
        <span class="ax-dsm-spacer" />
        <Show
          when={
            props.job.status === 'complete' ||
            props.job.status === 'error' ||
            props.job.status === 'cancelled'
          }
        >
          <button
            type="button"
            class="ax-dsm-icon is-danger"
            onClick={() => props.onDismiss()}
            title="Remove from list"
            aria-label={`Dismiss ${name()} job`}
            data-testid={`axis-datasource-dismiss-${props.job.id}`}
          >
            <Icons.x size={11} />
          </button>
        </Show>
      </div>
    </article>
  );
};
