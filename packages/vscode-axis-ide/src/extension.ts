// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AXIS IDE — VS Code extension host entry (scaffold).
 *
 * Unofficial independent project. Not affiliated with or endorsed by TradingView, Inc.
 * Pine Script™ and TradingView® are trademarks of TradingView, Inc.
 */

import {
  type DiagnosticCollection,
  type ExtensionContext,
  type OutputChannel,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  StatusBarAlignment,
  type StatusBarItem,
  Uri,
  commands,
  extensions,
  languages,
  window,
  workspace,
} from 'vscode';
import { RUN_NO_PINE_MESSAGE, RUN_OUTPUT_CHANNEL_NAME } from './constants';
import { registerChartEditorProvider } from './editors/chart-editor';
import { registerApplyBuiltin, APPLY_BUILTIN_COMMAND } from './host/apply-builtin';
import {
  OPEN_CHART_NO_PINE_MESSAGE,
  PINE_LANGUAGE_ID,
  isPineFilePath,
  planSiblingChartOpen,
  siblingAxisJsonPath,
} from './host/open-chart';
import {
  AxisSecretStorage,
  SECRET_STORE_ERROR,
  formatSecretStatus,
  validateProKey,
  validateWorkerKey,
} from './secrets';
import { isVersionOlderThan } from './semver';
import { DEFAULT_DATAFEED_URL } from './host/history-client';
import { setLogSink } from './host/logger';
import {
  DEFAULT_ENGINE_ENDPOINT,
  ResultsFocusStore,
  RunOrchestrator,
  checkEngineEndpoint,
  notifyChart,
  resolveRunContext,
  scrubSecrets,
  type RunDiagnostic,
  type RunDeps,
} from './run';
import {
  DEFAULT_WORKER_URL,
  LIVE_COMMANDS,
  createLiveChartFanout,
  createLiveSessionBridge,
  formatLiveStatus,
  registerLiveCommands,
  type LiveFrameHandler,
  type LiveSessionBridge,
} from './live';
import { DRAWING_TOOL_TRENDLINE } from './editors/chart-drawings';
import { registerPluginsAndWorkers } from './plugins';
import { ALERTS_ADD_COMMAND, ALERTS_REMOVE_COMMAND, registerAlertsView } from './views/alerts';
import { RESULTS_VIEW_ID, registerResultsView } from './views/results';
import { registerStrategyView } from './views/strategy';
import type { ResultsWebviewViewProvider } from './views/results-panel';
import { registerAxisTreeViews } from './views/trees';
import { WATCHLIST_COMMANDS, registerWatchlist } from './views/watchlist';

/** Keep in sync with package.json contributes.commands (grow with KD-14). */
export const COMMANDS = {
  showRunOutput: 'axis.showRunOutput',
  openChart: 'axis.openChart',
  runScript: 'axis.runScript',
  runScriptSilent: 'axis.runScriptSilent',
  focusResults: 'axis.focusResults',
  setWorkerKey: 'axis.secrets.setWorkerKey',
  setProKey: 'axis.secrets.setProKey',
  clearSecrets: 'axis.secrets.clear',
  applyBuiltin: APPLY_BUILTIN_COMMAND,
  liveStart: LIVE_COMMANDS.liveStart,
  liveStop: LIVE_COMMANDS.liveStop,
  workersProbeAll: 'axis.workers.probeAll',
  alertsAdd: ALERTS_ADD_COMMAND,
  alertsRemove: ALERTS_REMOVE_COMMAND,
  watchlistAdd: WATCHLIST_COMMANDS.add,
  watchlistRemove: WATCHLIST_COMMANDS.remove,
  drawingTrendline: 'axis.chart.drawing.trendline',
} as const;

export { RUN_NO_PINE_MESSAGE };
const PYNE_EXT_ID = 'hoox-sh.pyne';
const PYNE_RECOMMENDED_MIN = '0.5.4';

let runOutput: OutputChannel | undefined;
let statusBar: StatusBarItem | undefined;
let liveStatusBar: StatusBarItem | undefined;
let secrets: AxisSecretStorage | undefined;
let runDiagnostics: DiagnosticCollection | undefined;
let orchestrator: RunOrchestrator | undefined;
let resultsStore: ResultsFocusStore | undefined;
let resultsProvider: ResultsWebviewViewProvider | undefined;
let strategyProvider: ResultsWebviewViewProvider | undefined;
let liveBridge: LiveSessionBridge | undefined;
/** Aborts the previous command-level run when a new one starts. */
let commandAbort: AbortController | undefined;
/** Set in deactivate so any late work skips after shutdown. */
let deactivated = false;

