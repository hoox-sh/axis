// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Git storage settings shown when the personal library backend is `git`.
 * OAuth device flow and save stay in the parent; this is the form chrome.
 *
 * @module ui/library/GitForm
 */

import { type Component, Show } from 'solid-js';
import { HooxLoader } from '../HooxLoader';
import { Icons } from '../icons';
import { manualTokenCreateUrl } from '../../storage/git-oauth';
import { LibraryField } from './Field';

export const GitSettingsForm: Component<{
  provider: 'github' | 'gitlab';
  token: string;
  owner: string;
  repo: string;
  projectId: string;
  branch: string;
  basePath: string;
  apiBase: string;
  oauthClientId: string;
  showAdvanced: boolean;
  oauthBusy: boolean;
  oauthUserCode: string;
  oauthVerifyUri: string;
  oauthHint: string;
  oauthLogin: string;
  busy: boolean;
  onProvider: (provider: 'github' | 'gitlab') => void;
  onToken: (value: string) => void;
  onOwner: (value: string) => void;
  onRepo: (value: string) => void;
  onProjectId: (value: string) => void;
  onBranch: (value: string) => void;
  onBasePath: (value: string) => void;
  onApiBase: (value: string) => void;
  onOauthClientId: (value: string) => void;
  onToggleAdvanced: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onCancelOauth: () => void;
  onSave: () => void;
}> = (props) => {
  const providerName = () => (props.provider === 'github' ? 'GitHub' : 'GitLab');
  return (
    <div
      class="border border-border p-2 flex flex-col gap-2 bg-bg-elev rounded-md"
      data-testid="axis-git-settings"
    >
      <div class="text-[10px] text-text-dim uppercase tracking-wider">Git repository</div>
      <LibraryField label="Provider">
        <select
          class="sc-input"
          value={props.provider}
          onChange={(e) => props.onProvider(e.currentTarget.value as 'github' | 'gitlab')}
          data-testid="axis-git-provider"
        >
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
        </select>
      </LibraryField>

      <div class="flex flex-col gap-1.5">
        <Show
          when={props.token.trim()}
          fallback={
            <div class="flex flex-wrap gap-1.5">
              <button
                type="button"
                class="sc-btn sc-btn-primary text-[10px] inline-flex items-center gap-1"
                data-testid="axis-git-connect"
                disabled={props.oauthBusy || props.busy}
                onClick={props.onConnect}
                title="Authorize via device flow (Worker proxies forge OAuth)"
              >
                {props.oauthBusy ? <HooxLoader size="xs" /> : <Icons.externalLink size={12} />}
                Connect with {providerName()}
              </button>
              <a
                class="sc-btn sc-btn-ghost text-[10px] inline-flex items-center gap-1 no-underline"
                href={manualTokenCreateUrl(props.provider)}
                target="_blank"
                rel="noopener noreferrer"
                title="Create a personal access token in the browser"
              >
                Create token…
              </a>
            </div>
          }
        >
          <div class="flex items-center gap-2 flex-wrap text-[10px]" data-testid="axis-git-connected">
            <span class="text-accent-2 font-semibold">
              Connected
              <Show when={props.oauthLogin || props.owner}>
                {' '}
                as {props.oauthLogin || props.owner}
              </Show>
            </span>
            <button
              type="button"
              class="sc-btn sc-btn-ghost text-[10px]"
              data-testid="axis-git-disconnect"
              onClick={props.onDisconnect}
            >
              Disconnect
            </button>
          </div>
        </Show>

        <Show when={props.oauthBusy && props.oauthUserCode}>
          <div
            class="border border-border-soft p-2 rounded-[var(--radius-sm)] bg-bg-base flex flex-col gap-1"
            data-testid="axis-git-oauth-pending"
            role="status"
          >
            <p class="text-[10px] text-text-dim m-0">{props.oauthHint || 'Waiting…'}</p>
            <p class="m-0 font-mono text-[13px] text-accent tracking-widest">{props.oauthUserCode}</p>
            <Show when={props.oauthVerifyUri}>
              <a
                class="text-[10px] text-accent underline break-all"
                href={props.oauthVerifyUri}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open verification page
              </a>
            </Show>
            <button
              type="button"
              class="sc-btn sc-btn-ghost text-[10px] self-start"
              onClick={props.onCancelOauth}
            >
              Cancel
            </button>
          </div>
        </Show>
      </div>

      <div class="grid grid-cols-2 gap-1.5">
        <LibraryField label="Owner">
          <input
            class="sc-input font-mono text-[11px]"
            placeholder="owner / group"
            value={props.owner}
            onInput={(e) => props.onOwner(e.currentTarget.value)}
            spellcheck={false}
            autocomplete="off"
            data-testid="axis-git-owner"
          />
        </LibraryField>
        <LibraryField label="Repository">
          <input
            class="sc-input font-mono text-[11px]"
            placeholder="repo"
            value={props.repo}
            onInput={(e) => props.onRepo(e.currentTarget.value)}
            spellcheck={false}
            autocomplete="off"
            data-testid="axis-git-repo"
          />
        </LibraryField>
      </div>
      <Show when={props.provider === 'gitlab'}>
        <LibraryField label="Project id">
          <input
            class="sc-input font-mono text-[11px]"
            placeholder="group/repo"
            value={props.projectId}
            onInput={(e) => props.onProjectId(e.currentTarget.value)}
            spellcheck={false}
            autocomplete="off"
          />
        </LibraryField>
      </Show>
      <div class="grid grid-cols-2 gap-1.5">
        <LibraryField label="Branch">
          <input
            class="sc-input font-mono text-[11px]"
            placeholder="main"
            value={props.branch}
            onInput={(e) => props.onBranch(e.currentTarget.value)}
            spellcheck={false}
            autocomplete="off"
          />
        </LibraryField>
        <LibraryField label="Base path">
          <input
            class="sc-input font-mono text-[11px]"
            placeholder="pyne-library"
            value={props.basePath}
            onInput={(e) => props.onBasePath(e.currentTarget.value)}
            spellcheck={false}
            autocomplete="off"
          />
        </LibraryField>
      </div>

      <button
        type="button"
        class="sc-btn sc-btn-ghost text-[10px] self-start"
        onClick={props.onToggleAdvanced}
        aria-expanded={props.showAdvanced}
      >
        {props.showAdvanced ? 'Hide advanced' : 'Advanced (token / OAuth app)'}
      </button>
      <Show when={props.showAdvanced}>
        <LibraryField label="Personal access token">
          <input
            class="sc-input font-mono text-[11px]"
            type="password"
            placeholder={
              props.provider === 'github'
                ? 'ghp_… / fine-grained — optional if connected'
                : 'glpat-… — optional if connected'
            }
            value={props.token}
            onInput={(e) => props.onToken(e.currentTarget.value)}
            autocomplete="off"
            spellcheck={false}
            data-testid="axis-git-token"
          />
        </LibraryField>
        <LibraryField label="OAuth app client id">
          <input
            class="sc-input font-mono text-[11px]"
            placeholder="Optional if the Worker env is set"
            value={props.oauthClientId}
            onInput={(e) => props.onOauthClientId(e.currentTarget.value)}
            spellcheck={false}
            autocomplete="off"
            data-testid="axis-git-oauth-client-id"
          />
        </LibraryField>
        <LibraryField label="API base">
          <input
            class="sc-input font-mono text-[11px]"
            placeholder="Optional, self-hosted"
            value={props.apiBase}
            onInput={(e) => props.onApiBase(e.currentTarget.value)}
            spellcheck={false}
            autocomplete="off"
          />
        </LibraryField>
      </Show>

      <button
        type="button"
        class="sc-btn sc-btn-ghost text-[10px]"
        onClick={props.onSave}
        data-testid="axis-git-save"
      >
        Save git settings
      </button>
      <p class="text-[9px] text-text-faint m-0">
        <strong>Connect</strong> uses OAuth device flow via the Pro API or AXIS Worker (
        <code class="font-mono">POST /api/git/oauth/device/start</code>
        ). Set env <code class="font-mono">GITHUB_OAUTH_CLIENT_ID</code> /{' '}
        <code class="font-mono">GITLAB_OAUTH_CLIENT_ID</code> on that host (public OAuth App id;
        enable Device Flow on GitHub), or paste the client id under Advanced. Without OAuth, paste
        a PAT instead. Repo path:{' '}
        <code class="font-mono">{props.basePath || 'pyne-library'}/library/*.pyne</code>. Drafts stay
        local.
      </p>
    </div>
  );
};
