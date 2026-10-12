/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Artifacts git service for script storage (`artifacts-git.ts`) plus the
 * `/api/scripts` wiring in `scripts.ts`.
 *
 * All git I/O is faked — in-memory Artifacts binding + stub tree pusher —
 * so no network or beta access is needed. The one exception is a local-only
 * `isomorphic-git` init/add/commit over `MemoryFS`, which proves the FS
 * contract without touching any remote.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import git from 'isomorphic-git';
import {
  _setGitTreePusher,
  clampCloneTtl,
  commitScriptSave,
  displayMessage,
  epochToMs,
  listScriptHistory,
  mintCloneToken,
  parseScriptMarker,
  readScriptAtCommit,
  safeScriptId,
  saveCommitMessage,
  deleteCommitMessage,
  scriptFilePath,
  scriptMetaPath,
  splitTokenSecret,
  userRepoName,
  type ArtifactsCommitMeta,
  type ArtifactsNamespace,
  type ArtifactsRepoHandle,
  type TreePushInput,
} from '../src/artifacts-git';
import { MemoryFS } from '../src/git-memfs';
import { handleScripts, _clearMemScripts } from '../src/scripts';
import type { Env } from '../src/index';

// --- In-memory Artifacts binding -------------------------------------------

interface FakeCommit {
  sha: string;
  message: string;
  at: number;
  files: Map<string, string>;
}

interface FakeRepoState {
  remote: string;
  branch: string;
  commits: FakeCommit[];
}

const ACCOUNT = 'acct123';

class FakeArtifacts implements ArtifactsNamespace {
  repos = new Map<string, FakeRepoState>();
  tokenCalls: Array<{ repo: string; scope: string; ttl?: number }> = [];

  remoteFor(name: string): string {
    return `https://${ACCOUNT}.artifacts.cloudflare.net/git/ns/${name}.git`;
  }

  stateForRemote(remote: string): FakeRepoState | null {
    for (const repo of this.repos.values()) {
      if (repo.remote === remote) return repo;
    }
    return null;
  }

  async create(
    name: string,
    opts?: { description?: string; readOnly?: boolean; setDefaultBranch?: string },
  ) {
    let repo = this.repos.get(name);
    if (!repo) {
      repo = { remote: this.remoteFor(name), branch: opts?.setDefaultBranch || 'main', commits: [] };
      this.repos.set(name, repo);
    }
    return {
      name,
      remote: repo.remote,
      defaultBranch: repo.branch,
      token: `art_v1_write0?expires=${Math.floor(Date.now() / 1000) + 600}`,
    };
  }

  async get(name: string): Promise<ArtifactsRepoHandle> {
    const repo = this.repos.get(name);
    if (!repo) throw new Error('NOT_FOUND: repo missing');
    const self = this;
    return {
      async info() {
        return { name, remote: repo.remote, defaultBranch: repo.branch, status: 'ready' };
      },
      async createToken(scope: 'read' | 'write', ttl?: number) {
        self.tokenCalls.push({ repo: name, scope, ttl });
        return {
          plaintext: `art_v1_${scope}0?expires=${Math.floor(Date.now() / 1000) + (ttl ?? 3600)}`,
          expiresAt: Math.floor(Date.now() / 1000) + (ttl ?? 3600),
        };
      },
      async log(opts?: { ref?: string; limit?: number; offset?: number }): Promise<ArtifactsCommitMeta[]> {
        const limit = opts?.limit ?? 50;
        const offset = opts?.offset ?? 0;
        return [...repo.commits]
          .reverse()
          .slice(offset, offset + limit)
          .map((c) => ({ oid: c.sha, message: c.message, timestamp: c.at }));
      },
      async readFile(args: { ref: string; path: string }): Promise<Blob | null> {
        const commit = repo.commits.find((c) => c.sha === args.ref);
        const content = commit?.files.get(args.path);
        if (content === undefined) return null;
        return new Blob([content], { type: 'text/plain;charset=utf-8' });
      },
    };
  }

  async delete(name: string): Promise<boolean> {
    return this.repos.delete(name);
  }
}

// --- Stub tree pusher: applies the tree to fake repo state ----------------

let shaCounter = 0;
const pushed: TreePushInput[] = [];

function installPusher(fake: FakeArtifacts, opts?: { fail?: boolean }): void {
  _setGitTreePusher({
    pushTree: async (input: TreePushInput) => {
      pushed.push(input);
      if (opts?.fail) throw new Error('push boom');
      const repo = fake.stateForRemote(input.remote);
      if (!repo) throw new Error('unknown remote');
      shaCounter += 1;
      const sha = `fakesha${String(shaCounter).padStart(4, '0')}`;
      const base = repo.commits.length > 0 ? repo.commits[repo.commits.length - 1]!.files : new Map<string, string>();
      const files = new Map(base);
      for (const [path, content] of Object.entries(input.files)) {
        if (content === null) files.delete(path);
        else files.set(path, content);
      }
      repo.commits.push({ sha, message: input.message, at: Math.floor(Date.now() / 1000), files });
      return { sha };
    },
  });
}

