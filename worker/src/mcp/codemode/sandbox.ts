/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Cloudflare Dynamic Worker Loader sandbox for Code Mode.
 *
 * The model's `code` string never runs in this Worker. It is embedded in a
 * generated module that is loaded as a *separate* Dynamic Worker:
 *
 * - `globalOutbound: null` — the child cannot `fetch()` or `connect()`.
 * - no `env` — no KV, D1, R2, Durable Objects, secrets, or service bindings.
 * - the only capability is one RPC object passed as an `evaluate()` argument;
 *   every call is re-dispatched through the parent's authenticated tool path.
 *
 * API verified against Cloudflare's Dynamic Workers docs (2026-10-31) and the
 * `cloudflare/agents` `packages/codemode` `DynamicWorkerExecutor`.
 *
 * @module worker/mcp/codemode/sandbox
 */

import {
  DEFAULT_LIMITS,
  type CodeModeHandlers,
  type CodeModeLimits,
  type SandboxRequest,
  type SandboxResponse,
  type SandboxResult,
} from './protocol';

/** Main module name inside the Dynamic Worker. */
export const SANDBOX_MAIN_MODULE = 'executor.js';

/**
 * Compatibility date for the child Worker.
 *
 * Matches the date the proven `@cloudflare/codemode` `DynamicWorkerExecutor`
 * uses for its generated module (`cloudflare/agents`).
 */
export const SANDBOX_COMPATIBILITY_DATE = '2025-06-01';

/** Mutable counters shared with the dispatcher. */
export interface SandboxStats {
  calls: number;
}

/** Test seam: production builds an `RpcTarget`; tests inject a plain stub. */
export type MakeDispatcher = (
  handlers: CodeModeHandlers,
  limits: CodeModeLimits,
  stats: SandboxStats,
) => unknown | Promise<unknown>;

/** Optional dependencies, so unit tests never need workerd. */
export interface SandboxDeps {
  loader?: WorkerLoader;
  makeDispatcher?: MakeDispatcher;
}

