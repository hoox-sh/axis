/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Minimal in-memory filesystem satisfying the `isomorphic-git` FS contract
 * (`fs.promises`: readFile/writeFile/unlink/readdir/mkdir/rmdir/rm/stat/
 * lstat). Backs short-lived working trees inside the Worker, which has no
 * local disk for `git clone` — see `artifacts-git.ts`.
 *
 * @module worker/git-memfs
 */

type DirEntry = { kind: 'dir'; children: Set<string>; mtimeMs: number };
type FileEntry = { kind: 'file'; data: Uint8Array; mtimeMs: number };
type SymlinkEntry = { kind: 'symlink'; target: string; mtimeMs: number };
type Entry = DirEntry | FileEntry | SymlinkEntry;

/** Node-style FS error: isomorphic-git branches on `error.code`. */
function fsError(code: string, path: string): Error {
  const err = new Error(`${code}: ${path}`) as Error & { code: string };
  err.code = code;
  return err;
}

class MemoryStats {  constructor(private readonly entry: Entry) {}

  get size(): number {
    return this.entry.kind === 'file' ? this.entry.data.byteLength : 0;
  }

  get mtimeMs(): number {
    return this.entry.mtimeMs;
  }

  get ctimeMs(): number {
    return this.entry.mtimeMs;
  }

  get mode(): number {
    if (this.entry.kind === 'symlink') return 0o120777;
    return this.entry.kind === 'file' ? 0o100644 : 0o040000;
  }

  isFile(): boolean {
    return this.entry.kind === 'file';
  }

  isDirectory(): boolean {
    return this.entry.kind === 'dir';
  }

  isSymbolicLink(): boolean {
    return this.entry.kind === 'symlink';
  }
}

export class MemoryFS {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly entries = new Map<string, Entry>([
    ['/', { kind: 'dir', children: new Set(), mtimeMs: Date.now() }],
  ]);

  readonly promises = {
    readFile: (p: string, o?: string | { encoding?: string }) => this.readFile(p, o),
    writeFile: (p: string, d: string | Uint8Array | ArrayBuffer) => this.writeFile(p, d),
    unlink: (p: string) => this.unlink(p),
    readdir: (p: string) => this.readdir(p),
    mkdir: (p: string, o?: { recursive?: boolean } | number) => this.mkdir(p, o),
    rmdir: (p: string) => this.rmdir(p),
    rm: (p: string) => this.rm(p),
    stat: (p: string) => this.stat(p),
    lstat: (p: string) => this.lstat(p),
    readlink: (p: string) => this.readlink(p),
    symlink: (t: string, p: string) => this.symlink(t, p),
  };

  private normalize(input: string): string {
    const segments: string[] = [];
    for (const part of input.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        segments.pop();
        continue;
      }
      segments.push(part);
    }
    return `/${segments.join('/')}` || '/';
  }

  private parent(path: string): string {
    const normalized = this.normalize(path);
    if (normalized === '/') return '/';
    const parts = normalized.split('/').filter(Boolean);
    parts.pop();
    return parts.length > 0 ? `/${parts.join('/')}` : '/';
  }

  private basename(path: string): string {
    return this.normalize(path).split('/').filter(Boolean).pop() ?? '';
  }

  private requireEntry(path: string): Entry {
    const entry = this.entries.get(this.normalize(path));
    if (!entry) throw fsError('ENOENT', path);
    return entry;
  }

  private requireDir(path: string): DirEntry {
    const entry = this.requireEntry(path);
    if (entry.kind !== 'dir') throw fsError('ENOTDIR', path);
    return entry;
  }

  async mkdir(path: string, options?: { recursive?: boolean } | number): Promise<void> {
    const target = this.normalize(path);
    if (target === '/') return;
    const recursive = typeof options === 'object' && options !== null && options.recursive === true;
    const parent = this.parent(target);
    if (!this.entries.has(parent)) {
      if (!recursive) throw fsError('ENOENT', parent);
      await this.mkdir(parent, { recursive: true });
    }
    if (this.entries.has(target)) return;
    this.entries.set(target, { kind: 'dir', children: new Set(), mtimeMs: Date.now() });
    this.requireDir(parent).children.add(this.basename(target));
  }

  async writeFile(path: string, data: string | Uint8Array | ArrayBuffer): Promise<void> {
    const target = this.normalize(path);
    await this.mkdir(this.parent(target), { recursive: true });
    const bytes =
      typeof data === 'string'
        ? this.encoder.encode(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
    this.entries.set(target, { kind: 'file', data: bytes, mtimeMs: Date.now() });
    this.requireDir(this.parent(target)).children.add(this.basename(target));
  }

  async readFile(path: string, options?: string | { encoding?: string }): Promise<Uint8Array | string> {
    const entry = this.requireEntry(path);
    if (entry.kind !== 'file') throw fsError('EISDIR', path);
    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (encoding) return this.decoder.decode(entry.data);
    return entry.data;
  }

  async readdir(path: string): Promise<string[]> {
    return [...this.requireDir(path).children].sort();
  }

  async unlink(path: string): Promise<void> {
    const target = this.normalize(path);
    const entry = this.requireEntry(target);
    if (entry.kind !== 'file' && entry.kind !== 'symlink') throw fsError('EISDIR', path);
    this.entries.delete(target);
    this.requireDir(this.parent(target)).children.delete(this.basename(target));
  }

  async rmdir(path: string): Promise<void> {
    const target = this.normalize(path);
    const entry = this.requireDir(target);
    if (entry.children.size > 0) throw fsError('ENOTEMPTY', path);
    this.entries.delete(target);
    if (target !== '/') {
      this.requireDir(this.parent(target)).children.delete(this.basename(target));
    }
  }

  async rm(path: string): Promise<void> {
    const target = this.normalize(path);
    const entry = this.entries.get(target);
    if (!entry) return;
    if (entry.kind !== 'dir') {
      await this.unlink(path);
      return;
    }
    for (const child of [...entry.children]) {
      await this.rm(`${target === '/' ? '' : target}/${child}`);
    }
    await this.rmdir(path);
  }

  async stat(path: string): Promise<MemoryStats> {
    const entry = this.requireEntry(path);
    if (entry.kind === 'symlink') throw fsError('ENOENT', path);
    return new MemoryStats(entry);
  }

  async lstat(path: string): Promise<MemoryStats> {
    return new MemoryStats(this.requireEntry(path));
  }

  /** Minimal symlink support (satisfies the isomorphic-git FS contract). */
  async symlink(target: string, path: string): Promise<void> {
    const link = this.normalize(path);
    await this.mkdir(this.parent(link), { recursive: true });
    this.entries.set(link, { kind: 'symlink', target: String(target), mtimeMs: Date.now() });
    this.requireDir(this.parent(link)).children.add(this.basename(link));
  }

  async readlink(path: string): Promise<string> {
    const entry = this.requireEntry(path);
    if (entry.kind !== 'symlink') throw fsError('EINVAL', path);
    return entry.target;
  }
}
