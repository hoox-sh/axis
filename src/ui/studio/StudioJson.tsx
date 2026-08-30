// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Collapsible JSON tree for studio overlays (Results → Raw).
 *
 * Canvas is the only scroller. Large arrays page in (`JSON_PAGE`) so a
 * 5k-bar `series.close` does not mount thousands of nodes at once.
 *
 * @module ui/studio/StudioJson
 */

import { For, Show, createContext, createMemo, createSignal, useContext, type Accessor } from 'solid-js';
import { Icons } from '../icons';
import { copyToClipboard } from '../clipboard';
import {
  JSON_PAGE,
  childCount,
  childEntries,
  childPath,
  collectOpenPaths,
  formatPrimitive,
  isContainer,
  jsonKind,
  jsonStats,
  keyMatches,
  primitiveMatches,
  subtreeMatches,
} from './json-tree';

type JsonCtx = {
  query: Accessor<string>;
  expanded: Accessor<Set<string>>;
  toggle: (path: string) => void;
  shown: Accessor<Record<string, number>>;
  showMore: (path: string) => void;
};

const Ctx = createContext<JsonCtx>();

function useJson(): JsonCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('StudioJson context missing');
  return ctx;
}

function Primitive(props: { value: unknown }) {
  const fmt = () => formatPrimitive(props.value);
  return <span class={`ax-json-val ax-json-val--${fmt().kind}`}>{fmt().text}</span>;
}

function JsonNode(props: { keyName: string | null; value: unknown; path: string }) {
  const ctx = useJson();
  const kind = () => jsonKind(props.value);
  const container = () => isContainer(props.value);
  const count = () => childCount(props.value);
  const q = () => ctx.query().trim();

  const visible = createMemo(() => {
    const query = q();
    if (!query) return true;
    if (props.keyName && keyMatches(props.keyName, query)) return true;
    if (primitiveMatches(props.value, query)) return true;
    return subtreeMatches(props.value, query);
  });

  const open = createMemo(() => {
    if (!container()) return false;
    if (q() && subtreeMatches(props.value, q()) && count() <= JSON_PAGE) return true;
    return ctx.expanded().has(props.path);
  });

  const entries = createMemo(() => childEntries(props.value));
  const page = () => ctx.shown()[props.path] ?? JSON_PAGE;
  const shownEntries = createMemo(() => entries().slice(0, page()));
  const hidden = () => Math.max(0, entries().length - page());

  const copyValue = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await copyToClipboard(JSON.stringify(props.value, null, 2));
    } catch {
      await copyToClipboard(String(props.value));
    }
  };

  return (
    <Show when={visible()}>
      <div class="ax-json-node" data-kind={kind()}>
        <div class="ax-json-row">
          <Show
            when={container()}
            fallback={<span class="ax-json-twist" aria-hidden="true" />}
          >
            <button
              type="button"
              class={`ax-json-twist${open() ? ' is-open' : ''}`}
              aria-expanded={open()}
              aria-label={open() ? 'Collapse' : 'Expand'}
              onClick={() => ctx.toggle(props.path)}
            >
              <Icons.chevronRight size={14} />
            </button>
          </Show>
          <Show when={props.keyName !== null}>
            <span class="ax-json-key">{props.keyName}</span>
            <span class="ax-json-colon">:</span>
          </Show>
          <Show
            when={container()}
            fallback={
              <button type="button" class="ax-json-leaf" title="Copy value" onClick={(e) => void copyValue(e)}>
                <Primitive value={props.value} />
              </button>
            }
          >
            <button
              type="button"
              class="ax-json-preview"
              title={open() ? 'Collapse' : 'Expand'}
              onClick={() => ctx.toggle(props.path)}
            >
              <span class="ax-json-punct">{Array.isArray(props.value) ? '[' : '{'}</span>
              <span class="ax-json-size">{count()}</span>
              <span class="ax-json-punct">{Array.isArray(props.value) ? ']' : '}'}</span>
            </button>
          </Show>
        </div>
        <Show when={container() && open()}>
          <div class="ax-json-children">
            <For each={shownEntries()}>
              {([k, v]) => <JsonNode keyName={k} value={v} path={childPath(props.path, k)} />}
            </For>
            <Show when={hidden() > 0}>
              <button
                type="button"
                class="ax-json-more"
                onClick={() => ctx.showMore(props.path)}
              >
                Show {Math.min(JSON_PAGE, hidden())} more · {hidden()} hidden
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

export function StudioJson(props: { value: unknown; testId?: string }) {
  const [mode, setMode] = createSignal<'tree' | 'source'>('tree');
  const [query, setQuery] = createSignal('');
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set(['$']));
  const [shown, setShown] = createSignal<Record<string, number>>({});

  const source = createMemo(() => {
    try {
      return JSON.stringify(props.value, null, 2);
    } catch {
      return String(props.value);
    }
  });

  const stats = createMemo(() => jsonStats(props.value));

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () => {
    setExpanded(new Set(collectOpenPaths(props.value)));
  };

  const collapseAll = () => {
    setExpanded(new Set(['$']));
    setShown({});
  };

  const showMore = (path: string) => {
    setShown((prev) => ({ ...prev, [path]: (prev[path] ?? JSON_PAGE) + JSON_PAGE }));
  };

  const ctx: JsonCtx = {
    query,
    expanded,
    toggle,
    shown,
    showMore,
  };

  return (
    <div class="ax-json" data-testid={props.testId}>
      <div class="ax-toolbar ax-json-toolbar">
        <div class="ax-chip-row" role="group" aria-label="Raw view">
          <button
            type="button"
            class="ax-chip"
            aria-pressed={mode() === 'tree'}
            data-testid="axis-results-raw-tree"
            onClick={() => setMode('tree')}
          >
            Tree
          </button>
          <button
            type="button"
            class="ax-chip"
            aria-pressed={mode() === 'source'}
            data-testid="axis-results-raw-source"
            onClick={() => setMode('source')}
          >
            Source
          </button>
        </div>
        <Show when={mode() === 'tree'}>
          <input
            class="ax-input ax-json-search"
            type="search"
            placeholder="Filter keys…"
            value={query()}
            data-testid="axis-results-raw-filter"
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <span class="ax-toolbar-spacer" />
          <button
            type="button"
            class="ax-btn ax-btn--ghost"
            data-testid="axis-results-raw-expand"
            title="Expand objects (skips huge arrays)"
            onClick={expandAll}
          >
            Expand
          </button>
          <button
            type="button"
            class="ax-btn ax-btn--ghost"
            data-testid="axis-results-raw-collapse"
            title="Collapse nested nodes"
            onClick={collapseAll}
          >
            Collapse
          </button>
        </Show>
        <Show when={mode() === 'source'}>
          <span class="ax-toolbar-spacer" />
        </Show>
        <span class="ax-hint ax-json-stats">
          {stats().keys} keys · {stats().arrays} arrays · {stats().values} values
        </span>
      </div>
      <Show
        when={mode() === 'tree'}
        fallback={
          <pre class="ax-code" data-testid="axis-results-raw-text">
            {source()}
          </pre>
        }
      >
        <Ctx.Provider value={ctx}>
          <div class="ax-json-tree" data-testid="axis-results-raw-view">
            <Show
              when={isContainer(props.value)}
              fallback={<JsonNode keyName={null} value={props.value} path="$" />}
            >
              <For each={childEntries(props.value)}>
                {([k, v]) => <JsonNode keyName={k} value={v} path={childPath('$', k)} />}
              </For>
            </Show>
          </div>
        </Ctx.Provider>
      </Show>
    </div>
  );
}