function readLiveSettings(): { workerUrl: string; liveEnabled: boolean } {
  let workerUrl = DEFAULT_WORKER_URL;
  let liveEnabled = true;
  try {
    const workerCfg = workspace.getConfiguration('axis.worker');
    const url = workerCfg.get<string>('url');
    if (typeof url === 'string' && url.trim()) workerUrl = url.trim();
  } catch {
    // keep default
  }
  try {
    const liveCfg = workspace.getConfiguration('axis.live');
    liveEnabled = liveCfg.get<boolean>('enabled', true) !== false;
  } catch {
    // keep default
  }
  return { workerUrl, liveEnabled };
}

function applyLiveHud(label: { text: string; tooltip: string }): void {
  if (deactivated || !liveStatusBar) return;
  try {
    liveStatusBar.text = label.text;
    liveStatusBar.tooltip = label.tooltip;
  } catch {
    // disposed
  }
}

function severityOf(s: RunDiagnostic['severity']): DiagnosticSeverity {
  if (s === 'warning') return DiagnosticSeverity.Warning;
  if (s === 'info') return DiagnosticSeverity.Information;
  return DiagnosticSeverity.Error;
}

function applyRunDiagnostics(
  collection: DiagnosticCollection | undefined,
  uri: string | undefined,
  items: RunDiagnostic[],
): void {
  if (!collection) return;
  try {
    if (!uri) return;
    const target = Uri.parse(uri);
    const diags = items.map((item) => {
      const line = Math.max(0, (item.line ?? 1) - 1);
      const col = Math.max(0, item.column ?? 0);
      const range = new Range(new Position(line, col), new Position(line, col + 1));
      return new Diagnostic(
        range,
        scrubSecrets(item.message),
        severityOf(item.severity),
      );
    });
    // Empty items clears only this URI — never wipe the whole collection.
    collection.set(target, diags);
  } catch {
    // hostile uri / disposed collection
  }
}

function beginCommandAbort(): AbortSignal {
  try {
    commandAbort?.abort();
  } catch {
    // ignore
  }
  commandAbort = new AbortController();
  return commandAbort.signal;
}

