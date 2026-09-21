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
 * Script library UI — list / load / save / delete against the active storage plugin.
 *
 * Two tabs: **Builtin** (first-party AXIS Pine catalog — apply to chart or
 * open in the editor) and **Personal** (storage-backed user scripts with
 * cloud/git credential mini-forms and import/export).
 * Optional `getDoc` / `setDoc` wire the panel to the live editor document.
 *
 * Cards, git/cloud forms, and filters live under `ui/library/`.
 * {@link LibraryPanel} docks the same content in a floatable chrome panel
 * (topbar **Library**). Plugin Manager still embeds {@link ScriptLibraryPanel}
 * content without chrome. Pass `commands` so the docked panel handles
 * Find across scripts / Recent scripts (the embed must not steal that intent).
 *
 * App-wide drag-and-drop of `.pyne` / `.pine` files is handled in `app.tsx`
 * (same import path).
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import type { ScriptMeta } from '../plugins/types';
import {
  generateDemoApiKey,
  resolveCloudConfig,
  writeStoredCloudConfig,
} from '../storage/cloud-config';
import { probeCloudStorage } from '../storage/cloud';
import {
  listScripts,
  readScript,
  writeScript,
  removeScript,
  exportLibraryJson,
  importLibraryJson,
  getStorageStatus,
  supportsScriptVersioning,
  promptStorageChange,
} from '../storage/service';
import { importPyneFiles, isPyneFileName } from '../storage/import-pyne-files';
import {
  listPublishedLibraries,
  publishLibrary,
} from '../storage/library-publish-io';
import {
  formatImportSnippet,
  parseLibraryDeclaration,
  type PublishedIndex,
} from '../storage/library-publish';
import { listStorages } from '../storage/catalog';
import {
  store,
  setStore,
  persist,
  appendLog,
  setStatus,
  isPanelOpen,
} from '../store';
import { getActiveStorageId } from '../plugins/active';
import { pluginKey } from '../plugins/types';
import { DEFAULT_GIT_CONFIG, type GitConfig } from '../storage/git-config';
import {
  fetchGitUser,
  isOAuthProxyBase,
  resolveOAuthProxyBase,
  sanitizeVerificationUri,
  startDeviceFlow,
  waitForDeviceToken,
} from '../storage/git-oauth';
import {
  BUILTIN_SCRIPTS,
  applyBuiltinScript,
  builtinCategoryLabel,
  filterBuiltinScripts,
  listBuiltinCategories,
  type BuiltinScript,
} from '../indicators/builtins';
import { Icons } from './icons';
import { HooxLoader } from './HooxLoader';
import { FloatableShell } from './panels/FloatableShell';
import { announce, announceError } from './sr-announce';
import { BuiltinScriptCard, LibraryScriptCard } from './library/cards';
import { CloudSettingsForm } from './library/CloudForm';
import { takeLibraryCommand, type LibraryCommand } from './library/commands';
import { LibraryField } from './library/Field';
import {
  countScriptsByKind,
  filterPersonalScripts,
  sortPersonalScripts,
  visibleKindFilters,
  type ScriptKindFilter,
  type ScriptSort,
} from './library/format';
import { GitSettingsForm } from './library/GitForm';

function cloudCfg(): { endpoint: string; apiKey: string } {
  return resolveCloudConfig();
}

function saveCloudCfg(endpoint: string, apiKey: string) {
  writeStoredCloudConfig(endpoint, apiKey);
}

function gitCfg(): GitConfig {
  const pc = store.pluginsConfig || {};
  const c = (pc[pluginKey('storage', 'git')] || pc['git'] || {}) as Partial<GitConfig>;
  return { ...DEFAULT_GIT_CONFIG, ...c };
}

function saveGitCfg(cfg: GitConfig) {
  setStore('pluginsConfig', pluginKey('storage', 'git'), { ...cfg });
  persist();
}

/** Optional editor doc bridge and load callback. */
export interface ScriptLibraryPanelProps {
  getDoc?: () => string;
  /** Load into editor; optional libraryId binds the tab for git push. */
  setDoc?: (doc: string, name?: string, libraryId?: string) => void;
  onLoaded?: (meta: ScriptMeta, content: string) => void;
  /**
   * Listen for Find / Recent palette commands. Only the docked
   * {@link LibraryPanel} should set this — an embedded copy would consume
   * the buffered intent before the docked panel mounts.
   */
  commands?: boolean;
}