const origin = 'http://localhost:3000';
const KEY = 'test-user-key-1';

function req(path: string, init: RequestInit & { key?: string } = {}): Request {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${init.key || KEY}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return new Request(`http://localhost${path}`, { ...init, headers });
}

function gitEnv(fake: FakeArtifacts): Env {
  return {
    ALLOW_OPEN_KEYS: '1',
    ALLOWED_ORIGIN: origin,
    SCRIPT_ARTIFACTS: fake,
  };
}

beforeEach(() => {
  _clearMemScripts();
  pushed.length = 0;
  shaCounter = 0;
});

afterEach(() => {
  _setGitTreePusher(null);
});

describe('artifacts-git naming and markers', () => {
  it('derives safe per-user repo names', () => {
    expect(userRepoName('ABCDEF1234567890abcdef1234567890')).toBe('axis-scripts-abcdef123456');
    expect(userRepoName('')).toBe('axis-scripts-default');
  });

  it('maps script file paths and round-trips markers', () => {
    expect(scriptFilePath('s_abc')).toBe('scripts/s_abc.pine');
    expect(scriptMetaPath('s_abc')).toBe('scripts/s_abc.meta.json');
    expect(safeScriptId('../../x')).not.toContain('/');
    const msg = saveCommitMessage('My RSI', 's_abc');
    expect(parseScriptMarker(msg)).toEqual({ id: 's_abc', deleted: false });
    expect(displayMessage(msg, 's_abc')).toBe('Save My RSI');
    const del = deleteCommitMessage('My RSI', 's_abc');
    expect(parseScriptMarker(del)).toEqual({ id: 's_abc', deleted: true });
    expect(parseScriptMarker('foreign commit')).toBeNull();
  });

  it('splits token secrets and normalizes epochs', () => {
    expect(splitTokenSecret('art_v1_abc?expires=1700000000')).toEqual({
      secret: 'art_v1_abc',
      expiresAtMs: 1700000000000,
    });
    expect(splitTokenSecret('bare')).toEqual({ secret: 'bare', expiresAtMs: null });
    expect(epochToMs(1700000000)).toBe(1700000000000);
    expect(epochToMs(1700000000000)).toBe(1700000000000);
  });

  it('clamps clone token TTLs', () => {
    expect(clampCloneTtl(undefined)).toBe(3600);
    expect(clampCloneTtl(5)).toBe(60);
    expect(clampCloneTtl(10_000_000)).toBe(86400);
  });
});

describe('MemoryFS satisfies isomorphic-git offline', () => {
  it('init + add + commit + log without a remote', async () => {
    const fs = new MemoryFS();
    const dir = '/repo';
    await git.init({ fs, dir, defaultBranch: 'main' });
    await fs.promises.writeFile(`${dir}/hello.pine`, '//@version=6\nindicator("hi")');
    await git.add({ fs, dir, filepath: 'hello.pine' });
    const sha = await git.commit({
      fs,
      dir,
      message: 'test commit',
      author: { name: 't', email: 't@t' },
    });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const log = await git.log({ fs, dir, ref: 'main' });
    expect(log.map((c) => c.oid)).toEqual([sha]);
  });
});

describe('commitScriptSave against a fake binding', () => {
  it('creates the repo on first save and pushes source + meta', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    const res = await commitScriptSave(fake, 'user1', {
      id: 's_1',
      name: 'My RSI',
      description: 'lorem',
      content: 'plot(close)',
    });
    expect(res.sha).toBe('fakesha0001');
    expect(res.remote).toContain('axis-scripts-');
    expect(Object.keys(pushed[0]!.files).sort()).toEqual([
      'scripts/s_1.meta.json',
      'scripts/s_1.pine',
    ]);
    expect(pushed[0]!.message).toContain('[axis-script:s_1]');
  });

  it('delete commits removals', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    await commitScriptSave(fake, 'user1', { id: 's_1', name: 'X', content: 'a' });
    await commitScriptSave(fake, 'user1', { id: 's_1', name: 'X', content: 'a' }, { delete: true });
    expect(pushed[1]!.files).toEqual({
      'scripts/s_1.pine': null,
      'scripts/s_1.meta.json': null,
    });
    expect(pushed[1]!.message).toContain('[axis-delete]');
  });
});