async function readSiblingChartJson(pineFsPath: string): Promise<string | null> {
  try {
    const sibling = siblingAxisJsonPath(pineFsPath);
    if (!sibling) return null;
    const bytes = await workspace.fs.readFile(Uri.file(sibling));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function readEngineSettings(): {
  engineId: string;
  endpoint: string;
  allowRemote: boolean;
  historyBarsSetting?: number;
  useMockBars: boolean;
  datafeedUrl: string;
} {
  let engineId = 'server';
  let endpoint = DEFAULT_ENGINE_ENDPOINT;
  let allowRemote = false;
  let historyBarsSetting: number | undefined;
  let useMockBars = true;
  let datafeedUrl = DEFAULT_DATAFEED_URL;
  try {
    const engineCfg = workspace.getConfiguration('axis.engine');
    const id = engineCfg.get<string>('id');
    if (typeof id === 'string' && id.trim()) engineId = id.trim();
    const ep = engineCfg.get<string>('endpoint');
    if (typeof ep === 'string' && ep.trim()) endpoint = ep.trim();
    // Application-scoped opt-in — workspace must not redirect authenticated calls.
    allowRemote = engineCfg.get<boolean>('allowRemoteEndpoint', false) === true;
  } catch {
    // keep defaults
  }
  try {
    const chartCfg = workspace.getConfiguration('axis.chart');
    const hb = chartCfg.get<number>('historyBars');
    if (typeof hb === 'number' && Number.isFinite(hb)) historyBarsSetting = hb;
    useMockBars = chartCfg.get<boolean>('useMockBars', true) !== false;
  } catch {
    // keep defaults
  }
  try {
    const dfCfg = workspace.getConfiguration('axis.datafeed');
    const url = dfCfg.get<string>('url');
    if (typeof url === 'string' && url.trim()) datafeedUrl = url.trim();
  } catch {
    // keep defaults
  }
  return { engineId, endpoint, allowRemote, historyBarsSetting, useMockBars, datafeedUrl };
}

/**
 * Run the active Pine buffer against Pro `/run`.
 * Uses mock bars when `axis.chart.useMockBars` is true; otherwise HistoryClient.
 * `focus` selects §7.1 Results focus rules. Returns a short status string.
 */
async function runScriptCommand(focus: boolean): Promise<string | undefined> {
  if (deactivated) return undefined;
  try {
    const editor = window.activeTextEditor;
    const doc = editor?.document;
    if (!doc || doc.languageId !== PINE_LANGUAGE_ID) {
      void window.showErrorMessage(RUN_NO_PINE_MESSAGE);
      return RUN_NO_PINE_MESSAGE;
    }
    if (!secrets || !orchestrator || !resultsStore || !runOutput) {
      const err = 'AXIS: Run Script is not ready (activate incomplete).';
      void window.showErrorMessage(err);
      return err;
    }
    const secretStore = secrets;
    const runOrch = orchestrator;
    const focusStore = resultsStore;
    const output = runOutput;

    const script = doc.getText();
    const pinePath = doc.uri.scheme === 'file' ? doc.uri.fsPath : '';
    const chartJson = pinePath ? await readSiblingChartJson(pinePath) : null;
    if (deactivated) return undefined;

    const settings = readEngineSettings();
    const endpointCheck = checkEngineEndpoint(settings.endpoint, {
      allowRemote: settings.allowRemote,
    });
    if (!endpointCheck.ok) {
      const err = scrubSecrets(endpointCheck.error);
      output.appendLine(err);
      if (focus) void window.showErrorMessage(err);
      return err;
    }

    const signal = beginCommandAbort();
    const resolved = await resolveRunContext(chartJson, {
      historyBarsSetting: settings.historyBarsSetting,
      engineId: settings.engineId,
      endpoint: endpointCheck.endpoint,
      useMockBars: settings.useMockBars,
      datafeedUrl: settings.datafeedUrl,
      allowRemote: settings.allowRemote,
      signal,
    });
    if (deactivated) return undefined;
    if (!resolved.ok) {
      const err = scrubSecrets(resolved.error);
      output.appendLine(err);
      if (focus) void window.showErrorMessage(err);
      return err;
    }
    const ctx = resolved.ctx;

    const deps: RunDeps = {
      secrets: {
        getProKey: () => secretStore.getProKey(),
      },
      endpoint: endpointCheck.endpoint,
      bus: { notifyChart },
      results: focusStore,
      output: {
        appendLine(line: string) {
          output.appendLine(scrubSecrets(line));
        },
      },
      diagnostics: {
        set: (uri, items) => {
          applyRunDiagnostics(runDiagnostics, uri, items);
        },
      },
    };

    const outcome = await runOrch.run(
      {
        script,
        uri: doc.uri.toString(),
        mode: ctx.mode,
        focus,
        bars: ctx.bars,
        seriesKey: ctx.seriesKey,
        engineId: ctx.engineId,
        baseSeq: ctx.seq,
        signal,
      },
      deps,
    );
    if (deactivated) return undefined;

    if (outcome.ok) {
      return `ok:${outcome.runId}`;
    }
    if (outcome.reason === 'stale') return 'stale';
    if (outcome.reason === 'aborted') return 'aborted';
    const err = scrubSecrets(outcome.error || 'AXIS run failed');
    // Toast only for focused user runs — silent path stays quiet.
    if (focus) void window.showErrorMessage(err);
    return err;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const err = scrubSecrets(`AXIS: Run Script failed: ${message}`);
    runOutput?.appendLine(err);
    if (focus) void window.showErrorMessage(err);
    return err;
  }
}
function warnIfPyneBelowRecommended(): void {
  if (deactivated) return;
  const pyne = extensions.getExtension(PYNE_EXT_ID);
  if (!pyne) {
    console.warn(
      `[axis-ide] Recommended dependency ${PYNE_EXT_ID} is not installed.`,
    );
    return;
  }
  const ver = String(pyne.packageJSON?.version ?? '');
  if (ver && isVersionOlderThan(ver, PYNE_RECOMMENDED_MIN)) {
    console.warn(
      `[axis-ide] ${PYNE_EXT_ID} ${ver} is older than recommended ≥${PYNE_RECOMMENDED_MIN}.`,
    );
  }
}

/** StatusBar text + tooltip show set/missing only — never key material. */
async function refreshSecretStatus(): Promise<void> {
  if (deactivated || !statusBar || !secrets) return;
  try {
    const worker = (await secrets.hasWorkerKey()) ? 'set' : 'missing';
    const pro = (await secrets.hasProKey()) ? 'set' : 'missing';
    if (deactivated || !statusBar) return;
    const label = formatSecretStatus(worker, pro);
    statusBar.text = label.text;
    statusBar.tooltip = label.tooltip;
  } catch {
    if (deactivated || !statusBar) return;
    statusBar.text = '$(graph) AXIS';
    statusBar.tooltip = 'AXIS IDE\nWorker key: unknown\nPro key: unknown';
  }
}

async function promptAndSetWorkerKey(): Promise<string | undefined> {
  if (deactivated || !secrets) return undefined;
  const raw = await window.showInputBox({
    title: 'AXIS Worker API Key',
    prompt: 'Paste a Worker key (pn_ + 48 hex). Empty clears. SecretStorage only.',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'pn_…',
    validateInput: (value) => {
      const t = value.trim();
      if (!t) return null; // empty → clear on accept
      const r = validateWorkerKey(t);
      return r.ok ? null : r.error;
    },
  });
  if (deactivated || raw === undefined || !secrets) return undefined;
  try {
    const result = await secrets.setWorkerKey(raw);
    if (!result.ok) {
      void window.showErrorMessage(result.error);
      return result.error;
    }
    await refreshSecretStatus();
    const cleared = raw.trim().length === 0;
    void window.showInformationMessage(
      cleared
        ? 'AXIS Worker key cleared (SecretStorage).'
        : 'AXIS Worker key saved (SecretStorage).',
    );
    return cleared ? 'cleared' : 'ok';
  } catch {
    void window.showErrorMessage(SECRET_STORE_ERROR);
    return SECRET_STORE_ERROR;
  }
}

async function promptAndSetProKey(): Promise<string | undefined> {
  if (deactivated || !secrets) return undefined;
  const raw = await window.showInputBox({
    title: 'AXIS Pro API Key',
    prompt: 'Paste a PYNE Pro key (pyn_…). Empty clears. SecretStorage only.',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'pyn_…',
    validateInput: (value) => {
      const t = value.trim();
      if (!t) return null;
      const r = validateProKey(t);
      return r.ok ? null : r.error;
    },
  });
  if (deactivated || raw === undefined || !secrets) return undefined;
  try {
    const result = await secrets.setProKey(raw);
    if (!result.ok) {
      void window.showErrorMessage(result.error);
      return result.error;
    }
    await refreshSecretStatus();
    const cleared = raw.trim().length === 0;
    void window.showInformationMessage(
      cleared
        ? 'AXIS Pro key cleared (SecretStorage).'
        : 'AXIS Pro key saved (SecretStorage).',
    );
    return cleared ? 'cleared' : 'ok';
  } catch {
    void window.showErrorMessage(SECRET_STORE_ERROR);
    return SECRET_STORE_ERROR;
  }
}

async function promptAndClearSecrets(): Promise<string | undefined> {
  if (deactivated || !secrets) return undefined;
  const confirm = await window.showWarningMessage(
    'Clear stored AXIS Worker and Pro API keys from SecretStorage?',
    { modal: true },
    'Clear',
  );
  if (deactivated || confirm !== 'Clear' || !secrets) return undefined;
  try {
    // Matches confirm copy — Worker + Pro only (not pyne-worker / git PAT).
    await secrets.clearWorkerAndProKeys();
    await refreshSecretStatus();
    void window.showInformationMessage('AXIS Worker and Pro secrets cleared.');
    return 'cleared';
  } catch {
    void window.showErrorMessage(SECRET_STORE_ERROR);
    return SECRET_STORE_ERROR;
  }
}

/**
 * Open or create a sibling `*.axis.json` beside the active Pine buffer so
 * `axis.chart` resolves. Existing siblings are not rewritten. Returns the chart
 * URI string or an error message. Never awaits UI dismissal (tests/CI).
 */
/**
 * Focus the Results panel (§7.1). Optional `runId` retargets `resultsFocusId`
 * and posts `results.set`. Shows the Results WebviewView when possible.
 */
async function focusResultsCommand(runId?: string): Promise<string | undefined> {
  if (deactivated) return undefined;
  try {
    if (!resultsStore) {
      const err = 'AXIS: Focus Results is not ready (activate incomplete).';
      void window.showErrorMessage(err);
      return err;
    }
    if (typeof runId === 'string' && runId.trim()) {
      resultsStore.focusResults(runId.trim());
    }
    // Reveal contributed view — VS Code registers `{viewId}.focus`.
    try {
      await commands.executeCommand(`${RESULTS_VIEW_ID}.focus`);
    } catch {
      resultsProvider?.reveal();
    }
    strategyProvider?.reveal();
    const focusId = resultsStore.getResultsFocusId();
    return focusId ?? 'ok';
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const err = scrubSecrets(`AXIS: Focus Results failed: ${message}`);
    void window.showErrorMessage(err);
    return err;
  }
}

async function openChartCommand(): Promise<string | undefined> {
  if (deactivated) return undefined;
  try {
    const editor = window.activeTextEditor;
    const doc = editor?.document;
    const fsPath = doc?.uri?.fsPath ?? '';
    const langOk = doc?.languageId === PINE_LANGUAGE_ID;
    const pathOk = isPineFilePath(fsPath);
    if (doc?.uri.scheme !== 'file' || (!langOk && !pathOk)) {
      void window.showErrorMessage(OPEN_CHART_NO_PINE_MESSAGE);
      return OPEN_CHART_NO_PINE_MESSAGE;
    }

    const pineFileName =
      doc.uri.path.split('/').pop() ||
      doc.fileName.split(/[/\\]/).pop() ||
      'script.pyne';

    // Probe sibling path first via planner (validates Pine suffix).
    const probe = planSiblingChartOpen({
      pinePath: fsPath,
      pineFileName,
      siblingExists: true,
    });
    if (!probe.ok) {
      void window.showErrorMessage(probe.error);
      return probe.error;
    }

    const siblingUri = Uri.file(probe.siblingPath);
    let exists = false;
    try {
      await workspace.fs.stat(siblingUri);
      exists = true;
    } catch {
      exists = false;
    }
    if (deactivated) return undefined;

    let historyBarsSetting: number | undefined;
    try {
      const hb = workspace.getConfiguration('axis.chart').get<number>('historyBars');
      if (typeof hb === 'number' && Number.isFinite(hb)) historyBarsSetting = hb;
    } catch {
      historyBarsSetting = undefined;
    }

    const plan = planSiblingChartOpen({
      pinePath: fsPath,
      pineFileName,
      siblingExists: exists,
      historyBarsSetting,
    });
    if (!plan.ok) {
      void window.showErrorMessage(plan.error);
      return plan.error;
    }
    if (plan.writeBytes) {
      await workspace.fs.writeFile(siblingUri, plan.writeBytes);
    }
    if (deactivated) return undefined;

    // Prefer vscode.open so the custom editor selector for *.axis.json resolves.
    await commands.executeCommand('vscode.open', siblingUri);
    return siblingUri.toString();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const err = `AXIS: Open Chart failed: ${message}`;
    void window.showErrorMessage(err);
    return err;
  }
}

export function activate(context: ExtensionContext): void {
  deactivated = false;

  secrets = new AxisSecretStorage(context.secrets);
  orchestrator = new RunOrchestrator();
  resultsStore = new ResultsFocusStore();
  resultsProvider = registerResultsView(context, resultsStore);
  strategyProvider = registerStrategyView(context, resultsStore);
  registerAxisTreeViews(context);
  registerAlertsView(context);
  registerWatchlist(context);
  registerApplyBuiltin(context);
  registerPluginsAndWorkers(context, {
    get: <T>(key: string) => context.globalState.get<T>(key),
    update: (key, value) => context.globalState.update(key, value),
  });

  runOutput = window.createOutputChannel(RUN_OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(runOutput);
  // Bridge host logger (history failures, etc.) into AXIS Run OutputChannel.
  setLogSink((level, message) => {
    const line = `[${level}] ${message}`;
    try {
      runOutput?.appendLine(scrubSecrets(line));
    } catch {
      // disposed
    }
    if (level === 'error') console.error(`[axis] ${message}`);
    else if (level === 'warn') console.warn(`[axis] ${message}`);
  });

  runDiagnostics = languages.createDiagnosticCollection('axis-run');
  context.subscriptions.push(runDiagnostics);

  statusBar = window.createStatusBarItem('axis.ide.status', StatusBarAlignment.Left, 100);
  statusBar.name = 'AXIS IDE';
  statusBar.text = '$(graph) AXIS';
  statusBar.tooltip = 'AXIS IDE';
  statusBar.command = COMMANDS.showRunOutput;
  context.subscriptions.push(statusBar);
  statusBar.show();

  liveStatusBar = window.createStatusBarItem('axis.ide.live', StatusBarAlignment.Left, 99);
  liveStatusBar.name = 'AXIS Live';
  liveStatusBar.command = COMMANDS.liveStart;
  context.subscriptions.push(liveStatusBar);
  const offHud = formatLiveStatus('off');
  applyLiveHud(offHud);
  liveStatusBar.show();

  const liveSettings = readLiveSettings();
  const secretStore = secrets;
  // Holder so fan-out can close over the bridge after construction.
  let onFrame: LiveFrameHandler = () => {};
  const bridge = createLiveSessionBridge({
    secrets: {
      getWorkerKey: async () => {
        if (!secretStore) return undefined;
        return secretStore.getWorkerKey();
      },
    },
    workerUrl: liveSettings.workerUrl,
    liveEnabled: liveSettings.liveEnabled,
    output: {
      appendLine(line: string) {
        runOutput?.appendLine(scrubSecrets(line));
      },
    },
    onFrame: (frame) => {
      onFrame(frame);
    },
    onStatus: (_state, label) => {
      applyLiveHud(label);
    },
  });
  liveBridge = bridge;
  const fanout = createLiveChartFanout({
    seriesKey: '',
    filterSeriesKey: false,
    output: {
      appendLine(line: string) {
        runOutput?.appendLine(scrubSecrets(line));
      },
    },
    resumeDeps: {
      output: {
        appendLine(line: string) {
          runOutput?.appendLine(scrubSecrets(line));
        },
      },
      markDegraded: (reason) => bridge.markDegraded(reason),
      remint: () => bridge.start(),
    },
  });
  onFrame = fanout.onFrame;
  applyLiveHud(bridge.getStatusLabel());

  context.subscriptions.push(
    registerChartEditorProvider(context),
    commands.registerCommand(COMMANDS.showRunOutput, () => {
      if (deactivated) return;
      runOutput?.show(true);
      return RUN_OUTPUT_CHANNEL_NAME;
    }),
    commands.registerCommand(COMMANDS.openChart, () => openChartCommand()),
    commands.registerCommand(COMMANDS.runScript, () => runScriptCommand(true)),
    commands.registerCommand(COMMANDS.runScriptSilent, () => runScriptCommand(false)),
    commands.registerCommand(COMMANDS.focusResults, (runId?: string) =>
      focusResultsCommand(runId),
    ),
    commands.registerCommand(COMMANDS.setWorkerKey, () => promptAndSetWorkerKey()),
    commands.registerCommand(COMMANDS.setProKey, () => promptAndSetProKey()),
    commands.registerCommand(COMMANDS.clearSecrets, () => promptAndClearSecrets()),
    // Webview owns Trendline chrome; palette entry documents the in-chart tool.
    commands.registerCommand(COMMANDS.drawingTrendline, () => {
      void window.showInformationMessage(
        `AXIS: Use the chart toolbar Trendline tool (${DRAWING_TOOL_TRENDLINE}).`,
      );
    }),
    ...registerLiveCommands(commands, bridge),
  );

  // Sync check — avoid deferred timers that can outlive deactivate.
  warnIfPyneBelowRecommended();
  const ver = String(context.extension.packageJSON?.version ?? '');
  runOutput.appendLine(ver ? `AXIS IDE activated (${ver}).` : 'AXIS IDE activated.');

  // Fire-and-forget status refresh; guard inside refreshSecretStatus.
  void refreshSecretStatus();
}

export function deactivate(): void {
  deactivated = true;
  try {
    commandAbort?.abort();
  } catch {
    // ignore
  }
  commandAbort = undefined;
  try {
    liveBridge?.stop();
  } catch {
    // ignore
  }
  liveBridge = undefined;
  try {
    orchestrator?.abortAll();
  } catch {
    // ignore
  }
  setLogSink(null);
  runOutput = undefined;
  statusBar = undefined;
  liveStatusBar = undefined;
  secrets = undefined;
  runDiagnostics = undefined;
  orchestrator = undefined;
  resultsStore = undefined;
  resultsProvider = undefined;
  strategyProvider = undefined;
}
