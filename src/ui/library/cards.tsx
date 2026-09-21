// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Script Library rows: personal scripts (with version history) and built-ins.
 *
 * @module ui/library/cards
 */

import { type Component, For, Show, createSignal, type JSX } from 'solid-js';
import type { ScriptMeta, ScriptVersion } from '../../plugins/types';
import {
  listScriptVersions,
  readScriptVersion,
  restoreScriptVersion,
} from '../../storage/service';
import {
  formatScriptUpdatedAt,
  scriptKindLabel,
  scriptKindShort,
  type ScriptKind,
} from '../../indicators/script-meta';
import {
  builtinCategoryLabel,
  type BuiltinScript,
} from '../../indicators/builtins';
import { appendLog, setStatus } from '../../store';
import { Icons } from '../icons';
import { HooxLoader } from '../HooxLoader';
import { announce } from '../sr-announce';
import { kindChipClass, scriptKindOf, shortRev } from './format';

function MetaChip(props: {
  class?: string;
  title?: string;
  testId?: string;
  children: JSX.Element;
}) {
  return (
    <span
      class={`inline-flex items-center px-1 py-px border font-mono text-[9px] tracking-wide rounded-[var(--radius-chip)] ${props.class || ''}`}
      title={props.title}
      data-testid={props.testId}
    >
      {props.children}
    </span>
  );
}

