// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
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
 * (topbar **Library**). Pass `commands` so the docked panel handles
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
import { listPublishedLibraries, publishLibrary } from '../storage/library-publish-io';
import {
  formatImportSnippet,
  parseLibraryDeclaration,
  type PublishedIndex,
} from '../storage/library-publish';
import { listStorages } from '../storage/catalog';
import { store, setStore, persist, appendLog, setStatus, isPanelOpen } from '../store';
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
  getBuiltinScript,
  listBuiltinCategories,
  type BuiltinScript,
} from '../indicators/builtins';
import { Icons } from './icons';
import { HooxLoader } from './HooxLoader';
import { FloatableShell } from './panels/FloatableShell';
import { announce, announceError } from './sr-announce';
import { copyToClipboard } from './clipboard';
import { BuiltinScriptCard, LibraryScriptCard } from './library/cards';
import { CloudSettingsForm } from './library/CloudForm';
import { takeLibraryCommand, type LibraryCommand } from './library/commands';
import {
  countScriptsByKind,
  filterPersonalScripts,
  pinnedFirst,
  sortPersonalScripts,
  suggestScriptName,
  visibleKindFilters,
  type ScriptKindFilter,
  type ScriptSort,
} from './library/format';
import {
  clearRecentBuiltinIds,
  noteRecentBuiltinId,
  readFavoriteIds,
  readRecentBuiltinIds,
  toggleFavoriteId,
} from './library/prefs';
import { GitSettingsForm } from './library/GitForm';
import { bindSlashToSearch } from './focus-search';

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
/** Props for the library browser: editor doc IO and whether to consume palette commands. */
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

/**
 * Library browser body (built-in catalog + personal scripts) usable inside
 * Plugin Manager or the docked panel. Mounting a second copy without
 * `commands` avoids stealing buffered Find / Recent intents from the docked one.
 */
