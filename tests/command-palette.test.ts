/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Command palette pure registry: fuzzy score, filter ranking, default specs.
 * Invariant: empty query lists all; non-matches score 0 and drop out.
 */

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_COMMAND_SPECS,
  buildDefaultCommands,
  filterCommands,
  scoreCommand,
  scoreMatch,
  type CommandActions,
  type CommandSpec,
} from '../src/ui/command-registry';

const SAMPLE: CommandSpec[] = [
  {
    id: 'panel.watchlist',
    title: 'Toggle Watchlist',
    category: 'panels',
    keywords: ['list', 'symbols', 'sidebar'],
  },
  {
    id: 'theme.toggle',
    title: 'Toggle Theme',
    category: 'theme',
    keywords: ['dark', 'light'],
  },
  {
    id: 'action.run',
    title: 'Run Script',
    category: 'actions',
    keywords: ['execute', 'pine'],
  },
  {
    id: 'chart.grid.2h',
    title: 'Chart Layout: 2 Horizontal',
    category: 'chart',
    keywords: ['2h', 'side by side'],
  },
];

describe('scoreMatch', () => {
  it('returns neutral score for empty query', () => {
    expect(scoreMatch('Toggle Watchlist', '')).toBe(1);
    expect(scoreMatch('Toggle Watchlist', '   ')).toBe(1);
  });

  it('returns 0 when haystack empty and query non-empty', () => {
    expect(scoreMatch('', 'abc')).toBe(0);
  });

  it('ranks exact > prefix > substring', () => {
    const exact = scoreMatch('run', 'run');
    const prefix = scoreMatch('run script', 'run');
    const mid = scoreMatch('please run now', 'run');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
  });

  it('matches fuzzy subsequences', () => {
    expect(scoreMatch('Toggle Watchlist', 'twl')).toBeGreaterThan(0);
    expect(scoreMatch('Toggle Watchlist', 'togg')).toBeGreaterThan(0);
    expect(scoreMatch('Toggle Watchlist', 'xyz')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(scoreMatch('Toggle Theme', 'THEME')).toBeGreaterThan(0);
    expect(scoreMatch('Toggle Theme', 'theme')).toBe(scoreMatch('Toggle Theme', 'THEME'));
  });
});

describe('scoreCommand', () => {
  it('scores title hits', () => {
    expect(scoreCommand(SAMPLE[0]!, 'watchlist')).toBeGreaterThan(0);
  });

  it('scores keyword hits when title misses', () => {
    const score = scoreCommand(SAMPLE[0]!, 'sidebar');
    expect(score).toBeGreaterThan(0);
  });

  it('scores id / category', () => {
    expect(scoreCommand(SAMPLE[2]!, 'action.run')).toBeGreaterThan(0);
    expect(scoreCommand(SAMPLE[1]!, 'theme')).toBeGreaterThan(0);
  });
});

describe('filterCommands', () => {
  it('returns all commands for empty query (stable order)', () => {
    const ranked = filterCommands(SAMPLE, '');
    expect(ranked).toHaveLength(SAMPLE.length);
    expect(ranked.map((c) => c.id)).toEqual(SAMPLE.map((c) => c.id));
    expect(ranked.every((c) => c.score === 1)).toBe(true);
  });

  it('filters and ranks by score descending', () => {
    const ranked = filterCommands(SAMPLE, 'toggle');
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    expect(ranked.every((c) => c.score > 0)).toBe(true);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
    // Theme / watchlist both match "toggle"
    const ids = ranked.map((c) => c.id);
    expect(ids).toContain('panel.watchlist');
    expect(ids).toContain('theme.toggle');
    expect(ids).not.toContain('chart.grid.2h');
  });

  it('matches keywords (e.g. 2h → horizontal layout)', () => {
    const ranked = filterCommands(SAMPLE, '2h');
    expect(ranked.some((c) => c.id === 'chart.grid.2h')).toBe(true);
  });

  it('returns empty when nothing matches', () => {
    expect(filterCommands(SAMPLE, 'zzzz-nope')).toEqual([]);
  });

  it('prefers better title matches over weak keyword noise', () => {
    const cmds: CommandSpec[] = [
      { id: 'a', title: 'Run Script', keywords: ['x'] },
      { id: 'b', title: 'Something Else', keywords: ['runnable helper'] },
    ];
    const ranked = filterCommands(cmds, 'run');
    expect(ranked[0]!.id).toBe('a');
  });
});

describe('DEFAULT_COMMAND_SPECS', () => {
  it('includes required panel / theme / chart / run / focus commands', () => {
    const ids = new Set(DEFAULT_COMMAND_SPECS.map((c) => c.id));
    for (const id of [
      'panel.watchlist',
      'panel.editor',
      'panel.results',
      'panel.logs',
      'panel.layers',
      'panel.indicators',
      'panel.dataview',
      'panel.library',
      'theme.toggle',
      'chart.grid.1',
      'chart.grid.2h',
      'chart.grid.2v',
      'chart.grid.4',
      'action.run',
      'action.focus-symbol',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('includes editor power command ids', () => {
    const ids = new Set(DEFAULT_COMMAND_SPECS.map((c) => c.id));
    for (const id of [
      'editor.toggle-ruler',
      'editor.toggle-inline-debug',
      'editor.toggle-debug-pins',
      'editor.toggle-profiler',
      'editor.goto-line',
      'editor.save-library',
      'editor.focus',
      'git.push',
      'git.pull',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('has unique ids', () => {
    const ids = DEFAULT_COMMAND_SPECS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fuzzy keywords find ruler / debug / pin / problem / git', () => {
    for (const [query, id] of [
      ['ruler', 'editor.toggle-ruler'],
      ['debug', 'editor.toggle-inline-debug'],
      ['pin', 'editor.toggle-debug-pins'],
      ['problem', 'editor.toggle-inline-debug'],
      ['profiler', 'editor.toggle-profiler'],
      ['git', 'git.push'],
    ] as const) {
      const ranked = filterCommands([...DEFAULT_COMMAND_SPECS], query);
      expect(ranked.some((c) => c.id === id)).toBe(true);
    }
  });
});

describe('buildDefaultCommands', () => {
  const stubActions = (): CommandActions => {
    const noop = () => {};
    return {
      toggleWatchlist: noop,
      toggleEditor: noop,
      toggleResults: noop,
      toggleLogs: noop,
      toggleLayers: noop,
      toggleIndicators: noop,
      toggleDataView: noop,
      toggleScriptLogs: noop,
      toggleTheme: noop,
      setChartGridMode: noop,
      runScript: noop,
      focusSymbol: noop,
      loadSymbol: noop,
      reloadChart: noop,
      toggleLive: noop,
      openSettings: noop,
      openPlugins: noop,
      openScriptSettings: noop,
      resetUiLayout: noop,
      toggleEditorRuler: noop,
      toggleInlineDebug: noop,
      toggleDebugPins: noop,
      toggleProfiler: noop,
      jumpToLine: noop,
      saveToLibrary: noop,
      focusEditor: noop,
      gitPush: noop,
      gitPull: noop,
    };
  };

  it('wires run handlers for default specs', () => {
    let ran = false;
    const actions = stubActions();
    actions.runScript = () => {
      ran = true;
    };
    const cmds = buildDefaultCommands(actions);
    const run = cmds.find((c) => c.id === 'action.run');
    expect(run).toBeTruthy();
    run!.run();
    expect(ran).toBe(true);
  });

  it('omits optional commands when handlers missing', () => {
    const actions = stubActions();
    delete actions.openSettings;
    delete actions.toggleScriptLogs;
    delete actions.toggleEditorRuler;
    delete actions.gitPush;
    delete actions.gitPull;
    const cmds = buildDefaultCommands(actions);
    const ids = new Set(cmds.map((c) => c.id));
    expect(ids.has('action.settings')).toBe(false);
    expect(ids.has('panel.scriptlogs')).toBe(false);
    expect(ids.has('editor.toggle-ruler')).toBe(false);
    expect(ids.has('git.push')).toBe(false);
    expect(ids.has('git.pull')).toBe(false);
    expect(ids.has('panel.watchlist')).toBe(true);
    // Core editor power commands remain when their handlers are present
    expect(ids.has('editor.toggle-inline-debug')).toBe(true);
    expect(ids.has('editor.goto-line')).toBe(true);
    expect(ids.has('editor.save-library')).toBe(true);
    expect(ids.has('editor.focus')).toBe(true);
  });

  it('wires editor power command handlers', () => {
    const seen: string[] = [];
    const actions = stubActions();
    actions.toggleInlineDebug = () => {
      seen.push('debug');
    };
    actions.toggleProfiler = () => {
      seen.push('profiler');
    };
    actions.jumpToLine = () => {
      seen.push('goto');
    };
    actions.saveToLibrary = () => {
      seen.push('save');
    };
    const cmds = buildDefaultCommands(actions);
    for (const id of [
      'editor.toggle-inline-debug',
      'editor.toggle-profiler',
      'editor.goto-line',
      'editor.save-library',
    ]) {
      const cmd = cmds.find((c) => c.id === id);
      expect(cmd).toBeTruthy();
      cmd!.run();
    }
    expect(seen).toEqual(['debug', 'profiler', 'goto', 'save']);
  });

  it('filtered default set still ranks panel toggles', () => {
    const cmds = buildDefaultCommands(stubActions());
    const ranked = filterCommands(cmds, 'layers');
    expect(ranked[0]?.id).toBe('panel.layers');
  });

  it('ranks editor ruler / git by keyword', () => {
    const cmds = buildDefaultCommands(stubActions());
    expect(filterCommands(cmds, 'ruler')[0]?.id).toBe('editor.toggle-ruler');
    const gitRanked = filterCommands(cmds, 'git');
    expect(gitRanked.some((c) => c.id === 'git.push' || c.id === 'git.pull')).toBe(true);
  });
});