let nextLibraryPanel = 0;

/** Library browser for Plugin Manager (and any host that supplies doc IO). */

export const ScriptLibraryPanel: Component<ScriptLibraryPanelProps> = (props) => {
  const uid = `axis-lib-${++nextLibraryPanel}`;
  const [tab, setTab] = createSignal<'builtin' | 'personal'>('builtin');
  const [items, setItems] = createSignal<ScriptMeta[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [name, setName] = createSignal('');
  const [desc, setDesc] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [kind, setKind] = createSignal<ScriptKindFilter>('all');
  const [sort, setSort] = createSignal<ScriptSort>('stored');
  const [applyingBuiltin, setApplyingBuiltin] = createSignal('');
  const [published, setPublished] = createSignal<PublishedIndex['libraries']>([]);
  const [lastImport, setLastImport] = createSignal('');
  const [statusLine, setStatusLine] = createSignal('');
  const [cloudEndpoint, setCloudEndpoint] = createSignal(cloudCfg().endpoint);
  const [cloudKey, setCloudKey] = createSignal(cloudCfg().apiKey);

  const g0 = gitCfg();
  const [gitProvider, setGitProvider] = createSignal<'github' | 'gitlab'>(g0.provider);
  const [gitToken, setGitToken] = createSignal(g0.token);
  const [gitOwner, setGitOwner] = createSignal(g0.owner);
  const [gitRepo, setGitRepo] = createSignal(g0.repo);
  const [gitProjectId, setGitProjectId] = createSignal(g0.projectId);
  const [gitBranch, setGitBranch] = createSignal(g0.branch);
  const [gitBasePath, setGitBasePath] = createSignal(g0.basePath);
  const [gitApiBase, setGitApiBase] = createSignal(g0.apiBaseUrl);
  /** Optional public OAuth App client id (when Worker env not set). */
  const [gitOAuthClientId, setGitOAuthClientId] = createSignal(
    String(g0.oauthClientId || ''),
  );
  const [showGitAdvanced, setShowGitAdvanced] = createSignal(false);
  const [oauthBusy, setOauthBusy] = createSignal(false);
  const [oauthUserCode, setOauthUserCode] = createSignal('');
  const [oauthVerifyUri, setOauthVerifyUri] = createSignal('');
  const [oauthHint, setOauthHint] = createSignal('');
  const [oauthLogin, setOauthLogin] = createSignal('');
  let oauthAbort: AbortController | null = null;
  let fileInput: HTMLInputElement | undefined;
  let findInput: HTMLInputElement | undefined;

  const runLibraryCommand = (cmd: LibraryCommand) => {
    if (cmd === 'find') {
      queueMicrotask(() => {
        findInput?.focus();
        findInput?.select();
      });
      return;
    }
    setTab('personal');
    setQuery('');
    setKind('all');
    setSort('recent');
    announce('Showing personal scripts, newest first');
  };

  onMount(() => {
    if (!props.commands) return;
    const queued = takeLibraryCommand();
    if (queued) runLibraryCommand(queued);
    const onCmd = (e: Event) => {
      const detail = (e as CustomEvent<LibraryCommand>).detail;
      takeLibraryCommand();
      if (detail === 'find' || detail === 'recent') runLibraryCommand(detail);
    };
    window.addEventListener('axis-library-command', onCmd);
    onCleanup(() => window.removeEventListener('axis-library-command', onCmd));
  });

  /**
   * OAuth device-flow proxy base.
   * Prefer trusted cloud Worker / engine / same-origin; never send device codes
   * to an arbitrary untrusted host (enforced again in startDeviceFlow).
   */
  const oauthWorkerBase = () => {
    const cloud = cloudCfg().endpoint.replace(/\/$/, '');
    const engine = String(store.endpoint || '').replace(/\/$/, '');
    const sameOrigin =
      typeof window !== 'undefined' ? window.location.origin : '';
    for (const candidate of [cloud, engine, sameOrigin]) {
      if (!candidate) continue;
      if (isOAuthProxyBase(candidate, { sameOrigin })) {
        return resolveOAuthProxyBase(candidate);
      }
    }
    return resolveOAuthProxyBase();
  };

  const storages = () => listStorages();
  const backend = () => store.activePlugins?.storage || 'local';
  const isCloud = () => backend() === 'cloud';
  const isGit = () => backend() === 'git';

  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      const list = await listScripts();
      setItems(list);
      try {
        const pub = await listPublishedLibraries();
        setPublished(
          [...pub.libraries].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)),
        );
      } catch {
        /* published catalog optional */
      }
      const st = await getStorageStatus();
      const parts = [
        backend(),
        st.remote,
        st.branch ? `@${st.branch}` : '',
        st.connected ? '' : 'offline',
        `${list.length} script${list.length === 1 ? '' : 's'}`,
      ].filter(Boolean);
      setStatusLine(parts.join(' · '));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  createEffect(() => {
    void store.activePlugins?.storage;
    if (isCloud()) {
      const c = cloudCfg();
      setCloudEndpoint(c.endpoint);
      setCloudKey(c.apiKey);
    }
    if (isGit()) {
      const g = gitCfg();
      setGitProvider(g.provider);
      setGitToken(g.token);
      setGitOwner(g.owner);
      setGitRepo(g.repo);
      setGitProjectId(g.projectId);
      setGitBranch(g.branch);
      setGitBasePath(g.basePath);
      setGitApiBase(g.apiBaseUrl);
    }
    void refresh();
  });

  const kindCounts = createMemo(() => countScriptsByKind(items()));
  const kindFilters = createMemo(() => visibleKindFilters(kindCounts()));
  const personalShown = createMemo(() =>
    sortPersonalScripts(filterPersonalScripts(items(), query(), kind()), sort()),
  );

  /** Built-ins grouped by category in catalog order, filtered by the shared search. */
  const builtinGroups = createMemo(() => {
    const filtered = filterBuiltinScripts(query());
    const groups: { category: string; label: string; items: BuiltinScript[] }[] = [];
    for (const category of listBuiltinCategories()) {
      const inCat = filtered.filter((s) => s.category === category);
      if (!inCat.length) continue;
      groups.push({ category, label: builtinCategoryLabel(category), items: inCat });
    }
    return groups;
  });
  const builtinCount = createMemo(() =>
    builtinGroups().reduce((n, g) => n + g.items.length, 0),
  );
  const otherCatalog = createMemo(() => {
    const q = query().trim();
    if (!q) return null;
    if (tab() === 'builtin') {
      const n = filterPersonalScripts(items(), q, 'all').length;
      return n > 0
        ? { next: 'personal' as const, label: `${n} in Personal` }
        : null;
    }
    const n = filterBuiltinScripts(q).length;
    return n > 0
      ? { next: 'builtin' as const, label: `${n} built-in${n === 1 ? '' : 's'}` }
      : null;
  });

  const onSave = async () => {
    const n = name().trim();
    if (!n) {
      setError('Name is required');
      return;
    }
    const content = props.getDoc?.() ?? '';
    if (!content.trim()) {
      setError('Editor is empty');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await writeScript({
        id: `s_${Date.now().toString(36)}`,
        name: n,
        description: desc().trim() || undefined,
        content,
      });
      setName('');
      setDesc('');
      const msg = isGit() ? `Committed and saved ${n}` : `Saved ${n}`;
      setStatus('ready', isGit() ? `Committed & saved "${n}" to git` : `Saved "${n}"`);
      announce(msg);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPublish = async () => {
    const content = props.getDoc?.() ?? '';
    if (!parseLibraryDeclaration(content)) {
      setError('Current editor is not a library() — add library("Name") first');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await publishLibrary(content, { origin: 'manual' });
      setLastImport(result.importSnippet);
      const msg = result.skipped
        ? `Already published ${result.library.namespace}/${result.library.name}/${result.library.version}`
        : `Published ${result.library.namespace}/${result.library.name}/${result.library.version}` +
          (result.remote ? ' to git' : ' (local cache)');
      setStatus('ready', msg);
      announce(msg);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onLoad = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const doc = await readScript(id);
      props.setDoc?.(doc.content, doc.name, doc.id);
      props.onLoaded?.(doc, doc.content);
      setStatus('ready', `Loaded "${doc.name}"`);
      announce(`Loaded ${doc.name}`);
      appendLog('ok', `Loaded library script ${doc.name}`, 'library');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const versioning = () => supportsScriptVersioning();

  const onApplyBuiltin = async (b: BuiltinScript) => {
    setApplyingBuiltin(b.id);
    setError('');
    try {
      await applyBuiltinScript(b.id);
      setStatus('ready', `Applied built-in "${b.title}"`);
      announce(`Applied ${b.title}`);
      appendLog('ok', `Applied built-in script ${b.title}`, 'library');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('error', msg);
    } finally {
      setApplyingBuiltin('');
    }
  };

  const onEditBuiltin = (b: BuiltinScript) => {
    props.setDoc?.(b.code, b.title);
    setStatus('ready', `Opened built-in "${b.title}" (save to keep it)`);
    announce(`Opened ${b.title} in the editor`);
    appendLog('info', `Opened built-in script ${b.title} in editor`, 'library');
  };

  const onDelete = async (id: string, scriptName: string) => {
    if (!confirm(`Delete "${scriptName}"?`)) return;
    setBusy(true);
    try {
      await removeScript(id);
      announce(`Deleted ${scriptName}`);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    try {
      const docs = await exportLibraryJson();
      const blob = new Blob([JSON.stringify(docs, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pynescript-library.json';
      a.click();
      URL.revokeObjectURL(a.href);
      announce(`Exported ${docs.length} script${docs.length === 1 ? '' : 's'}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onImportFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      const pineFiles = files.filter((f) => isPyneFileName(f.name));
      const jsonFiles = files.filter(
        (f) => !isPyneFileName(f.name) && /\.json$/i.test(f.name),
      );
      let total = 0;
      if (pineFiles.length) {
        const result = await importPyneFiles(pineFiles);
        total += result.imported.length;
        if (result.errors.length) {
          setError(result.errors.slice(0, 3).join('; '));
        }
      }
      for (const file of jsonFiles) {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data)) throw new Error(`${file.name}: expected a JSON array of scripts`);
        total += await importLibraryJson(data, { forceNewIds: true });
      }
      if (!pineFiles.length && !jsonFiles.length) {
        throw new Error('Choose .pyne / .pine / .pinescript or library JSON files');
      }
      if (total > 0) {
        setStatus('ready', `Imported ${total} script(s)`);
        announce(`Imported ${total} script${total === 1 ? '' : 's'}`);
        await refresh();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      input.value = '';
    }
  };

  const persistGit = (tokenOverride?: string) => {
    const token = tokenOverride !== undefined ? tokenOverride : gitToken();
    saveGitCfg({
      provider: gitProvider(),
      apiBaseUrl: gitApiBase().trim(),
      token,
      owner: gitOwner().trim(),
      repo: gitRepo().trim(),
      projectId: gitProjectId().trim(),
      branch: gitBranch().trim() || 'main',
      basePath: gitBasePath().trim() || 'pyne-library',
      autoPush: true,
      commitMessageTemplate: DEFAULT_GIT_CONFIG.commitMessageTemplate,
      ...(gitOAuthClientId().trim()
        ? { oauthClientId: gitOAuthClientId().trim() }
        : {}),
    } as GitConfig);
    void refresh();
  };

  const cancelOauth = () => {
    oauthAbort?.abort();
    oauthAbort = null;
    setOauthBusy(false);
    setOauthUserCode('');
    setOauthVerifyUri('');
    setOauthHint('');
  };

  const disconnectGit = () => {
    cancelOauth();
    setGitToken('');
    setOauthLogin('');
    persistGit('');
    setStatus('ready', 'Git account disconnected');
    announce('Git account disconnected');
  };

  const connectGitOAuth = async () => {
    cancelOauth();
    setError('');
    setOauthBusy(true);
    setOauthHint('Starting device authorization…');
    const ac = new AbortController();
    oauthAbort = ac;
    const provider = gitProvider();
    try {
      const started = await startDeviceFlow({
        provider,
        workerEndpoint: oauthWorkerBase(),
        clientId: gitOAuthClientId().trim() || undefined,
      });
      if (ac.signal.aborted) return;
      setOauthUserCode(started.user_code);
      const verifyRaw =
        started.verification_uri_complete || started.verification_uri;
      // startDeviceFlow already sanitizes; belt-and-suspenders for open/href
      const verifySafe =
        sanitizeVerificationUri(verifyRaw, provider) ||
        started.verification_uri;
      setOauthVerifyUri(verifySafe);
      setOauthHint('Approve access in the browser, then return here.');
      // Open verification page for the user (allowlisted hosts only)
      try {
        if (verifySafe) {
          window.open(verifySafe, '_blank', 'noopener,noreferrer');
        }
      } catch {
        /* popup blocked — user can click the link */
      }

      const token = await waitForDeviceToken({
        provider,
        deviceCode: started.device_code,
        intervalSec: started.interval,
        expiresInSec: started.expires_in,
        workerEndpoint: oauthWorkerBase(),
        clientId: gitOAuthClientId().trim() || undefined,
        signal: ac.signal,
        onTick: (info) => {
          if (info.error === 'authorization_pending') {
            setOauthHint('Waiting for approval…');
          } else if (info.error === 'slow_down') {
            setOauthHint('Polling slower (rate limit)…');
          }
        },
      });

      setGitToken(token);
      let login = '';
      try {
        const user = await fetchGitUser(provider, token, gitApiBase().trim() || undefined);
        if (user.login) {
          login = user.login;
          setOauthLogin(user.login);
          if (!gitOwner().trim()) setGitOwner(user.login);
        }
      } catch {
        /* token still valid even if /user fails */
      }
      persistGit(token);
      setOauthHint('');
      setOauthUserCode('');
      setOauthVerifyUri('');
      const who = provider === 'github' ? 'GitHub' : 'GitLab';
      setStatus('ready', `Connected to ${who}${login ? ` as ${login}` : ''}`);
      announce(`Connected to ${who}${login ? ` as ${login}` : ''}`);
      appendLog('ok', `Git OAuth connected (${provider})`, 'git', { toast: true });
    } catch (e: unknown) {
      if (ac.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setOauthHint('');
      appendLog('error', `Git OAuth: ${msg}`, 'git');
    } finally {
      if (oauthAbort === ac) oauthAbort = null;
      setOauthBusy(false);
    }
  };

  const copyImport = (snip: string) => {
    setLastImport(snip);
    void navigator.clipboard?.writeText(snip).then(
      () => {
        setStatus('ready', 'Copied import snippet');
        announce('Copied import snippet');
      },
      () => announceError('Could not copy import snippet'),
    );
  };

  return (
    <div class="flex flex-col gap-2 text-[12px]" aria-busy={busy()}>
      <div data-testid="axis-library-find" class="flex flex-col gap-1">
        <input
          ref={findInput}
          type="search"
          class="axis-search sc-input h-7 min-h-7 text-[11px] placeholder:text-text-faint"
          placeholder="Find across scripts… (rsi, macd, name)"
          aria-label="Find across scripts"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          data-testid="axis-library-builtin-search"
          autocomplete="off"
          spellcheck={false}
        />
        <Show when={otherCatalog()}>
          {(hint) => (
            <button
              type="button"
              class="sc-btn sc-btn-ghost self-start text-[10px] h-6 min-h-6 px-1.5"
              onClick={() => setTab(hint().next)}
            >
              Also {hint().label}
            </button>
          )}
        </Show>
      </div>

      <div
        class="flex gap-1 border-b border-border pb-1"
        role="tablist"
        aria-label="Script library"
      >
        <button
          type="button"
          id={`${uid}-tab-builtin`}
          role="tab"
          aria-selected={tab() === 'builtin'}
          aria-controls={`${uid}-panel-builtin`}
          class={`sc-btn sc-btn-ghost text-[11px] px-2 h-7 min-h-7 ${tab() === 'builtin' ? 'is-active' : ''}`}
          onClick={() => setTab('builtin')}
          data-testid="axis-library-tab-builtin"
        >
          Builtin ({query().trim() ? builtinCount() : BUILTIN_SCRIPTS.length})
        </button>
        <button
          type="button"
          id={`${uid}-tab-personal`}
          role="tab"
          aria-selected={tab() === 'personal'}
          aria-controls={`${uid}-panel-personal`}
          class={`sc-btn sc-btn-ghost text-[11px] px-2 h-7 min-h-7 ${tab() === 'personal' ? 'is-active' : ''}`}
          onClick={() => setTab('personal')}
          data-testid="axis-library-tab-personal"
        >
          Personal ({query().trim() || kind() !== 'all' ? personalShown().length : items().length})
        </button>
      </div>

      <Show when={error()}>
        <p class="text-red font-mono text-[12px] m-0" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={tab() === 'builtin'}>
        <div
          class="flex flex-col gap-2"
          role="tabpanel"
          id={`${uid}-panel-builtin`}
          aria-labelledby={`${uid}-tab-builtin`}
          data-testid="axis-library-builtin-list"
        >
          <Show
            when={builtinCount() > 0}
            fallback={
              <div class="axis-empty-state text-[12px] text-text-dim py-2">
                No built-ins match “{query()}”
              </div>
            }
          >
            <For each={builtinGroups()}>
              {(group) => (
                <section class="flex flex-col gap-1" aria-label={group.label}>
                  <h3 class="sc-section-title m-0">
                    {group.label}{' '}
                    <span class="font-mono font-normal normal-case tracking-normal text-text-faint">
                      ({group.items.length})
                    </span>
                  </h3>
                  <ul class="flex flex-col gap-1 w-full text-left items-stretch m-0 p-0 list-none">
                    <For each={group.items}>
                      {(b) => (
                        <BuiltinScriptCard
                          item={b}
                          busy={!!applyingBuiltin() || busy()}
                          applying={applyingBuiltin() === b.id}
                          onApply={() => void onApplyBuiltin(b)}
                          onEdit={() => onEditBuiltin(b)}
                        />
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          </Show>
          <p class="m-0 text-[9px] text-text-faint">
            First-party AXIS originals — <strong>Apply</strong> runs one onto the chart,{' '}
            <strong>Edit</strong> opens its Pine in the editor (then save it under Personal to keep
            a copy).
          </p>
        </div>
      </Show>

      <Show when={tab() === 'personal'}>
        <div
          class="flex flex-col gap-2"
          role="tabpanel"
          id={`${uid}-panel-personal`}
          aria-labelledby={`${uid}-tab-personal`}
        >
          <LibraryField label="Storage backend">
            <select
              id={`${uid}-storage`}
              class="sc-input"
              value={backend()}
              onChange={(e) => promptStorageChange(getActiveStorageId(), e.currentTarget.value)}
              title="Where user Pine scripts are stored"
            >
              <For each={storages()}>
                {(s) => (
                  <option value={s.id}>
                    {s.name}
                    {s.builtIn ? '' : ' (plugin)'}
                  </option>
                )}
              </For>
            </select>
          </LibraryField>
          <p class="text-text-faint font-mono text-[10px] m-0 -mt-1" role="status">
            {statusLine() || (busy() ? 'Loading…' : '')}
          </p>

          <Show when={isCloud()}>
            <CloudSettingsForm
              endpoint={cloudEndpoint()}
              apiKey={cloudKey()}
              onEndpoint={setCloudEndpoint}
              onApiKey={setCloudKey}
              onGenerate={() => {
                const key = generateDemoApiKey();
                setCloudKey(key);
                saveCloudCfg(cloudEndpoint(), key);
              }}
              onTest={() => {
                saveCloudCfg(cloudEndpoint(), cloudKey());
                void probeCloudStorage({
                  endpoint: cloudEndpoint(),
                  apiKey: cloudKey(),
                }).then((r) => {
                  setError(r.ok ? '' : r.message);
                  if (r.ok) {
                    setStatusLine(r.message);
                    announce(r.message);
                  }
                  void refresh();
                });
              }}
              onSave={() => {
                saveCloudCfg(cloudEndpoint(), cloudKey());
                announce('Saved cloud settings');
                void refresh();
              }}
            />
          </Show>

          <Show when={isGit()}>
            <GitSettingsForm
              provider={gitProvider()}
              token={gitToken()}
              owner={gitOwner()}
              repo={gitRepo()}
              projectId={gitProjectId()}
              branch={gitBranch()}
              basePath={gitBasePath()}
              apiBase={gitApiBase()}
              oauthClientId={gitOAuthClientId()}
              showAdvanced={showGitAdvanced()}
              oauthBusy={oauthBusy()}
              oauthUserCode={oauthUserCode()}
              oauthVerifyUri={oauthVerifyUri()}
              oauthHint={oauthHint()}
              oauthLogin={oauthLogin()}
              busy={busy()}
              onProvider={(provider) => {
                cancelOauth();
                setGitProvider(provider);
              }}
              onToken={setGitToken}
              onOwner={setGitOwner}
              onRepo={setGitRepo}
              onProjectId={setGitProjectId}
              onBranch={setGitBranch}
              onBasePath={setGitBasePath}
              onApiBase={setGitApiBase}
              onOauthClientId={setGitOAuthClientId}
              onToggleAdvanced={() => setShowGitAdvanced((v) => !v)}
              onConnect={() => void connectGitOAuth()}
              onDisconnect={disconnectGit}
              onCancelOauth={cancelOauth}
              onSave={() => persistGit()}
            />
          </Show>

          <form
            class="border border-border p-2 flex flex-col gap-2 bg-bg-elev rounded-md"
            onSubmit={(e) => {
              e.preventDefault();
              void onSave();
            }}
          >
            <div class="text-[10px] text-text-dim uppercase tracking-wider">Save current editor</div>
            <LibraryField label="Script name">
              <input
                class="sc-input"
                placeholder="Name"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                autocomplete="off"
              />
            </LibraryField>
            <LibraryField label="Description">
              <input
                class="sc-input"
                placeholder="Optional"
                value={desc()}
                onInput={(e) => setDesc(e.currentTarget.value)}
              />
            </LibraryField>
            <button
              type="submit"
              class="sc-btn sc-btn-primary inline-flex items-center gap-1 justify-center"
              disabled={busy()}
              data-testid="axis-library-save"
            >
              <Icons.save size={13} />
              {isGit() ? 'Save & commit' : 'Save to library'}
            </button>
            <button
              type="button"
              class="sc-btn sc-btn-ghost inline-flex items-center gap-1 justify-center"
              disabled={busy()}
              onClick={() => void onPublish()}
              title='Publish library() as the next version folder (1, 2, 3, …) — importable as import ns/Name/ver'
              data-testid="axis-library-publish"
            >
              Publish library
            </button>
            <Show when={lastImport()}>
              <p
                class="m-0 font-mono text-[10px] text-accent break-all"
                data-testid="axis-library-import-snippet"
              >
                {lastImport()}
              </p>
            </Show>
            <p class="m-0 text-[9px] text-text-faint">
              A successful Run of a <code class="font-mono">library()</code> also auto-publishes the
              next version (skips if unchanged). Git storage writes
              <code class="font-mono"> published/ns/Name/N/lib.pyne</code>.
            </p>
          </form>

          <div class="flex gap-1.5 flex-wrap">
            <button
              type="button"
              class="sc-btn sc-btn-ghost text-[10px] inline-flex items-center gap-1"
              onClick={() => void refresh()}
              disabled={busy()}
            >
              {busy() ? <HooxLoader size="xs" /> : <Icons.refresh size={12} />}
              Refresh
            </button>
            <button
              type="button"
              class="sc-btn sc-btn-ghost text-[10px]"
              onClick={() => void onExport()}
            >
              Export JSON
            </button>
            <button
              type="button"
              class="sc-btn sc-btn-ghost text-[10px]"
              onClick={() => fileInput?.click()}
              title="Import .pyne / .pine files or library JSON"
            >
              Import…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json,.pyne,.pine,.pinescript,.pinev5,.pinev6,text/plain"
              multiple
              class="hidden"
              aria-label="Import scripts"
              onChange={(e) => void onImportFile(e)}
            />
          </div>

          <Show when={published().length > 0}>
            <section class="flex flex-col gap-1" aria-label="Published libraries">
              <h3 class="sc-section-title m-0">
                Published ({published().length})
              </h3>
              <ul class="m-0 p-0 list-none flex flex-col gap-1">
                <For each={published()}>
                  {(p) => (
                    <li class="font-mono text-[10px] text-text-dim border border-border px-2 py-1 flex items-center gap-2">
                      <span class="min-w-0 flex-1 truncate">
                        {p.namespace}/{p.name}/{p.version}
                        <span class="text-text-faint"> · {p.origin}</span>
                      </span>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost px-1 py-0 text-[9px] flex-shrink-0"
                        aria-label={`Copy import for ${p.namespace}/${p.name}/${p.version}`}
                        onClick={() => copyImport(formatImportSnippet(p))}
                      >
                        <Icons.copy size={11} />
                        copy import
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>

          <section class="flex flex-col gap-1" aria-label="Personal scripts">
            <div class="flex items-baseline justify-between gap-2">
              <h3 class="sc-section-title m-0">Library ({personalShown().length})</h3>
            </div>
            <Show when={items().length > 0}>
              {/* biome-ignore lint/a11y/useSemanticElements: chip row; fieldset default styles break the compact toolbar */}
              <div class="sc-chip-row" role="group" aria-label="Personal library filters">
                <button
                  type="button"
                  class={`sc-chip ${sort() === 'recent' ? 'is-active' : ''}`}
                  aria-pressed={sort() === 'recent'}
                  data-testid="axis-library-sort-recent"
                  onClick={() => setSort((s) => (s === 'recent' ? 'stored' : 'recent'))}
                >
                  Recent
                </button>
                <For each={kindFilters()}>
                  {(f) => (
                    <button
                      type="button"
                      class={`sc-chip inline-flex items-center gap-1 ${kind() === f.id ? 'is-active' : ''}`}
                      aria-pressed={kind() === f.id}
                      data-testid={`axis-library-filter-${f.id}`}
                      onClick={() => setKind(f.id)}
                    >
                      {f.label}
                      <span class="tabular-nums text-[0.9em] opacity-70">{kindCounts()[f.id]}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show
              when={items().length > 0}
              fallback={
                <div class="axis-empty-state text-[12px] text-text-dim py-2">
                  No scripts yet. Save the editor document, or import a .pyne file.
                </div>
              }
            >
              <Show
                when={personalShown().length > 0}
                fallback={
                  <div class="axis-empty-state text-[12px] text-text-dim py-2">
                    No scripts match this filter.
                  </div>
                }
              >
                <ul
                  class="flex flex-col gap-1 w-full text-left items-stretch m-0 p-0 list-none"
                  data-testid="axis-library-script-list"
                  data-sort={sort()}
                >
                  <For each={personalShown()}>
                    {(item) => (
                      <LibraryScriptCard
                        item={item}
                        busy={busy()}
                        versioning={versioning()}
                        onLoad={() => void onLoad(item.id)}
                        onDelete={() => void onDelete(item.id, item.name)}
                        onLoadVersion={(payload) => {
                          props.setDoc?.(payload.content, payload.name, payload.libraryId);
                          props.onLoaded?.(
                            {
                              id: payload.libraryId,
                              name: payload.name,
                              updatedAt: Date.now(),
                            },
                            payload.content,
                          );
                        }}
                        onRestored={() => void refresh()}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </section>
        </div>
      </Show>
    </div>
  );
};

/**
 * Dockable / floatable Script Library panel (panel id `library`).
 * Same body as Plugin Manager → Script Library, with FloatableShell chrome.
 * This is the only copy that consumes Find / Recent palette commands.
 */
export const LibraryPanel: Component<ScriptLibraryPanelProps> = (props) => (
  <Show when={isPanelOpen('library')}>
    <FloatableShell id="library" testId="axis-library">
      <div class="flex-1 overflow-y-auto min-h-0">
        <ScriptLibraryPanel
          getDoc={props.getDoc}
          setDoc={props.setDoc}
          onLoaded={props.onLoaded}
          commands
        />
      </div>
    </FloatableShell>
  </Show>
);

