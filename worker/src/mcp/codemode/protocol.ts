/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Code Mode wire types and limits.
 *
 * Two model-facing tools, `search` and `execute`, each take one `code` string:
 * a JavaScript async arrow function. The parent Worker never runs that string;
 * it hands it to a Dynamic Worker Loader sandbox (see `sandbox.ts`).
 *
 * @module worker/mcp/codemode/protocol
 */

/** Hard bounds applied before and after one sandbox pass. */
export interface CodeModeLimits {
  /** Wall clock for one sandbox pass; the parent also races this. */
  timeoutMs: number;
  /** `axis.*` calls one code string may make. */
  maxCalls: number;
  /** Rejected before a Worker is loaded. */
  maxCodeChars: number;
  /** Result JSON larger than this is replaced with a truncated preview. */
  maxResultChars: number;
}

/** Defaults mirror the two proven Code Mode ports (hoox, pynescript). */
export const DEFAULT_LIMITS: CodeModeLimits = {
  timeoutMs: 20_000,
  maxCalls: 50,
  maxCodeChars: 20_000,
  maxResultChars: 200_000,
};

/** Which capability surface the sandbox receives. */
export type SandboxMode = 'search' | 'execute';

/** One call the sandbox asks the parent to perform. */
export type CodeModeHandler = (args: unknown) => Promise<unknown>;

/** The narrow RPC surface: tool name -> parent-side handler. */
export type CodeModeHandlers = Record<string, CodeModeHandler>;

/** Input to one sandbox pass. */
export interface SandboxRequest {
  mode: SandboxMode;
  /** Untrusted model text. Treated as hostile throughout. */
  code: string;
  /** Compact catalog injected into `search`; omitted for `execute`. */
  catalog?: readonly unknown[];
  /** Parent handlers injected into `execute`; omitted for `search`. */
  handlers?: CodeModeHandlers;
  limits?: Partial<CodeModeLimits>;
}

/** What the sandbox module returns across RPC. */
export interface SandboxResponse {
  value?: unknown;
  error?: string;
  logs?: string[];
}

/** Parent-side outcome of one pass. */
export type SandboxResult =
  | {
      ok: true;
      value: unknown;
      calls: number;
      logs: string[];
      durationMs: number;
      truncated: boolean;
    }
  | {
      ok: false;
      message: string;
      stderr: string;
      durationMs: number;
    };
