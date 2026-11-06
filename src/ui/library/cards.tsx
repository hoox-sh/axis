// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Script Library rows: personal scripts (with version history) and built-ins.
 *
 * Cards are deliberately compact — the panel docks at 300px by default. The
 * kind-colored rail, hover lift, and icon actions carry the visual hierarchy;
 * secondary personal actions (copy / duplicate / delete) live behind one
 * expandable row so the primary **Load** stays obvious.
 *
 * @module ui/library/cards
 */

import { type Component, For, Show, createSignal, type JSX } from 'solid-js';
import type { ScriptMeta, ScriptVersion } from '../../plugins/types';
import { listScriptVersions, readScriptVersion, restoreScriptVersion } from '../../storage/service';
import {
  formatScriptUpdatedAt,
  scriptKindLabel,
  scriptKindShort,
  type ScriptKind,
} from '../../indicators/script-meta';
import { builtinCategoryLabel, type BuiltinScript } from '../../indicators/builtins';
import { appendLog, setStatus } from '../../store';
import { Icons } from '../icons';
import { HooxLoader } from '../HooxLoader';
import { announce } from '../sr-announce';
import { kindChipClass, scriptKindOf, shortRev } from './format';
import { Highlight } from './highlight';

function MetaChip(props: {
  class?: string;
  title?: string;
  testId?: string;
  children: JSX.Element;
}) {
  return (
    <span
      class={`ax-library-chip ${props.class || ''}`}
      title={props.title}
      data-testid={props.testId}
    >
      {props.children}
    </span>
  );
}

/** Small square icon action shared by both card kinds. */
function CardAction(props: {
  label: string;
  title: string;
  testId?: string;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  pressed?: boolean;
  class?: string;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <button
      type="button"
      class={`ax-library-action${props.class ? ` ${props.class}` : ''}`}
      classList={{
        'is-primary': props.tone === 'primary',
        'is-danger': props.tone === 'danger',
        'is-on': !!props.pressed,
      }}
      title={props.title}
      aria-label={props.label}
      aria-pressed={props.pressed ?? undefined}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      data-testid={props.testId}
    >
      {props.children}
    </button>
  );
}