describe('history and clone credentials', () => {
  it('lists one script history, excluding foreign and delete markers', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    await commitScriptSave(fake, 'user1', { id: 's_1', name: 'A', content: 'a' });
    await commitScriptSave(fake, 'user1', { id: 's_2', name: 'B', content: 'b' });
    await commitScriptSave(fake, 'user1', { id: 's_1', name: 'A', content: 'a2' });
    const hist = await listScriptHistory(fake, 'user1', 's_1');
    expect(hist.map((v) => v.sha)).toEqual(['fakesha0003', 'fakesha0001']);
    expect(hist[0]!.shortSha).toBe('fakesha0003'.slice(0, 7));
    expect(hist[0]!.message).toBe('Save A');
  });

  it('reads source + meta at a historical commit', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    await commitScriptSave(fake, 'user1', { id: 's_1', name: 'A', description: 'd', content: 'v1' });
    await commitScriptSave(fake, 'user1', { id: 's_1', name: 'A2', description: 'd', content: 'v2' });
    const at = await readScriptAtCommit(fake, 'user1', 's_1', 'fakesha0001');
    expect(at?.content).toBe('v1');
    expect(at?.name).toBe('A');
    expect(at?.revision).toBe('fakesha0001');
    expect(await readScriptAtCommit(fake, 'user1', 's_1', 'nope')).toBeNull();
  });

  it('mints scoped clone tokens', async () => {
    const fake = new FakeArtifacts();
    const cred = await mintCloneToken(fake, 'user1', 'read', 600);
    expect(cred.remote).toContain('.git');
    expect(cred.scope).toBe('read');
    expect(cred.secret).not.toContain('?expires=');
    expect(fake.tokenCalls).toEqual([{ repo: cred.repo, scope: 'read', ttl: 600 }]);
  });
});

describe('mirror dedupe', () => {
  it('skips the push when nothing changed', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    const first = await commitScriptSave(fake, 'user1', { id: 's_1', name: 'A', content: 'a' });
    expect(first.deduped).toBe(false);
    const second = await commitScriptSave(fake, 'user1', { id: 's_1', name: 'A', content: 'a' });
    expect(second.deduped).toBe(true);
    expect(second.sha).toBe(first.sha);
    expect(pushed.length).toBe(1);
  });

  it('pushes when content or meta changes', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    await commitScriptSave(fake, 'user1', { id: 's_1', name: 'A', content: 'a' });
    const changed = await commitScriptSave(fake, 'user1', { id: 's_1', name: 'A', content: 'a2' });
    expect(changed.deduped).toBe(false);
    const renamed = await commitScriptSave(fake, 'user1', { id: 's_1', name: 'B', content: 'a2' });
    expect(renamed.deduped).toBe(false);
    expect(pushed.length).toBe(3);
  });
});