export const ScriptLibraryPanel: Component<ScriptLibraryPanelProps> = (props): JSX.Element => {
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
  const [favoriteIds, setFavoriteIds] = createSignal<string[]>(readFavoriteIds());
  const [recentIds, setRecentIds] = createSignal<string[]>(readRecentBuiltinIds());
  const [collapsedGroups, setCollapsedGroups] = createSignal<ReadonlySet<string>>(new Set());
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [activeScriptId, setActiveScriptId] = createSignal('');
  const [storageConnected, setStorageConnected] = createSignal(true);

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
  const [gitOAuthClientId, setGitOAuthClientId] = createSignal(String(g0.oauthClientId || ''));
  const [showGitAdvanced, setShowGitAdvanced] = createSignal(false);
  const [oauthBusy, setOauthBusy] = createSignal(false);
  const [oauthUserCode, setOauthUserCode] = createSignal('');
  const [oauthVerifyUri, setOauthVerifyUri] = createSignal('');
  const [oauthHint, setOauthHint] = createSignal('');
  const [oauthLogin, setOauthLogin] = createSignal('');
  let oauthAbort: AbortController | null = null;
  let fileInput: HTMLInputElement | undefined;
  let findInput: HTMLInputElement | undefined;
  let nameInput: HTMLInputElement | undefined;

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
    // `/` focuses the library search while the panel is mounted. Ignore when
    // typing in any field so the shortcut never eats a literal slash.
    onCleanup(bindSlashToSearch(() => findInput));

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
    const sameOrigin = typeof window !== 'undefined' ? window.location.origin : '';
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
      setStorageConnected(st.connected !== false);
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
    pinnedFirst(
      sortPersonalScripts(filterPersonalScripts(items(), query(), kind()), sort()),
      favoriteIds(),
    ),
  );

  const favoriteSet = createMemo(() => new Set(favoriteIds()));
  const isFavorite = (id: string) => favoriteSet().has(id);

  /** Built-ins grouped by category in catalog order, filtered by the shared search. */
  const builtinGroups = createMemo(() => {
    const filtered = filterBuiltinScripts(query()).filter((s) => !favoriteSet().has(s.id));
    const groups: { category: string; label: string; items: BuiltinScript[] }[] = [];
    for (const category of listBuiltinCategories()) {
      const inCat = filtered.filter((s) => s.category === category);
      if (!inCat.length) continue;
      groups.push({ category, label: builtinCategoryLabel(category), items: inCat });
    }
    return groups;
  });
  /** Pinned built-ins get their own group at the top of the catalog. */
  const pinnedBuiltins = createMemo(() =>
    filterBuiltinScripts(query()).filter((s) => favoriteSet().has(s.id)),
  );
  /** Quick re-apply strip — hidden while searching or when everything is pinned. */
  const recentBuiltins = createMemo(() => {
    if (query().trim()) return [];
    const out: BuiltinScript[] = [];
    for (const id of recentIds()) {
      const item = getBuiltinScript(id);
      if (item && !favoriteSet().has(id)) out.push(item);
    }
    return out;
  });
  const builtinCount = createMemo(() => filterBuiltinScripts(query()).length);
  /** Chart scripts by title — powers the “applied” chip on builtin cards. */
  const appliedTitles = createMemo(() => new Set(store.scripts.map((s) => s.name)));
  const otherCatalog = createMemo(() => {
    const q = query().trim();
    if (!q) return null;
    if (tab() === 'builtin') {
      const n = filterPersonalScripts(items(), q, 'all').length;
      return n > 0 ? { next: 'personal' as const, label: `${n} in Personal` } : null;
    }
    const n = filterBuiltinScripts(q).length;
    return n > 0 ? { next: 'builtin' as const, label: `${n} built-in${n === 1 ? '' : 's'}` } : null;
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
      setActiveScriptId('');
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
      setActiveScriptId(doc.id);
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
      const applied = await applyBuiltinScript(b.id);
      if (applied.status === 'error') {
        const msg = applied.error || `Could not apply "${b.title}"`;
        setError(msg);
        return;
      }
      setRecentIds(noteRecentBuiltinId(b.id));
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
    setActiveScriptId('');
    setStatus('ready', `Opened built-in "${b.title}" (save to keep it)`);
    announce(`Opened ${b.title} in the editor`);
    appendLog('info', `Opened built-in script ${b.title} in editor`, 'library');
  };

  const onDelete = async (id: string, scriptName: string) => {
    if (!confirm(`Delete "${scriptName}"?`)) return;
    setBusy(true);
    try {
      await removeScript(id);
      if (activeScriptId() === id) setActiveScriptId('');
      announce(`Deleted ${scriptName}`);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onToggleFavorite = (id: string) => {
    setFavoriteIds(toggleFavoriteId(id, favoriteIds()));
  };

  const onClearRecent = () => {
    setRecentIds(clearRecentBuiltinIds());
    announce('Cleared recent built-ins');
  };

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onCopyScript = async (item: ScriptMeta) => {
    try {
      const doc = await readScript(item.id);
      if (await copyToClipboard(doc.content)) {
        setStatus('ready', `Copied Pine from "${item.name}"`);
        announce(`Copied ${item.name} source`);
      } else {
        announceError('Could not copy script');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDuplicateScript = async (item: ScriptMeta) => {
    setBusy(true);
    setError('');
    try {
      const doc = await readScript(item.id);
      const copyName = `${item.name} copy`;
      await writeScript({
        id: `s_${Date.now().toString(36)}`,
        name: copyName,
        description: item.description,
        content: doc.content,
      });
      setStatus('ready', `Duplicated "${item.name}" as "${copyName}"`);
      announce(`Created ${copyName}`);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Prefill the save name from the editor's `indicator()` / `strategy()` title. */
  const onNameFocus = () => {
    if (name().trim()) return;
    const suggested = suggestScriptName(props.getDoc?.() ?? '');
    if (suggested) setName(suggested);
  };

  const editorLineCount = () => {
    const doc = props.getDoc?.() ?? '';
    return doc ? doc.split('\n').length : 0;
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
      const jsonFiles = files.filter((f) => !isPyneFileName(f.name) && /\.json$/i.test(f.name));
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
      ...(gitOAuthClientId().trim() ? { oauthClientId: gitOAuthClientId().trim() } : {}),
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
      const verifyRaw = started.verification_uri_complete || started.verification_uri;
      // startDeviceFlow already sanitizes; belt-and-suspenders for open/href
      const verifySafe = sanitizeVerificationUri(verifyRaw, provider) || started.verification_uri;
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

  const builtinCard = (b: BuiltinScript) => (
    <BuiltinScriptCard
      item={b}
      busy={!!applyingBuiltin() || busy()}
      applying={applyingBuiltin() === b.id}
      applied={appliedTitles().has(b.title)}
      favorite={isFavorite(b.id)}
      onToggleFavorite={() => onToggleFavorite(b.id)}
      query={query()}
      onApply={() => void onApplyBuiltin(b)}
      onEdit={() => onEditBuiltin(b)}
    />
  );

  const focusSaveName = () => {
    queueMicrotask(() => {
      nameInput?.focus();
      nameInput?.select();
    });
  };

  return (
    <div class="ax-library flex flex-col gap-2 text-[12px]" aria-busy={busy()}>
      {/* ── Sticky command bar ─────────────────────────────────────── */}
      <div class="ax-library-toolbar">
        <div class="ax-library-search">
          <Icons.search size={13} />
          <input
            ref={findInput}
            type="search"
            class="ax-library-search-input"
            placeholder="Find scripts… (rsi, macd, name)"
            aria-label="Find across scripts"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query()) {
                e.preventDefault();
                setQuery('');
              }
            }}
            data-testid="axis-library-builtin-search"
            autocomplete="off"
            spellcheck={false}
          />
          <Show when={query()} fallback={<kbd class="ax-library-kbd">/</kbd>}>
            <button
              type="button"
              class="ax-library-search-clear"
              aria-label="Clear search"
              title="Clear search (Esc)"
              onClick={() => {
                setQuery('');
                findInput?.focus();
              }}
            >
              <Icons.x size={11} />
            </button>
          </Show>
        </div>

        <div class="ax-library-tabs" role="tablist" aria-label="Script library">
          <button
            type="button"
            id={`${uid}-tab-builtin`}
            role="tab"
            aria-selected={tab() === 'builtin'}
            aria-controls={`${uid}-panel-builtin`}
            class="ax-library-tab"
            classList={{ 'is-on': tab() === 'builtin' }}
            onClick={() => setTab('builtin')}
            data-testid="axis-library-tab-builtin"
          >
            <Icons.library size={12} />
            Builtin
            <span class="ax-library-tab-count">
              {query().trim() ? builtinCount() : BUILTIN_SCRIPTS.length}
            </span>
          </button>
          <button
            type="button"
            id={`${uid}-tab-personal`}
            role="tab"
            aria-selected={tab() === 'personal'}
            aria-controls={`${uid}-panel-personal`}
            class="ax-library-tab"
            classList={{ 'is-on': tab() === 'personal' }}
            onClick={() => setTab('personal')}
            data-testid="axis-library-tab-personal"
          >
            <Icons.folder size={12} />
            Personal
            <span class="ax-library-tab-count">
              {query().trim() || kind() !== 'all' ? personalShown().length : items().length}
            </span>
          </button>
        </div>

        <Show when={otherCatalog()}>
          {(hint) => (
            <button
              type="button"
              class="ax-library-other"
              onClick={() => setTab(hint().next)}
              title={`Show the ${hint().next} tab`}
            >
              Also {hint().label}
              <Icons.arrowRight size={11} />
            </button>
          )}
        </Show>
      </div>

      <Show when={error()}>
        <p class="ax-library-error" role="alert">
          {error()}
        </p>
      </Show>

      {/* ── Builtin ────────────────────────────────────────────────── */}
      <Show when={tab() === 'builtin'}>
        <div
          class="ax-library-panel"
          role="tabpanel"
          id={`${uid}-panel-builtin`}
          aria-labelledby={`${uid}-tab-builtin`}
          data-testid="axis-library-builtin-list"
        >
          <Show when={recentBuiltins().length > 0}>
            {/* biome-ignore lint/a11y/useSemanticElements: compact recent chip strip; fieldset default styles break the panel toolbar */}
            <div class="ax-library-recent" role="group" aria-label="Recently applied built-ins">
              <span class="ax-library-recent-label">
                <Icons.clock size={10} /> Recent
              </span>
              <div class="ax-library-recent-chips">
                <For each={recentBuiltins()}>
                  {(b) => (
                    <button
                      type="button"
                      class="ax-library-recent-chip"
                      title={`Apply ${b.title} again`}
                      onClick={() => void onApplyBuiltin(b)}
                    >
                      <Icons.play size={9} />
                      {b.title}
                    </button>
                  )}
                </For>
              </div>
              <button
                type="button"
                class="ax-library-recent-clear"
                title="Clear recent built-ins"
                aria-label="Clear recent built-ins"
                onClick={onClearRecent}
              >
                <Icons.x size={10} />
              </button>
            </div>
          </Show>

          <Show
            when={builtinCount() > 0}
            fallback={
              <div class="ax-library-empty">
                <span class="ax-library-empty-icon">
                  <Icons.search size={18} />
                </span>
                <p class="ax-library-empty-title">No built-ins match “{query()}”</p>
                <p class="ax-library-empty-sub">
                  Try a shorter term, a kind (rsi), or a category (volume).
                </p>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost ax-library-empty-btn"
                  onClick={() => setQuery('')}
                >
                  Clear search
                </button>
              </div>
            }
          >
            <Show when={pinnedBuiltins().length > 0}>
              <section class="ax-library-group" aria-label="Pinned">
                <button
                  type="button"
                  class="ax-library-group-head"
                  aria-expanded={!collapsedGroups().has('pinned')}
                  onClick={() => toggleGroup('pinned')}
                >
                  <Icons.chevronDown
                    size={12}
                    class={`ax-library-chevron${collapsedGroups().has('pinned') ? '' : ' is-open'}`}
                  />
                  <Icons.favorite size={11} class="ax-library-group-star" />
                  <span class="ax-library-group-title">Pinned</span>
                  <span class="ax-library-group-count">{pinnedBuiltins().length}</span>
                </button>
                <Show when={!collapsedGroups().has('pinned')}>
                  <ul class="ax-library-list">
                    <For each={pinnedBuiltins()}>{(b) => builtinCard(b)}</For>
                  </ul>
                </Show>
              </section>
            </Show>

            <For each={builtinGroups()}>
              {(group) => (
                <section class="ax-library-group" aria-label={group.label}>
                  <button
                    type="button"
                    class="ax-library-group-head"
                    aria-expanded={!collapsedGroups().has(group.category)}
                    onClick={() => toggleGroup(group.category)}
                  >
                    <Icons.chevronDown
                      size={12}
                      class={`ax-library-chevron${
                        collapsedGroups().has(group.category) ? '' : ' is-open'
                      }`}
                    />
                    <span class="ax-library-group-title">{group.label}</span>
                    <span class="ax-library-group-count">{group.items.length}</span>
                  </button>
                  <Show when={!collapsedGroups().has(group.category)}>
                    <ul class="ax-library-list">
                      <For each={group.items}>{(b) => builtinCard(b)}</For>
                    </ul>
                  </Show>
                </section>
              )}
            </For>
          </Show>

          <p class="ax-library-foot">
            First-party AXIS originals. <strong>Apply</strong> runs one onto the chart;{' '}
            <strong>Edit</strong> opens its Pine in the editor (then save it under Personal to keep
            a copy).
          </p>
        </div>
      </Show>

      {/* ── Personal ───────────────────────────────────────────────── */}
      <Show when={tab() === 'personal'}>
        <div
          class="ax-library-panel"
          role="tabpanel"
          id={`${uid}-panel-personal`}
          aria-labelledby={`${uid}-tab-personal`}
        >
          <div class="ax-library-storage">
            <label class="ax-library-storage-label" for={`${uid}-storage`}>
              Storage
            </label>
            <select
              id={`${uid}-storage`}
              class="sc-input ax-library-select"
              value={backend()}
              onChange={(e) => promptStorageChange(getActiveStorageId(), e.currentTarget.value)}
              title="Where user Pine scripts are stored"
              data-testid="axis-library-storage"
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
            <div class="ax-library-storage-actions">
              <button
                type="button"
                class="ax-library-action"
                title="Refresh the library"
                aria-label="Refresh the library"
                disabled={busy()}
                onClick={() => void refresh()}
              >
                {busy() ? <HooxLoader size="xs" /> : <Icons.refresh size={12} />}
              </button>
              <button
                type="button"
                class="ax-library-action"
                title="Export library JSON"
                aria-label="Export library JSON"
                onClick={() => void onExport()}
              >
                <Icons.download size={12} />
              </button>
              <button
                type="button"
                class="ax-library-action"
                title="Import .pyne / .pine files or library JSON"
                aria-label="Import scripts"
                onClick={() => fileInput?.click()}
              >
                <Icons.upload size={12} />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json,.pyne,.pine,.pinescript,.pinev5,.pinev6,text/plain"
                multiple
                class="hidden"
                aria-label="Import script files"
                onChange={(e) => void onImportFile(e)}
              />
            </div>
          </div>

          <div class="ax-library-status" role="status">
            <span
              class="ax-library-dot"
              classList={{ 'is-off': !storageConnected() }}
              aria-hidden="true"
            />
            <span class="ax-library-status-text">{statusLine() || (busy() ? 'Loading…' : '')}</span>
          </div>

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
            class="ax-library-save"
            onSubmit={(e) => {
              e.preventDefault();
              void onSave();
            }}
          >
            <div class="ax-library-save-head">
              <span class="ax-library-save-title">
                <Icons.save size={12} /> Save current editor
              </span>
              <span class="ax-library-save-lines">{editorLineCount()} lines</span>
            </div>
            <div class="ax-library-save-row">
              <input
                ref={nameInput}
                class="sc-input ax-library-name"
                placeholder="Script name"
                value={name()}
                onFocus={onNameFocus}
                onInput={(e) => setName(e.currentTarget.value)}
                autocomplete="off"
                aria-label="Script name"
              />
              <button
                type="submit"
                class="sc-btn sc-btn-primary ax-library-save-btn"
                disabled={busy()}
                data-testid="axis-library-save"
              >
                <Icons.save size={12} />
                {isGit() ? 'Save & commit' : 'Save to library'}
              </button>
            </div>
            <button
              type="button"
              class="ax-library-details-toggle"
              aria-expanded={detailsOpen()}
              onClick={() => setDetailsOpen((v) => !v)}
            >
              {detailsOpen() ? 'Hide details' : 'Description · publish'}
              <Icons.chevronDown
                size={11}
                class={`ax-library-chevron${detailsOpen() ? ' is-open' : ''}`}
              />
            </button>
            <Show when={detailsOpen()}>
              <input
                class="sc-input"
                placeholder="Description (optional)"
                value={desc()}
                onInput={(e) => setDesc(e.currentTarget.value)}
                aria-label="Script description"
              />
              <button
                type="button"
                class="sc-btn sc-btn-ghost ax-library-publish"
                disabled={busy()}
                onClick={() => void onPublish()}
                title="Publish library() as the next version folder (1, 2, 3, …) — importable as import ns/Name/ver"
                data-testid="axis-library-publish"
              >
                <Icons.upload size={12} />
                Publish library
              </button>
              <Show when={lastImport()}>
                <p class="ax-library-import" data-testid="axis-library-import-snippet">
                  {lastImport()}
                </p>
              </Show>
              <p class="ax-library-foot">
                A successful Run of a <code class="font-mono">library()</code> also auto-publishes
                the next version (skips if unchanged). Git storage writes{' '}
                <code class="font-mono">published/ns/Name/N/lib.pyne</code>.
              </p>
            </Show>
          </form>

          <Show when={published().length > 0}>
            <section class="ax-library-group" aria-label="Published libraries">
              <button
                type="button"
                class="ax-library-group-head"
                aria-expanded={!collapsedGroups().has('published')}
                onClick={() => toggleGroup('published')}
              >
                <Icons.chevronDown
                  size={12}
                  class={`ax-library-chevron${
                    collapsedGroups().has('published') ? '' : ' is-open'
                  }`}
                />
                <span class="ax-library-group-title">Published</span>
                <span class="ax-library-group-count">{published().length}</span>
              </button>
              <Show when={!collapsedGroups().has('published')}>
                <ul class="ax-library-published">
                  <For each={published()}>
                    {(p) => (
                      <li class="ax-library-published-row">
                        <span
                          class="ax-library-published-name"
                          title={`${p.namespace}/${p.name}/${p.version}`}
                        >
                          {p.namespace}/<strong>{p.name}</strong>/{p.version}
                          <span class="ax-library-published-origin">{p.origin}</span>
                        </span>
                        <button
                          type="button"
                          class="ax-library-action"
                          aria-label={`Copy import for ${p.namespace}/${p.name}/${p.version}`}
                          title="Copy import statement"
                          onClick={() => copyImport(formatImportSnippet(p))}
                        >
                          <Icons.copy size={11} />
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
          </Show>

          <section class="ax-library-group" aria-label="Personal scripts">
            <div class="ax-library-list-head">
              <span class="ax-library-group-title">Library</span>
              <span class="ax-library-group-count">{personalShown().length}</span>
              <span class="ax-library-spacer" />
              <Show when={items().length > 0}>
                {/* biome-ignore lint/a11y/useSemanticElements: compact sort chip row; fieldset default styles break the panel toolbar */}
                <div class="ax-library-sort" role="group" aria-label="Sort scripts">
                  <button
                    type="button"
                    class="ax-library-sort-btn"
                    classList={{ 'is-on': sort() === 'recent' }}
                    aria-pressed={sort() === 'recent'}
                    data-testid="axis-library-sort-recent"
                    title="Newest updated first"
                    onClick={() => setSort('recent')}
                  >
                    <Icons.clock size={10} /> Recent
                  </button>
                  <button
                    type="button"
                    class="ax-library-sort-btn"
                    classList={{ 'is-on': sort() === 'name' }}
                    aria-pressed={sort() === 'name'}
                    data-testid="axis-library-sort-name"
                    title="Alphabetical by name"
                    onClick={() => setSort('name')}
                  >
                    <Icons.type size={10} /> Name
                  </button>
                  <button
                    type="button"
                    class="ax-library-sort-btn"
                    classList={{ 'is-on': sort() === 'stored' }}
                    aria-pressed={sort() === 'stored'}
                    data-testid="axis-library-sort-stored"
                    title="Storage order"
                    onClick={() => setSort('stored')}
                  >
                    <Icons.database size={10} /> Storage
                  </button>
                </div>
              </Show>
            </div>

            <Show when={items().length > 0}>
              {/* biome-ignore lint/a11y/useSemanticElements: compact filter chip row; fieldset default styles break the panel toolbar */}
              <div class="ax-library-filters" role="group" aria-label="Personal library filters">
                <For each={kindFilters()}>
                  {(f) => (
                    <button
                      type="button"
                      class="ax-library-filter"
                      classList={{ 'is-on': kind() === f.id }}
                      aria-pressed={kind() === f.id}
                      data-testid={`axis-library-filter-${f.id}`}
                      onClick={() => setKind(f.id)}
                    >
                      {f.label}
                      <span class="ax-library-filter-count">{kindCounts()[f.id]}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <Show
              when={items().length > 0}
              fallback={
                <div class="ax-library-empty">
                  <span class="ax-library-empty-icon">
                    <Icons.library size={18} />
                  </span>
                  <p class="ax-library-empty-title">No scripts yet</p>
                  <p class="ax-library-empty-sub">
                    Save the editor document, or import <code>.pyne</code> / <code>.pine</code>{' '}
                    files.
                  </p>
                  <div class="ax-library-empty-actions">
                    <button
                      type="button"
                      class="sc-btn sc-btn-primary ax-library-empty-btn"
                      onClick={focusSaveName}
                      data-testid="axis-library-empty-save"
                    >
                      <Icons.save size={12} /> Save current editor
                    </button>
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost ax-library-empty-btn"
                      onClick={() => fileInput?.click()}
                      data-testid="axis-library-empty-import"
                    >
                      <Icons.upload size={12} /> Import…
                    </button>
                  </div>
                </div>
              }
            >
              <Show
                when={personalShown().length > 0}
                fallback={
                  <div class="ax-library-empty">
                    <span class="ax-library-empty-icon">
                      <Icons.search size={18} />
                    </span>
                    <p class="ax-library-empty-title">No scripts match this filter</p>
                    <p class="ax-library-empty-sub">Clear the search or pick another kind.</p>
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost ax-library-empty-btn"
                      onClick={() => {
                        setQuery('');
                        setKind('all');
                      }}
                    >
                      Reset filters
                    </button>
                  </div>
                }
              >
                <ul
                  class="ax-library-list"
                  data-testid="axis-library-script-list"
                  data-sort={sort()}
                >
                  <For each={personalShown()}>
                    {(item) => (
                      <LibraryScriptCard
                        item={item}
                        busy={busy()}
                        versioning={versioning()}
                        query={query()}
                        favorite={isFavorite(item.id)}
                        onToggleFavorite={() => onToggleFavorite(item.id)}
                        active={activeScriptId() === item.id}
                        onLoad={() => void onLoad(item.id)}
                        onDelete={() => void onDelete(item.id, item.name)}
                        onCopy={() => void onCopyScript(item)}
                        onDuplicate={() => void onDuplicateScript(item)}
                        onLoadVersion={(payload) => {
                          props.setDoc?.(payload.content, payload.name, payload.libraryId);
                          setActiveScriptId(payload.libraryId);
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
export const LibraryPanel: Component<ScriptLibraryPanelProps> = (props): JSX.Element => (
  <Show when={isPanelOpen('library')}>
    <FloatableShell id="library" testId="axis-library">
      <ScriptLibraryPanel
        getDoc={props.getDoc}
        setDoc={props.setDoc}
        onLoaded={props.onLoaded}
        commands
      />
    </FloatableShell>
  </Show>
);
