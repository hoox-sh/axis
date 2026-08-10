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
 * Uses `storage/service` (listScripts, writeScript, …). Includes cloud/git
 * credential mini-forms and import/export (library JSON or `.pyne` / `.pine` files).
 * Optional `getDoc` / `setDoc` wire the panel to the live editor document.
 *
 * {@link LibraryPanel} docks the same content in a floatable chrome panel
 * (topbar **Library**). Plugin Manager still embeds {@link ScriptLibraryPanel}
 * content without chrome.
 *
 * App-wide drag-and-drop of `.pyne` / `.pine` files is handled in `app.tsx`
 * (same import path).
 */

import { Component, For, Show, createSignal, createEffect } from 'solid-js';
import type { ScriptMeta, ScriptVersion } from '../plugins/types';
import {
  listScripts,
  readScript,
  writeScript,
  removeScript,
  exportLibraryJson,
  importLibraryJson,
  getStorageStatus,
  supportsScriptVersioning,
  listScriptVersions,
  readScriptVersion,
  restoreScriptVersion,
} from '../storage/service';
import { importPyneFiles, isPyneFileName } from '../storage/import-pyne-files';
import { listStorages } from '../storage/catalog';
import {
  setActivePlugin,
  store,
  setStore,
  persist,
  appendLog,
  setStatus,
  isPanelOpen,
} from '../store';
import { pluginKey } from '../plugins/types';
import { DEFAULT_GIT_CONFIG, type GitConfig } from '../storage/git-config';
import {
  fetchGitUser,
  isOAuthProxyBase,
  manualTokenCreateUrl,
  resolveOAuthProxyBase,
  sanitizeVerificationUri,
  startDeviceFlow,
  waitForDeviceToken,
} from '../storage/git-oauth';
import {
  formatScriptUpdatedAt,
  scriptKindLabel,
  scriptKindShort,
  type ScriptKind,
} from '../indicators/script-meta';
import { Icons } from './icons';
import { HooxLoader } from './HooxLoader';
import { FloatableShell } from './panels/FloatableShell';

/** Kind chip colors for library cards. */
function kindChipClass(kind: ScriptKind): string {
  switch (kind) {
    case 'strategy':
      return 'border-accent-2/45 text-accent-2 bg-accent-2/10';
    case 'library':
      return 'border-border text-text-dim bg-bg/50';
    case 'indicator':
      return 'border-accent/45 text-accent bg-accent/10';
    default:
      return 'border-border/50 text-text-faint bg-bg/30';
  }
}

function shortRev(rev?: string): string {
  if (!rev) return '';
  // Blob/file shas and commit ids — show 7 chars when long enough
  return rev.length > 10 ? rev.slice(0, 7) : rev;
}