/** Strips a Markdown code fence that models often wrap code in. */
export function normalizeCode(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  const fenced =
    /^```(?:js|javascript|typescript|ts|tsx|jsx)?\s*\n([\s\S]*?)```\s*$/.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

/**
 * Serializes a tool result for the sandbox.
 *
 * Results larger than the budget become a truncated preview instead of an
 * unbounded string crossing RPC.
 */
function encodeToolResult(value: unknown, maxChars: number): string {
  let text: string;
  try {
    text = JSON.stringify({ result: value === undefined ? null : value });
  } catch {
    return JSON.stringify({ error: 'tool result is not JSON-serializable' });
  }
  if (text.length <= maxChars) return text;
  return JSON.stringify({
    result: {
      truncated: true,
      note: `tool result exceeded ${maxChars} chars`,
      preview: text.slice(0, maxChars),
    },
  });
}

/**
 * Handles one sandbox → parent call.
 *
 * The sandbox is untrusted: the tool name must be an own property of the
 * handler map (so `__proto__` and `constructor` cannot resolve), arguments
 * are parsed defensively, and the call budget is enforced here, not in the
 * child.
 */
export async function dispatchCall(
  handlers: CodeModeHandlers,
  limits: CodeModeLimits,
  stats: SandboxStats,
  rawName: unknown,
  argsJson: unknown,
): Promise<string> {
  const name = typeof rawName === 'string' ? rawName : '';
  if (!name || !Object.hasOwn(handlers, name)) {
    return JSON.stringify({ error: `Unknown tool: ${name || '(empty)'}` });
  }
  stats.calls += 1;
  if (stats.calls > limits.maxCalls) {
    return JSON.stringify({ error: `Call limit exceeded (${limits.maxCalls})` });
  }
  let args: unknown = {};
  if (typeof argsJson === 'string' && argsJson.length > 0) {
    try {
      args = JSON.parse(argsJson) as unknown;
    } catch {
      return JSON.stringify({ error: 'arguments are not valid JSON' });
    }
  }
  const handler = handlers[name];
  if (!handler) return JSON.stringify({ error: `Unknown tool: ${name}` });
  try {
    return encodeToolResult(await handler(args), limits.maxResultChars);
  } catch (err) {
    return JSON.stringify({ error: errorMessage(err) });
  }
}

/**
 * Production dispatcher: an `RpcTarget` whose only method is `call`.
 *
 * Imported dynamically so Bun unit tests (which do not provide
 * `cloudflare:workers`) can import this module and inject a stub.
 */
async function defaultMakeDispatcher(
  handlers: CodeModeHandlers,
  limits: CodeModeLimits,
  stats: SandboxStats,
): Promise<unknown> {
  const { RpcTarget } = await import('cloudflare:workers');
  class AxisCodeDispatcher extends RpcTarget {
    call(name: string, argsJson?: string): Promise<string> {
      return dispatchCall(handlers, limits, stats, name, argsJson);
    }
  }
  return new AxisCodeDispatcher();
}

/**
 * Generates the child Worker module.
 *
 * The model's source is spliced in as the arrow function body of a
 * `Promise.race`, inside the child isolate. It can see only `axis` (the RPC
 * proxy) and `catalog` (search mode). `this.env` is an empty object because
 * the parent passes no `env` to the loader.
 */
export function buildSandboxModule(input: {
  mode: SandboxRequest['mode'];
  code: string;
  limits: CodeModeLimits;
}): string {
  const source = normalizeCode(input.code);
  return [
    'import { WorkerEntrypoint } from "cloudflare:workers";',
    '',
    'export default class AxisCodeExecutor extends WorkerEntrypoint {',
    '  async evaluate(__dispatch, __catalog) {',
    '    const __logs = [];',
    '    const __capture = (prefix, args) => {',
    '      __logs.push(prefix + args.map((a) => String(a)).join(" "));',
    '    };',
    '    console.log = (...args) => __capture("", args);',
    '    console.warn = (...args) => __capture("[warn] ", args);',
    '    console.error = (...args) => __capture("[error] ", args);',
    '    const __invoke = async (tool, args) => {',
    '      if (!__dispatch) throw new Error("This mode has no tool access; use execute.");',
    '      const raw = await __dispatch.call(String(tool), JSON.stringify(args === undefined ? {} : args));',
    '      const data = JSON.parse(raw);',
    '      if (data && typeof data.error === "string") throw new Error(data.error);',
    '      return data ? data.result : undefined;',
    '    };',
    '    const axis = new Proxy({ call: __invoke }, {',
    '      get: (target, tool) => {',
    '        if (Object.hasOwn(target, tool)) return target[tool];',
    '        if (typeof tool !== "string") return undefined;',
    '        return async (args) => __invoke(tool, args);',
    '      },',
    '    });',
    '    const catalog = __catalog;',
    '    try {',
    '      const value = await Promise.race([',
    `        (${source})(),`,
    `        new Promise((_, reject) => setTimeout(() => reject(new Error("Execution timed out")), ${input.limits.timeoutMs})),`,
    '      ]);',
    '      return { value, logs: __logs };',
    '    } catch (err) {',
    '      return { error: err && typeof err.message === "string" ? err.message : String(err), logs: __logs };',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
}

/**
 * Builds the `WorkerCode` handed to `env.LOADER.load()`.
 *
 * Deliberately omits `env` and sets `globalOutbound: null`. There is no other
 * place in this module that can add a binding, so a model string cannot reach
 * one.
 */
export function buildWorkerCode(input: {
  mode: SandboxRequest['mode'];
  code: string;
  limits?: Partial<CodeModeLimits>;
  catalog?: readonly unknown[];
}): WorkerLoaderWorkerCode {
  const limits: CodeModeLimits = { ...DEFAULT_LIMITS, ...input.limits };
  return {
    compatibilityDate: SANDBOX_COMPATIBILITY_DATE,
    mainModule: SANDBOX_MAIN_MODULE,
    modules: {
      [SANDBOX_MAIN_MODULE]: buildSandboxModule({ mode: input.mode, code: input.code, limits }),
    },
    globalOutbound: null,
  };
}

function disposeQuietly(resource: unknown): void {
  if (!resource || typeof resource !== 'object') return;
  const disposeSymbol = (Symbol as { dispose?: symbol }).dispose;
  if (!disposeSymbol) return;
  const dispose = (resource as Record<symbol, unknown>)[disposeSymbol];
  if (typeof dispose !== 'function') return;
  try {
    (dispose as () => void).call(resource);
  } catch {
    // Best-effort cleanup only.
  }
}

function capFinalResult(
  value: unknown,
  maxChars: number,
): { value: unknown; truncated: boolean } {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return { value: { error: 'result is not JSON-serializable' }, truncated: false };
  }
  if (text === undefined) return { value: null, truncated: false };
  if (text.length <= maxChars) return { value, truncated: false };
  return {
    value: {
      truncated: true,
      note: `result exceeded ${maxChars} chars`,
      preview: text.slice(0, maxChars),
    },
    truncated: true,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Execution timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Runs one Code Mode pass in an isolated Dynamic Worker.
 *
 * @param request - Mode, untrusted code, and the mode-specific surface.
 * @param deps - Loader and dispatcher seams; tests inject both.
 * @returns A bounded result or a diagnostic error. Never throws.
 */
export async function runInSandbox(
  request: SandboxRequest,
  deps: SandboxDeps = {},
): Promise<SandboxResult> {
  const started = Date.now();
  const limits: CodeModeLimits = { ...DEFAULT_LIMITS, ...request.limits };
  const code = normalizeCode(request.code);
  const fail = (message: string): SandboxResult => ({
    ok: false,
    message,
    stderr: '',
    durationMs: Date.now() - started,
  });

  if (!code) return fail('code is required');
  if (code.length > limits.maxCodeChars) {
    return fail(`code exceeds ${limits.maxCodeChars} characters`);
  }
  if (!deps.loader) {
    return fail(
      'Code Mode requires the LOADER binding (Dynamic Worker Loader). Add [[worker_loaders]] binding = "LOADER" and deploy on the Workers Paid plan.',
    );
  }

  const handlers = request.mode === 'execute' ? (request.handlers ?? {}) : undefined;
  const stats: SandboxStats = { calls: 0 };
  const makeDispatcher = deps.makeDispatcher ?? defaultMakeDispatcher;

  let dispatcher: unknown;
  try {
    dispatcher = handlers ? await makeDispatcher(handlers, limits, stats) : undefined;
  } catch (err) {
    return fail(`sandbox dispatcher failed: ${errorMessage(err)}`);
  }

  let worker: WorkerStub | undefined;
  let entrypoint: { evaluate(dispatch: unknown, catalog?: unknown): Promise<SandboxResponse> } | undefined;
  try {
    worker = deps.loader.load(
      buildWorkerCode({ mode: request.mode, code, limits, ...(request.catalog ? { catalog: request.catalog } : {}) }),
    );
    entrypoint = worker.getEntrypoint() as unknown as {
      evaluate(dispatch: unknown, catalog?: unknown): Promise<SandboxResponse>;
    };
    const response = await withTimeout(
      entrypoint.evaluate(dispatcher, request.mode === 'search' ? request.catalog : undefined),
      limits.timeoutMs + 1_000,
    );
    if (!response || typeof response !== 'object') {
      return fail('sandbox returned an invalid response');
    }
    if (typeof response.error === 'string') return fail(response.error);
    const capped = capFinalResult(response.value, limits.maxResultChars);
    return {
      ok: true,
      value: capped.value,
      calls: stats.calls,
      logs: Array.isArray(response.logs) ? response.logs.map(String) : [],
      durationMs: Date.now() - started,
      truncated: capped.truncated,
    };
  } catch (err) {
    return fail(errorMessage(err));
  } finally {
    disposeQuietly(entrypoint);
    disposeQuietly(worker);
  }
}