/** One library row — name, kind, Pine version, last updated, optional version history. */
export const LibraryScriptCard: Component<{
  item: ScriptMeta;
  busy?: boolean;
  /** Active storage implements listVersions / readAtRevision. */
  versioning?: boolean;
  /** Search query for title / description highlighting. */
  query?: string;
  /** Pinned in the library panel. */
  favorite?: boolean;
  onToggleFavorite?: () => void;
  /** Currently loaded into the editor (dot on the title row). */
  active?: boolean;
  onLoad: () => void;
  onDelete: () => void;
  /** Copy the Pine source to the clipboard. */
  onCopy?: () => void;
  /** Clone the script under a new id. */
  onDuplicate?: () => void;
  /** Load a historical revision into the editor (does not write remote). */
  onLoadVersion?: (doc: { content: string; name: string; libraryId: string }) => void;
  /** After restore (new tip commit) — refresh list / optional editor reload. */
  onRestored?: (meta: ScriptMeta) => void;
}> = (props): JSX.Element => {
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [moreOpen, setMoreOpen] = createSignal(false);
  const [historyBusy, setHistoryBusy] = createSignal(false);
  const [historyErr, setHistoryErr] = createSignal('');
  const [versions, setVersions] = createSignal<ScriptVersion[]>([]);
  const [actionSha, setActionSha] = createSignal('');

  const kind = (): ScriptKind => scriptKindOf(props.item);
  const updatedAbs = () =>
    props.item.updatedAt ? new Date(props.item.updatedAt).toLocaleString() : '';
  const updatedRel = () => formatScriptUpdatedAt(props.item.updatedAt);
  const versionLabel = () => (props.item.pineVersion ? `v${props.item.pineVersion}` : '');
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
      if (!doc) {
        setHistoryErr('Version history is not available on this storage engine');
        return;
      }
      props.onLoadVersion({
        content: doc.content,
        name: doc.name,
        libraryId: doc.id,
      });
      setStatus('ready', `Loaded ${doc.name} @ ${v.shortSha} (not pushed)`);
      announce(`Loaded ${doc.name} at ${v.shortSha} into the editor`);
      appendLog('info', `Loaded "${doc.name}" at ${v.shortSha} into editor`, 'library');
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
      class="ax-library-card"
      classList={{ 'is-active': !!props.active }}
      data-testid="axis-library-script-card"
      data-script-kind={kind()}
      data-pine-version={props.item.pineVersion || undefined}
    >
      <span class="ax-library-card-rail" aria-hidden="true" />
      <div class="ax-library-card-main">
        <div class="ax-library-card-title-row">
          <span class="ax-library-card-title" title={props.item.name}>
            <Highlight text={props.item.name} query={props.query} />
          </span>
          <Show when={props.active}>
            <span class="ax-library-live-dot" title="Loaded in the editor" aria-hidden="true" />
          </Show>
        </div>
        <div class="ax-library-card-meta" data-testid="axis-library-script-meta">
          <MetaChip
            class={`ax-library-chip--kind ${kindChipClass(kind())}`}
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
              class="ax-library-chip--muted"
              title={`Pine //@version=${props.item.pineVersion}`}
              testId="axis-library-version"
            >
              {versionLabel()}
            </MetaChip>
          </Show>
          <Show when={revLabel()}>
            <MetaChip
              class="ax-library-chip--muted"
              title={`Revision ${props.item.revision}`}
              testId="axis-library-git-rev"
            >
              {revLabel()}
            </MetaChip>
          </Show>
          <Show when={updatedRel()}>
            <span
              class="ax-library-updated"
              title={updatedAbs() ? `Last updated ${updatedAbs()}` : 'Last updated'}
              data-testid="axis-library-updated"
            >
              {updatedRel()}
            </span>
          </Show>
        </div>
        <Show when={props.item.description || props.item.path}>
          <div
            class="ax-library-card-desc"
            title={props.item.description || props.item.path || props.item.id}
          >
            <Highlight text={props.item.description || props.item.path || ''} query={props.query} />
          </div>
        </Show>
        <Show when={props.item.tags?.length}>
          <div class="ax-library-tags">
            <For each={(props.item.tags ?? []).slice(0, 3)}>
              {(tag) => <span class="ax-library-tag">{tag}</span>}
            </For>
          </div>
        </Show>
      </div>
      <div class="ax-library-card-actions">
        <Show when={props.onToggleFavorite}>
          <CardAction
            label={props.favorite ? `Unpin ${props.item.name}` : `Pin ${props.item.name}`}
            title={props.favorite ? 'Unpin from the top of the library' : 'Pin to the top'}
            pressed={!!props.favorite}
            class="ax-library-star"
            onClick={() => props.onToggleFavorite?.()}
          >
            <Icons.favorite size={12} />
          </CardAction>
        </Show>
        <Show when={props.versioning}>
          <CardAction
            label={`Version history for ${props.item.name}`}
            title="Version history"
            pressed={historyOpen()}
            disabled={props.busy}
            onClick={toggleHistory}
            testId="axis-library-history"
          >
            <Icons.clock size={13} />
          </CardAction>
        </Show>
        <CardAction
          label={`Load ${props.item.name} into editor`}
          title="Load into editor"
          tone="primary"
          disabled={props.busy}
          onClick={() => props.onLoad()}
          testId="axis-library-load"
        >
          <Icons.editor size={13} />
        </CardAction>
        <Show when={props.onCopy || props.onDuplicate || props.onDelete}>
          <CardAction
            label={`More actions for ${props.item.name}`}
            title="More actions"
            pressed={moreOpen()}
            disabled={props.busy}
            onClick={() => setMoreOpen((v) => !v)}
            testId="axis-library-more"
          >
            <Icons.menu size={13} />
          </CardAction>
        </Show>
      </div>

      <Show when={moreOpen()}>
        <div class="ax-library-more" data-testid="axis-library-more-row">
          <Show when={props.onCopy}>
            <button
              type="button"
              class="ax-library-more-btn"
              disabled={props.busy}
              onClick={() => props.onCopy?.()}
              data-testid="axis-library-copy"
            >
              <Icons.copy size={11} /> Copy Pine
            </button>
          </Show>
          <Show when={props.onDuplicate}>
            <button
              type="button"
              class="ax-library-more-btn"
              disabled={props.busy}
              onClick={() => props.onDuplicate?.()}
              data-testid="axis-library-duplicate"
            >
              <Icons.plus size={11} /> Duplicate
            </button>
          </Show>
          <button
            type="button"
            class="ax-library-more-btn is-danger"
            disabled={props.busy}
            onClick={() => props.onDelete()}
            data-testid="axis-library-delete"
          >
            <Icons.trash size={11} /> Delete
          </button>
        </div>
      </Show>

      <Show when={historyOpen() && props.versioning}>
        <div class="ax-library-history" data-testid="axis-library-history-panel">
          <div class="ax-library-history-head">
            <span class="ax-library-history-title">
              <Icons.clock size={11} /> Version history
            </span>
            <button
              type="button"
              class="ax-library-more-btn"
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
            <p class="ax-library-history-error" role="alert">
              {historyErr()}
            </p>
          </Show>
          <Show when={!historyBusy() && versions().length === 0 && !historyErr()}>
            <p class="ax-library-history-empty">No versions found for this script.</p>
          </Show>
          <Show when={historyBusy() && versions().length === 0}>
            <div class="ax-library-history-empty">
              <HooxLoader size="xs" /> Loading versions…
            </div>
          </Show>
          <ul class="ax-library-history-list">
            <For each={versions()}>
              {(v) => (
                <li
                  class="ax-library-history-row"
                  data-testid="axis-library-history-row"
                  data-sha={v.sha}
                >
                  <div class="ax-library-history-main">
                    <div class="ax-library-history-meta">
                      <span class="ax-library-history-sha" title={v.sha}>
                        {v.shortSha}
                      </span>
                      <span title={new Date(v.committedAt).toLocaleString()}>
                        {formatScriptUpdatedAt(v.committedAt)}
                      </span>
                      <Show when={v.author}>
                        <span class="ax-library-history-author" title={v.author}>
                          · {v.author}
                        </span>
                      </Show>
                    </div>
                    <div class="ax-library-history-msg" title={v.message}>
                      {v.message}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="ax-library-more-btn"
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
                    class="ax-library-more-btn"
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
/**
 * One built-in catalog row: title, kind/category chips, favorite toggle, and
 * Apply (chart) / Edit (editor) actions. `applied` marks a script already on the
 * chart, where Apply re-runs it against fresh bars instead of adding a copy.
 *
 * @param props - Catalog entry, busy/applied/favorite state, and action callbacks.
 * @returns An `li.ax-library-card`.
 */
export const BuiltinScriptCard: Component<{
  item: BuiltinScript;
  busy?: boolean;
  /** This card is the one currently applying (others may be disabled via `busy`). */
  applying?: boolean;
  /** A chart script with this title is already applied (Apply re-runs it). */
  applied?: boolean;
  /** Pinned to the top of the catalog. */
  favorite?: boolean;
  onToggleFavorite?: () => void;
  /** Search query for title / description highlighting. */
  query?: string;
  onApply: () => void;
  onEdit: () => void;
}> = (props): JSX.Element => (
  <li
    class="ax-library-card"
    classList={{ 'is-applied': !!props.applied }}
    data-testid="axis-library-builtin-card"
    data-builtin-id={props.item.id}
    data-script-kind={props.item.kind}
    data-applied={props.applied ? 'true' : undefined}
  >
    <span class="ax-library-card-rail" aria-hidden="true" />
    <div class="ax-library-card-main">
      <div class="ax-library-card-title-row">
        <span class="ax-library-card-title" title={props.item.title}>
          <Highlight text={props.item.title} query={props.query} />
        </span>
        <Show when={props.applied}>
          <span
            class="ax-library-applied"
            title="Already on the chart — Apply re-runs it with fresh bars"
            data-testid="axis-library-builtin-applied"
          >
            applied
          </span>
        </Show>
      </div>
      <div class="ax-library-card-meta" data-testid="axis-library-builtin-meta">
        <MetaChip
          class={`ax-library-chip--kind ${kindChipClass(props.item.kind)}`}
          title={props.item.kind === 'strategy' ? 'Pine strategy()' : 'Pine indicator()'}
          testId="axis-library-builtin-kind"
        >
          {scriptKindShort(props.item.kind)}
          <span class="sr-only"> {scriptKindLabel(props.item.kind)}</span>
        </MetaChip>
        <MetaChip class="ax-library-chip--muted" testId="axis-library-builtin-category">
          {builtinCategoryLabel(props.item.category)}
        </MetaChip>
        <span
          class="ax-library-updated"
          title={
            props.item.overlay
              ? 'Plots on the price chart (overlay=true)'
              : 'Plots in its own sub-pane (overlay=false)'
          }
        >
          {props.item.overlay ? 'overlay' : 'pane'}
        </span>
      </div>
      <div class="ax-library-card-desc" title={props.item.description}>
        <Highlight text={props.item.description} query={props.query} />
      </div>
    </div>
    <div class="ax-library-card-actions">
      <Show when={props.onToggleFavorite}>
        <CardAction
          label={props.favorite ? `Unpin ${props.item.title}` : `Pin ${props.item.title}`}
          title={props.favorite ? 'Unpin from the top of the catalog' : 'Pin to the top'}
          pressed={!!props.favorite}
          class="ax-library-star"
          onClick={() => props.onToggleFavorite?.()}
        >
          <Icons.favorite size={12} />
        </CardAction>
      </Show>
      <CardAction
        label={`Edit ${props.item.title} in the editor`}
        title="Open in editor (fork into a personal script)"
        disabled={props.busy}
        onClick={() => props.onEdit()}
        testId="axis-library-builtin-edit"
      >
        <Icons.pencil size={12} />
      </CardAction>
      <CardAction
        label={`Apply ${props.item.title} to the chart`}
        title={props.applied ? 'Apply again with fresh bars' : 'Run onto the chart now'}
        tone="primary"
        disabled={props.busy}
        onClick={() => props.onApply()}
        testId="axis-library-builtin-apply"
      >
        {props.applying ? <HooxLoader size="xs" /> : <Icons.play size={12} />}
      </CardAction>
    </div>
  </li>
);