/** One library row — name, kind, Pine version, last updated, optional git history. */
const LibraryScriptCard: Component<{
  item: ScriptMeta;
  busy?: boolean;
  /** Git storage active — show commit history controls. */
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

  const kind = (): ScriptKind =>
    (props.item.scriptKind as ScriptKind) || 'unknown';
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
      class="flex flex-col gap-1 border-2 border-border bg-bg-elev px-2 py-1.5 rounded-[var(--radius-chip)]"
      data-testid="axis-library-script-card"
      data-script-kind={kind()}
      data-pine-version={props.item.pineVersion || undefined}
    >
      <div class="flex items-start gap-2">
        <div class="flex-1 min-w-0">
          <div
            class="text-text font-medium truncate text-[12px]"
            title={props.item.name}
          >
            {props.item.name}
          </div>
          <div
            class="flex flex-wrap items-center gap-1 mt-1"
            data-testid="axis-library-script-meta"
          >
            <span
              class={`inline-flex items-center px-1 py-px border font-mono text-[9px] uppercase tracking-wide rounded-[var(--radius-chip)] ${kindChipClass(kind())}`}
              title={
                kind() === 'strategy'
                  ? 'Pine strategy()'
                  : kind() === 'library'
                    ? 'Pine library()'
                    : kind() === 'indicator'
                      ? 'Pine indicator()'
                      : 'Script kind not detected'
              }
              data-testid="axis-library-kind"
            >
              {scriptKindShort(kind())}
              <span class="sr-only"> {scriptKindLabel(kind())}</span>
            </span>
            <Show when={versionLabel()}>
              <span
                class="inline-flex items-center px-1 py-px border border-border/50 font-mono text-[9px] text-text-dim rounded-[var(--radius-chip)]"
                title={`Pine //@version=${props.item.pineVersion}`}
                data-testid="axis-library-version"
              >
                {versionLabel()}
              </span>
            </Show>
            <Show when={revLabel()}>
              <span
                class="inline-flex items-center px-1 py-px border border-border/40 font-mono text-[9px] text-text-faint rounded-[var(--radius-chip)]"
                title={`Git revision ${props.item.revision}`}
                data-testid="axis-library-git-rev"
              >
                {revLabel()}
              </span>
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
            title="Git commit history"
            aria-pressed={historyOpen()}
            aria-label="Toggle git history"
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
              Git history
            </span>
            <button
              type="button"
              class="sc-btn sc-btn-ghost text-[9px] px-1 py-0.5 inline-flex items-center gap-1"
              disabled={historyBusy()}
              onClick={() => void loadHistory()}
              title="Refresh commit list"
            >
              {historyBusy() ? <HooxLoader size="xs" /> : <Icons.refresh size={11} />}
              Refresh
            </button>
          </div>
          <Show when={historyErr()}>
            <p class="text-red font-mono text-[9px]">{historyErr()}</p>
          </Show>
          <Show
            when={!historyBusy() && versions().length === 0 && !historyErr()}
          >
            <p class="text-text-faint text-[9px]">No commits found for this file.</p>
          </Show>
          <Show when={historyBusy() && versions().length === 0}>
            <div class="flex items-center gap-1.5 text-text-faint text-[9px] py-1">
              <HooxLoader size="xs" /> Loading commits…
            </div>
          </Show>
          <ul class="flex flex-col gap-0.5 max-h-44 overflow-auto">
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
                    <div
                      class="text-[10px] text-text-dim truncate"
                      title={v.message}
                    >
                      {v.message}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1 py-0.5 text-[9px] flex-shrink-0"
                    title="Load this revision into the editor (does not push)"
                    disabled={!!actionSha() || props.busy}
                    onClick={() => void onLoadAt(v)}
                    data-testid="axis-library-history-load"
                  >
                    {actionSha() === v.sha ? '…' : 'Open'}
                  </button>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost px-1 py-0.5 text-[9px] flex-shrink-0"
                    title="Restore as new tip commit on the branch"
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

function cloudCfg(): { endpoint: string; apiKey: string } {
  const pc = store.pluginsConfig || {};
  const c = (pc[pluginKey('storage', 'cloud')] || pc['cloud'] || {}) as Record<string, unknown>;
  return {
    endpoint: String(c.endpoint || store.endpoint || 'http://127.0.0.1:8787'),
    apiKey: String(c.apiKey || ''),
  };
}

function saveCloudCfg(endpoint: string, apiKey: string) {
  const key = pluginKey('storage', 'cloud');
  setStore('pluginsConfig', key, { endpoint: endpoint.replace(/\/$/, ''), apiKey });
  persist();
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
}

/** Library browser for Plugin Manager (and any host that supplies doc IO). */
export const ScriptLibraryPanel: Component<ScriptLibraryPanelProps> = (props) => {
  const [items, setItems] = createSignal<ScriptMeta[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [name, setName] = createSignal('');
  const [desc, setDesc] = createSignal('');
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
      const st = await getStorageStatus();
      const parts = [
        backend(),
        st.remote,
        st.branch ? `@${st.branch}` : '',
        st.connected ? '' : 'offline',
        `${list.length} script(s)`,
      ].filter(Boolean);
      setStatusLine(parts.join(' · '));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
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
      setStatus(
        'ready',
        isGit() ? `Committed & saved "${n}" to git` : `Saved "${n}"`,
      );
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
      appendLog('ok', `Loaded library script ${doc.name}`, 'library');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const versioning = () => isGit() && supportsScriptVersioning();

  const onDelete = async (id: string, scriptName: string) => {
    if (!confirm(`Delete "${scriptName}"?`)) return;
    setBusy(true);
    try {
      await removeScript(id);
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
      setStatus(
        'ready',
        `Connected to ${provider === 'github' ? 'GitHub' : 'GitLab'}${
          login ? ` as ${login}` : ''
        }`,
      );
      appendLog('ok', `Git OAuth connected (${provider})`, 'git');
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

  return (
    <div class="flex flex-col gap-3 text-[11px]">
      <div class="sc-field">
        <label class="text-[10px] text-text-dim uppercase tracking-wider">Storage backend</label>
        <select
          class="sc-input"
          value={backend()}
          onChange={(e) => setActivePlugin('storage', e.currentTarget.value)}
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
        <p class="text-text-faint font-mono text-[10px]">{statusLine()}</p>
      </div>

      <Show when={isCloud()}>
        <div class="border-2 border-border p-2.5 flex flex-col gap-2 bg-bg-elev rounded-[var(--radius-sc)]">
          <div class="text-[10px] text-text-dim uppercase tracking-wider">Cloud credentials</div>
          <input
            class="sc-input font-mono text-[11px]"
            placeholder="Worker URL"
            value={cloudEndpoint()}
            onInput={(e) => setCloudEndpoint(e.currentTarget.value)}
            spellcheck={false}
          />
          <input
            class="sc-input font-mono text-[11px]"
            placeholder="API key (pn_…)"
            type="password"
            value={cloudKey()}
            onInput={(e) => setCloudKey(e.currentTarget.value)}
            spellcheck={false}
            autocomplete="off"
          />
          <button
            class="sc-btn sc-btn-ghost text-[10px]"
            onClick={() => {
              saveCloudCfg(cloudEndpoint(), cloudKey());
              void refresh();
            }}
          >
            Save cloud settings
          </button>
        </div>
      </Show>

      <Show when={isGit()}>
        <div
          class="border-2 border-border p-2.5 flex flex-col gap-2 bg-bg-elev rounded-[var(--radius-sc)]"
          data-testid="axis-git-settings"
        >
          <div class="text-[10px] text-text-dim uppercase tracking-wider">Git repository</div>
          <select
            class="sc-input"
            value={gitProvider()}
            onChange={(e) => {
              cancelOauth();
              setGitProvider(e.currentTarget.value as 'github' | 'gitlab');
            }}
            data-testid="axis-git-provider"
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>

          {/* OAuth connect */}
          <div class="flex flex-col gap-1.5">
            <Show
              when={gitToken().trim()}
              fallback={
                <div class="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    class="sc-btn sc-btn-primary text-[10px] inline-flex items-center gap-1"
                    data-testid="axis-git-connect"
                    disabled={oauthBusy() || busy()}
                    onClick={() => void connectGitOAuth()}
                    title="Authorize via device flow (Worker proxies forge OAuth)"
                  >
                    {oauthBusy() ? <HooxLoader size="xs" /> : <Icons.externalLink size={12} />}
                    Connect with {gitProvider() === 'github' ? 'GitHub' : 'GitLab'}
                  </button>
                  <a
                    class="sc-btn sc-btn-ghost text-[10px] inline-flex items-center gap-1 no-underline"
                    href={manualTokenCreateUrl(gitProvider())}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Create a personal access token in the browser"
                  >
                    Create token…
                  </a>
                </div>
              }
            >
              <div
                class="flex items-center gap-2 flex-wrap text-[10px]"
                data-testid="axis-git-connected"
              >
                <span class="text-accent-2 font-semibold">
                  Connected
                  <Show when={oauthLogin() || gitOwner()}>
                    {' '}
                    as {oauthLogin() || gitOwner()}
                  </Show>
                </span>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost text-[10px]"
                  data-testid="axis-git-disconnect"
                  onClick={disconnectGit}
                >
                  Disconnect
                </button>
              </div>
            </Show>

            <Show when={oauthBusy() && oauthUserCode()}>
              <div
                class="border border-border-soft p-2 rounded-[var(--radius-sm)] bg-bg-base flex flex-col gap-1"
                data-testid="axis-git-oauth-pending"
              >
                <p class="text-[10px] text-text-dim m-0">{oauthHint() || 'Waiting…'}</p>
                <p class="m-0 font-mono text-[13px] text-accent tracking-widest">
                  {oauthUserCode()}
                </p>
                <Show when={oauthVerifyUri()}>
                  <a
                    class="text-[10px] text-accent underline break-all"
                    href={oauthVerifyUri()}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open verification page
                  </a>
                </Show>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost text-[10px] self-start"
                  onClick={cancelOauth}
                >
                  Cancel
                </button>
              </div>
            </Show>
          </div>

          <div class="grid grid-cols-2 gap-1.5">
            <input
              class="sc-input font-mono text-[11px]"
              placeholder="owner / group"
              value={gitOwner()}
              onInput={(e) => setGitOwner(e.currentTarget.value)}
              spellcheck={false}
              data-testid="axis-git-owner"
            />
            <input
              class="sc-input font-mono text-[11px]"
              placeholder="repo"
              value={gitRepo()}
              onInput={(e) => setGitRepo(e.currentTarget.value)}
              spellcheck={false}
              data-testid="axis-git-repo"
            />
          </div>
          <Show when={gitProvider() === 'gitlab'}>
            <input
              class="sc-input font-mono text-[11px]"
              placeholder="project id (optional, e.g. group/repo)"
              value={gitProjectId()}
              onInput={(e) => setGitProjectId(e.currentTarget.value)}
              spellcheck={false}
            />
          </Show>
          <div class="grid grid-cols-2 gap-1.5">
            <input
              class="sc-input font-mono text-[11px]"
              placeholder="branch"
              value={gitBranch()}
              onInput={(e) => setGitBranch(e.currentTarget.value)}
              spellcheck={false}
            />
            <input
              class="sc-input font-mono text-[11px]"
              placeholder="base path"
              value={gitBasePath()}
              onInput={(e) => setGitBasePath(e.currentTarget.value)}
              spellcheck={false}
            />
          </div>

          <button
            type="button"
            class="sc-btn sc-btn-ghost text-[10px] self-start"
            onClick={() => setShowGitAdvanced((v) => !v)}
            aria-expanded={showGitAdvanced()}
          >
            {showGitAdvanced() ? 'Hide advanced' : 'Advanced (token / OAuth app)'}
          </button>
          <Show when={showGitAdvanced()}>
            <input
              class="sc-input font-mono text-[11px]"
              type="password"
              placeholder={
                gitProvider() === 'github'
                  ? 'PAT (ghp_… / fine-grained) — optional if connected'
                  : 'PAT (glpat-…) — optional if connected'
              }
              value={gitToken()}
              onInput={(e) => setGitToken(e.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
              data-testid="axis-git-token"
            />
            <input
              class="sc-input font-mono text-[11px]"
              placeholder="OAuth App client id (optional if Worker env set)"
              value={gitOAuthClientId()}
              onInput={(e) => setGitOAuthClientId(e.currentTarget.value)}
              spellcheck={false}
              data-testid="axis-git-oauth-client-id"
            />
            <input
              class="sc-input font-mono text-[11px]"
              placeholder="API base (optional, self-hosted)"
              value={gitApiBase()}
              onInput={(e) => setGitApiBase(e.currentTarget.value)}
              spellcheck={false}
            />
          </Show>

          <button
            class="sc-btn sc-btn-ghost text-[10px]"
            onClick={() => persistGit()}
            data-testid="axis-git-save"
          >
            Save git settings
          </button>
          <p class="text-[9px] text-text-faint m-0">
            <strong>Connect</strong> uses OAuth device flow via the Pro API or AXIS Worker (
            <code class="font-mono">POST /api/git/oauth/device/start</code>
            ). Set env <code class="font-mono">GITHUB_OAUTH_CLIENT_ID</code> /{' '}
            <code class="font-mono">GITLAB_OAUTH_CLIENT_ID</code> on that host (public OAuth App id;
            enable Device Flow on GitHub), or paste the client id under Advanced. Without OAuth,
            paste a PAT instead. Repo path:{' '}
            <code class="font-mono">{gitBasePath() || 'pyne-library'}/library/*.pyne</code>. Drafts stay
            local.
          </p>
        </div>
      </Show>

      <div class="border-2 border-border p-2.5 flex flex-col gap-2 bg-bg-elev rounded-[var(--radius-sc)]">
        <div class="text-[10px] text-text-dim uppercase tracking-wider">Save current editor</div>
        <input
          class="sc-input"
          placeholder="Script name"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <input
          class="sc-input"
          placeholder="Description (optional)"
          value={desc()}
          onInput={(e) => setDesc(e.currentTarget.value)}
        />
        <button
          class="sc-btn sc-btn-primary inline-flex items-center gap-1 justify-center"
          disabled={busy()}
          onClick={() => void onSave()}
        >
          <Icons.download size={13} />
          {isGit() ? 'Save & commit' : 'Save to library'}
        </button>
      </div>

      <div class="flex gap-1.5 flex-wrap">
        <button
          class="sc-btn sc-btn-ghost text-[10px] inline-flex items-center gap-1"
          onClick={() => void refresh()}
          disabled={busy()}
        >
          {busy() ? <HooxLoader size="xs" /> : null}
          Refresh
        </button>
        <button class="sc-btn sc-btn-ghost text-[10px]" onClick={() => void onExport()}>
          Export JSON
        </button>
        <button
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
          onChange={(e) => void onImportFile(e)}
        />
      </div>

      <Show when={error()}>
        <p class="text-red font-mono text-[10px]">{error()}</p>
      </Show>

      <div>
        <div class="text-[10px] text-text-dim uppercase tracking-wider mb-1">
          Library ({items().length})
        </div>
        <Show
          when={items().length > 0}
          fallback={<div class="text-text-faint p-2">No saved scripts yet.</div>}
        >
          <ul
            class="flex flex-col gap-1 max-h-[min(480px,50vh)] overflow-auto"
            data-testid="axis-library-script-list"
          >
            <For each={items()}>
              {(item) => (
                <LibraryScriptCard
                  item={item}
                  busy={busy()}
                  versioning={versioning()}
                  onLoad={() => void onLoad(item.id)}
                  onDelete={() => void onDelete(item.id, item.name)}
                  onLoadVersion={(payload) => {
                    props.setDoc?.(
                      payload.content,
                      payload.name,
                      payload.libraryId,
                    );
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
      </div>
    </div>
  );
};

/**
 * Dockable / floatable Script Library panel (panel id `library`).
 * Same body as Plugin Manager → Script Library, with FloatableShell chrome.
 */
export const LibraryPanel: Component<ScriptLibraryPanelProps> = (props) => (
  <Show when={isPanelOpen('library')}>
    <FloatableShell id="library" testId="axis-library">
      <div class="flex-1 overflow-y-auto min-h-0 p-2">
        <ScriptLibraryPanel
          getDoc={props.getDoc}
          setDoc={props.setDoc}
          onLoaded={props.onLoaded}
        />
      </div>
    </FloatableShell>
  </Show>
);