/** One library row — name, kind, Pine version, last updated, optional version history. */
export const LibraryScriptCard: Component<{
  item: ScriptMeta;
  busy?: boolean;
  /** Active storage implements listVersions / readAtRevision. */
  versioning?: boolean;
  onLoad: () => void;
  onDelete: () => void;
  /** Load a historical revision into the editor (does not write remote). */
  onLoadVersion?: (doc: { content: string; name: string; libraryId: string }) => void;
  /** After restore (new tip commit) — refresh list / optional editor reload. */
  onRestored?: (meta: ScriptMeta) => void;
}> = (props) => {
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [historyBusy, setHistoryBusy] = createSignal(false);
  const [historyErr, setHistoryErr] = createSignal('');
  const [versions, setVersions] = createSignal<ScriptVersion[]>([]);
  const [actionSha, setActionSha] = createSignal('');

  const kind = (): ScriptKind => scriptKindOf(props.item);
  const updatedAbs = () =>
    props.item.updatedAt ? new Date(props.item.updatedAt).toLocaleString() : '';
  const updatedRel = () => formatScriptUpdatedAt(props.item.updatedAt);
  const versionLabel = () =>
    props.item.pineVersion ? `v${props.item.pineVersion}` : '';
  const revLabel = () => shortRev(props.item.revision);

  const loadHistory = async () => {
    if (!props.versioning) return;
    setHistoryBusy(true);
    setHistoryErr('');
    try {
      const list = await listScriptVersions(props.item.id, { limit: 40 });
      setVersions(list);
    } catch (e: unknown) {
      setHistoryErr(e instanceof Error ? e.message : String(e));
      setVersions([]);
    } finally {
      setHistoryBusy(false);
    }
  };

  const toggleHistory = () => {
    const next = !historyOpen();
    setHistoryOpen(next);
    if (next && versions().length === 0 && !historyErr()) {
      void loadHistory();
    }
  };

  const onLoadAt = async (v: ScriptVersion) => {
    if (!props.onLoadVersion) return;
    setActionSha(v.sha);
    setHistoryErr('');
    try {
      const doc = await readScriptVersion(props.item.id, v.sha);
      props.onLoadVersion({
        content: doc.content,
        name: doc.name,
        libraryId: doc.id,
      });
      setStatus('ready', `Loaded ${doc.name} @ ${v.shortSha} (not pushed)`);
      announce(`Loaded ${doc.name} at ${v.shortSha} into the editor`);
      appendLog(
        'info',
        `Loaded "${doc.name}" at ${v.shortSha} into editor`,
        'library',
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setHistoryErr(msg);
      setStatus('error', msg);
    } finally {
      setActionSha('');
    }
  };

  const onRestore = async (v: ScriptVersion) => {
    if (
      !window.confirm(
        `Restore "${props.item.name}" to commit ${v.shortSha}?\n\n` +
          `This creates a new commit on the current branch with that content.`,
      )
    ) {
      return;
    }
    setActionSha(v.sha);
    setHistoryErr('');
    try {
      const meta = await restoreScriptVersion(props.item.id, v.sha);
      setStatus('ready', `Restored ${meta.name} from ${v.shortSha}`);
      announce(`Restored ${meta.name} from ${v.shortSha}`);
      props.onRestored?.(meta);
      await loadHistory();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setHistoryErr(msg);
      setStatus('error', msg);
    } finally {
      setActionSha('');
    }
  };

  return (
    <li
      class="flex flex-col gap-1 border border-border-soft bg-bg-elev px-2 min-h-8 py-1.5 rounded text-left"
      data-testid="axis-library-script-card"
      data-script-kind={kind()}
      data-pine-version={props.item.pineVersion || undefined}
    >
      <div class="flex items-start gap-2">
        <div class="flex-1 min-w-0">
          <div class="text-text font-medium truncate text-[12px]" title={props.item.name}>
            {props.item.name}
          </div>
          <div
            class="flex flex-wrap items-center gap-1 mt-1"
            data-testid="axis-library-script-meta"
          >
            <MetaChip
              class={`uppercase ${kindChipClass(kind())}`}
              title={
                kind() === 'strategy'
                  ? 'Pine strategy()'
                  : kind() === 'library'
                    ? 'Pine library()'
                    : kind() === 'indicator'
                      ? 'Pine indicator()'
                      : 'Script kind not detected'
              }
              testId="axis-library-kind"
            >
              {scriptKindShort(kind())}
              <span class="sr-only"> {scriptKindLabel(kind())}</span>
            </MetaChip>
            <Show when={versionLabel()}>
              <MetaChip
                class="border-border/50 text-text-dim"
                title={`Pine //@version=${props.item.pineVersion}`}
                testId="axis-library-version"
              >
                {versionLabel()}
              </MetaChip>
            </Show>
            <Show when={revLabel()}>
              <MetaChip
                class="border-border/40 text-text-faint"
                title={`Revision ${props.item.revision}`}
                testId="axis-library-git-rev"
              >
                {revLabel()}
              </MetaChip>
            </Show>
            <Show when={updatedRel()}>
              <span
                class="font-mono text-[9px] text-text-faint truncate"
                title={updatedAbs() ? `Last updated ${updatedAbs()}` : 'Last updated'}
                data-testid="axis-library-updated"
              >
                · {updatedRel()}
              </span>
            </Show>
          </div>
          <Show when={props.item.description || props.item.path}>
            <div
              class="text-text-faint font-mono text-[9px] truncate mt-0.5"
              title={props.item.description || props.item.path || props.item.id}
            >
              {props.item.description || props.item.path}
            </div>
          </Show>
        </div>
        <Show when={props.versioning}>
          <button
            type="button"
            class={`sc-btn sc-btn-ghost sc-btn-icon px-1.5 flex-shrink-0 ${historyOpen() ? 'is-active' : ''}`}
            title="Version history"
            aria-pressed={historyOpen()}
            aria-expanded={historyOpen()}
            aria-label={`Version history for ${props.item.name}`}
            disabled={props.busy}
            onClick={toggleHistory}
            data-testid="axis-library-history"
          >
            <Icons.clock size={13} />
          </button>
        </Show>
        <button
          type="button"
          class="sc-btn sc-btn-ghost px-1.5 text-[10px] flex-shrink-0"
          title="Load into editor"
          aria-label={`Load ${props.item.name} into editor`}
          disabled={props.busy}
          onClick={() => props.onLoad()}
          data-testid="axis-library-load"
        >
          Load
        </button>
        <button
          type="button"
          class="sc-btn sc-btn-ghost px-1.5 flex-shrink-0"
          title="Delete"
          aria-label={`Delete ${props.item.name}`}
          disabled={props.busy}
          onClick={() => props.onDelete()}
          data-testid="axis-library-delete"
        >
          <Icons.x size={13} />
        </button>
      </div>

      <Show when={historyOpen() && props.versioning}>
        <div
          class="mt-1 border-t border-border/50 pt-1.5 space-y-1"
          data-testid="axis-library-history-panel"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-[9px] uppercase tracking-wider text-text-dim">
              Version history
            </span>
            <button
              type="button"
              class="sc-btn sc-btn-ghost text-[9px] px-1 py-0.5 inline-flex items-center gap-1"
              disabled={historyBusy()}
              onClick={() => void loadHistory()}
              title="Refresh version list"
              aria-label={`Refresh version history for ${props.item.name}`}
            >
              {historyBusy() ? <HooxLoader size="xs" /> : <Icons.refresh size={11} />}
              Refresh
            </button>
          </div>
          <Show when={historyErr()}>
            <p class="text-red font-mono text-[9px] m-0" role="alert">
              {historyErr()}
            </p>
          </Show>
          <Show when={!historyBusy() && versions().length === 0 && !historyErr()}>
            <p class="text-text-faint text-[9px] m-0">No versions found for this script.</p>
          </Show>
          <Show when={historyBusy() && versions().length === 0}>
            <div class="flex items-center gap-1.5 text-text-faint text-[9px] py-1">
              <HooxLoader size="xs" /> Loading versions…
            </div>
          </Show>
          <ul class="flex flex-col gap-0.5 m-0 p-0 list-none">
            <For each={versions()}>
              {(v) => (
                <li
                  class="flex items-start gap-1.5 px-1 py-1 rounded-[var(--radius-chip)] hover:bg-bg/60"
                  data-testid="axis-library-history-row"
                  data-sha={v.sha}
                >
                  <div class="flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-1 font-mono text-[9px]">
                      <span class="text-accent" title={v.sha}>
                        {v.shortSha}
                      </span>
                      <span class="text-text-faint" title={new Date(v.committedAt).toLocaleString()}>
                        {formatScriptUpdatedAt(v.committedAt)}
                      </span>
                      <Show when={v.author}>
                        <span class="text-text-faint truncate max-w-[8rem]" title={v.author}>
                          · {v.author}
                        </span>
                      </Show>
                    </div>
                    <div class="text-[10px] text-text-dim truncate" title={v.message}>
                      {v.message}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1 py-0.5 text-[9px] flex-shrink-0"
                    title="Load this revision into the editor (does not write storage)"
                    aria-label={`Open ${props.item.name} at ${v.shortSha}`}
                    disabled={!!actionSha() || props.busy}
                    onClick={() => void onLoadAt(v)}
                    data-testid="axis-library-history-load"
                  >
                    {actionSha() === v.sha ? '…' : 'Open'}
                  </button>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1 py-0.5 text-[9px] flex-shrink-0"
                    title="Restore as the current library version"
                    aria-label={`Restore ${props.item.name} to ${v.shortSha}`}
                    disabled={!!actionSha() || props.busy}
                    onClick={() => void onRestore(v)}
                    data-testid="axis-library-history-restore"
                  >
                    Restore
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </li>
  );
};

/** One built-in catalog row — title, kind, category, Apply (chart) / Edit (editor). */
export const BuiltinScriptCard: Component<{
  item: BuiltinScript;
  busy?: boolean;
  /** This card is the one currently applying (others may be disabled via `busy`). */
  applying?: boolean;
  onApply: () => void;
  onEdit: () => void;
}> = (props) => (
  <li
    class="flex flex-col gap-1 border border-border-soft bg-bg-elev px-2 min-h-8 py-1.5 rounded text-left"
    data-testid="axis-library-builtin-card"
    data-builtin-id={props.item.id}
    data-script-kind={props.item.kind}
  >
    <div class="flex items-start gap-2">
      <div class="flex-1 min-w-0">
        <div class="text-text font-medium truncate text-[12px]" title={props.item.title}>
          {props.item.title}
        </div>
        <div class="flex flex-wrap items-center gap-1 mt-1" data-testid="axis-library-builtin-meta">
          <MetaChip
            class={`uppercase ${kindChipClass(props.item.kind)}`}
            title={props.item.kind === 'strategy' ? 'Pine strategy()' : 'Pine indicator()'}
            testId="axis-library-builtin-kind"
          >
            {scriptKindShort(props.item.kind)}
            <span class="sr-only"> {scriptKindLabel(props.item.kind)}</span>
          </MetaChip>
          <MetaChip class="border-border/50 text-text-dim" testId="axis-library-builtin-category">
            {builtinCategoryLabel(props.item.category)}
          </MetaChip>
          <Show when={props.item.overlay}>
            <MetaChip class="border-border/40 text-text-faint" title="Plots on the price chart">
              overlay
            </MetaChip>
          </Show>
        </div>
        <Show when={props.item.description}>
          <div
            class="text-text-faint font-mono text-[9px] truncate mt-0.5"
            title={props.item.description}
          >
            {props.item.description}
          </div>
        </Show>
      </div>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1.5 text-[10px] flex-shrink-0"
        title="Open in editor (fork into a personal script)"
        aria-label={`Edit ${props.item.title} in the editor`}
        disabled={props.busy}
        onClick={() => props.onEdit()}
        data-testid="axis-library-builtin-edit"
      >
        Edit
      </button>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1.5 text-[10px] flex-shrink-0"
        title="Run onto the chart now"
        aria-label={`Apply ${props.item.title} to the chart`}
        disabled={props.busy}
        onClick={() => props.onApply()}
        data-testid="axis-library-builtin-apply"
      >
        {props.applying ? '…' : 'Apply'}
      </button>
    </div>
  </li>
);