describe('handleScripts restore', () => {
  it('restores a git version as the new tip', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    const env = gitEnv(fake);
    await handleScripts(
      req('/api/scripts/s1', { method: 'PUT', body: JSON.stringify({ name: 'Demo', content: 'v1' }) }),
      env,
      origin,
      '/api/scripts/s1',
    );
    await handleScripts(
      req('/api/scripts/s1', { method: 'PUT', body: JSON.stringify({ name: 'Demo', content: 'v2' }) }),
      env,
      origin,
      '/api/scripts/s1',
    );
    const restore = await handleScripts(
      req('/api/scripts/s1/restore', { method: 'POST', body: JSON.stringify({ revision: 'fakesha0001' }) }),
      env,
      origin,
      '/api/scripts/s1/restore',
    );
    expect(restore.status).toBe(200);
    const rj = await restore.json();
    expect(rj.script.content).toBe('v1');
    expect(rj.restoredFrom).toBe('fakesha0001');
    expect(pushed.length).toBe(3);
    expect(pushed[2]!.message).toContain('Restore Demo from fakesha');
  });

  it('recreates a deleted script from git history', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    const env = gitEnv(fake);
    await handleScripts(
      req('/api/scripts/sd', { method: 'PUT', body: JSON.stringify({ name: 'Gone', content: 'v1' }) }),
      env,
      origin,
      '/api/scripts/sd',
    );
    await handleScripts(req('/api/scripts/sd', { method: 'DELETE' }), env, origin, '/api/scripts/sd');
    const get = await handleScripts(req('/api/scripts/sd'), env, origin, '/api/scripts/sd');
    expect(get.status).toBe(404);
    const restore = await handleScripts(
      req('/api/scripts/sd/restore', { method: 'POST', body: JSON.stringify({ revision: 'fakesha0001' }) }),
      env,
      origin,
      '/api/scripts/sd/restore',
    );
    expect(restore.status).toBe(201);
    const rj = await restore.json();
    expect(rj.script.content).toBe('v1');
    expect(rj.script.name).toBe('Gone');
  });

  it('restores from memory versions when git is unbound', async () => {
    const env: Env = { ALLOW_OPEN_KEYS: '1', ALLOWED_ORIGIN: origin };
    const first = await handleScripts(
      req('/api/scripts/sm', { method: 'PUT', body: JSON.stringify({ name: 'M', content: 'v1' }) }),
      env,
      origin,
      '/api/scripts/sm',
    );
    const rev1 = (await first.json()).script.revision as string;
    await handleScripts(
      req('/api/scripts/sm', { method: 'PUT', body: JSON.stringify({ name: 'M', content: 'v2' }) }),
      env,
      origin,
      '/api/scripts/sm',
    );
    const restore = await handleScripts(
      req('/api/scripts/sm/restore', { method: 'POST', body: JSON.stringify({ revision: rev1 }) }),
      env,
      origin,
      '/api/scripts/sm/restore',
    );
    expect(restore.status).toBe(200);
    expect((await restore.json()).script.content).toBe('v1');
  });

  it('rejects unknown revisions and wrong methods', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    const env = gitEnv(fake);
    const missing = await handleScripts(
      req('/api/scripts/sx/restore', { method: 'POST', body: JSON.stringify({}) }),
      env,
      origin,
      '/api/scripts/sx/restore',
    );
    expect(missing.status).toBe(400);
    const unknown = await handleScripts(
      req('/api/scripts/sx/restore', { method: 'POST', body: JSON.stringify({ revision: 'nope' }) }),
      env,
      origin,
      '/api/scripts/sx/restore',
    );
    expect(unknown.status).toBe(404);
    const get = await handleScripts(req('/api/scripts/sx/restore'), env, origin, '/api/scripts/sx/restore');
    expect(get.status).toBe(405);
  });
});
describe('handleScripts git wiring', () => {
  it('mirrors PUT saves and prefers git history', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    const env = gitEnv(fake);
    const put = await handleScripts(
      req('/api/scripts/s1', { method: 'PUT', body: JSON.stringify({ name: 'Demo', content: 'v1' }) }),
      env,
      origin,
      '/api/scripts/s1',
    );
    expect([200, 201]).toContain(put.status);
    expect(pushed.length).toBe(1);

    const versions = await handleScripts(req('/api/scripts/s1/versions'), env, origin, '/api/scripts/s1/versions');
    const vj = await versions.json();
    expect(vj.backend).toBe('artifacts-git');
    expect(vj.versions.map((v: { sha: string }) => v.sha)).toEqual(['fakesha0001']);

    const detail = await handleScripts(
      req('/api/scripts/s1/versions/fakesha0001'),
      env,
      origin,
      '/api/scripts/s1/versions/fakesha0001',
    );
    const dj = await detail.json();
    expect(dj.backend).toBe('artifacts-git');
    expect(dj.script.content).toBe('v1');
  });

  it('falls back to D1/memory history when git is empty', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    const env = gitEnv(fake);
    await handleScripts(
      req('/api/scripts/s9', { method: 'PUT', body: JSON.stringify({ name: 'N', content: 'c' }) }),
      env,
      origin,
      '/api/scripts/s9',
    );
    // Wipe git state only: memory versions remain, git log is empty.
    fake.repos.clear();
    const versions = await handleScripts(req('/api/scripts/s9/versions'), env, origin, '/api/scripts/s9/versions');
    const vj = await versions.json();
    expect(vj.backend ?? 'memory').not.toBe('artifacts-git');
    expect(vj.versions.length).toBe(1);
  });

  it('never fails the save when the mirror throws', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake, { fail: true });
    const env = gitEnv(fake);
    const put = await handleScripts(
      req('/api/scripts/sf', { method: 'PUT', body: JSON.stringify({ name: 'F', content: 'c' }) }),
      env,
      origin,
      '/api/scripts/sf',
    );
    expect([200, 201]).toContain(put.status);
  });

  it('serves _git info and mints clone tokens', async () => {
    const fake = new FakeArtifacts();
    installPusher(fake);
    const env = gitEnv(fake);
    const info = await handleScripts(req('/api/scripts/_git'), env, origin, '/api/scripts/_git');
    expect(info.status).toBe(200);
    const ij = await info.json();
    expect(ij.git.remote).toContain('.git');

    const tok = await handleScripts(
      req('/api/scripts/_git/token', { method: 'POST', body: JSON.stringify({ scope: 'read' }) }),
      env,
      origin,
      '/api/scripts/_git/token',
    );
    expect(tok.status).toBe(200);
    const tj = await tok.json();
    expect(tj.git.scope).toBe('read');
    expect(tj.git.token).toContain('art_v1_');
  });

  it('returns 503 for _git routes when unbound', async () => {
    const env: Env = { ALLOW_OPEN_KEYS: '1', ALLOWED_ORIGIN: origin };
    const r = await handleScripts(req('/api/scripts/_git'), env, origin, '/api/scripts/_git');
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.code).toBe('GIT_BACKEND_UNAVAILABLE');
  });
});
