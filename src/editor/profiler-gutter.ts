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
 * CodeMirror 6 **Profiler mode** gutter — % / bar markers per instrumented line.
 *
 * TradingView-style cost display: compact `N%` (optional bar + hot accent for
 * top-3 lines). Drive via {@link setProfilerData} / {@link applyProfilerProfile};
 * include {@link profilerGutterExtension} always and push `null` to clear/hide.
 *
 * @module editor/profiler-gutter
 */

import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import {
  StateField,
  StateEffect,
  RangeSetBuilder,
  RangeSet,
  type Extension,
  type StateEffectType,
  type Text,
  type Transaction,
} from '@codemirror/state';
import {
  type RunProfile,
  type ProfileLineStat,
  profileLineMap,
  normalizeRunProfile,
} from '../results/profiler';

export type { RunProfile, ProfileLineStat };
export { profileLineMap, normalizeRunProfile };

/** Effect to push a new profile (or null to clear / hide the gutter). */
export const setProfilerData: StateEffectType<RunProfile | null> =
  StateEffect.define<RunProfile | null>();

interface ProfilerState {
  profile: RunProfile | null;
  markers: RangeSet<GutterMarker>;
}

const emptyProfilerState: ProfilerState = {
  profile: null,
  markers: RangeSet.empty,
};

/** Format percent for the gutter chip (compact). */
function formatPct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  if (pct < 10) return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/** Tooltip: `Line N · X.X ms · Y execs · Z% of body cost` */
function markerTitle(lineNo: number, stat: ProfileLineStat): string {
  const ms = Number.isFinite(stat.ms) ? stat.ms.toFixed(1) : '0.0';
  const execs = Number.isFinite(stat.execs) ? Math.trunc(stat.execs) : 0;
  const pct = Number.isFinite(stat.pct) ? stat.pct.toFixed(1) : '0.0';
  return `Line ${lineNo} · ${ms} ms · ${execs} execs · ${pct}% of script body (Σ line cost)`;
}

class ProfilerPctMarker extends GutterMarker {
  constructor(
    readonly lineNo: number,
    readonly stat: ProfileLineStat,
    readonly hot: boolean,
    readonly rank: number,
  ) {
    super();
  }

  eq(other: GutterMarker): boolean {
    if (!(other instanceof ProfilerPctMarker)) return false;
    return (
      other.lineNo === this.lineNo &&
      other.hot === this.hot &&
      other.rank === this.rank &&
      other.stat.ms === this.stat.ms &&
      other.stat.execs === this.stat.execs &&
      other.stat.pct === this.stat.pct
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-profiler-pct' + (this.hot ? ' cm-profiler-hot' : '');
    wrap.title = markerTitle(this.lineNo, this.stat);

    const barPct = Math.max(0, Math.min(100, this.stat.pct));
    wrap.style.setProperty('--cm-profiler-bar', `${barPct}%`);

    const bar = document.createElement('span');
    bar.className = 'cm-profiler-bar';
    bar.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'cm-profiler-label';
    // Top hot line gets a flame; ranks 2–3 rely on accent class only.
    const prefix = this.rank === 1 ? '🔥' : '';
    label.textContent = prefix + formatPct(this.stat.pct);

    wrap.appendChild(bar);
    wrap.appendChild(label);
    return wrap;
  }
}

/** Spacer so the gutter keeps a stable width while a profile is active. */
class ProfilerSpacer extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-profiler-pct cm-profiler-spacer';
    el.textContent = '100%';
    return el;
  }

  eq(other: GutterMarker): boolean {
    return other instanceof ProfilerSpacer;
  }
}

const profilerSpacer = new ProfilerSpacer();

function buildMarkers(doc: Text, profile: RunProfile | null): RangeSet<GutterMarker> {
  const map = profileLineMap(profile);
  if (map.size === 0) return RangeSet.empty;

  const ranked = [...map.entries()].sort((a, b) => {
    const dp = b[1].pct - a[1].pct;
    if (dp !== 0) return dp;
    return b[1].ms - a[1].ms;
  });
  const hotRank = new Map<number, number>();
  for (let i = 0; i < Math.min(3, ranked.length); i++) {
    hotRank.set(ranked[i][0], i + 1);
  }

  const builder = new RangeSetBuilder<GutterMarker>();
  const lineNos = [...map.keys()].sort((a, b) => a - b);
  for (const lineNo of lineNos) {
    if (lineNo < 1 || lineNo > doc.lines) continue;
    const stat = map.get(lineNo)!;
    if (!(stat.ms > 0 || stat.execs > 0 || stat.pct > 0)) continue;
    const line = doc.line(lineNo);
    const rank = hotRank.get(lineNo) ?? 0;
    builder.add(
      line.from,
      line.from,
      new ProfilerPctMarker(lineNo, stat, rank > 0, rank),
    );
  }
  return builder.finish();
}

function hasProfilerMarkers(markers: RangeSet<GutterMarker>): boolean {
  let found = false;
  markers.between(0, 1e9, () => {
    found = true;
    return false;
  });
  return found;
}

/**
 * State field holding the active profile + derived gutter markers.
 * Rebuilds markers on profile effects and document changes.
 */
export const profilerStateField = StateField.define<ProfilerState>({
  create() {
    return emptyProfilerState;
  },
  update(value: ProfilerState, tr: Transaction): ProfilerState {
    let profile = value.profile;
    let fromEffect = false;
    for (const e of tr.effects) {
      if (e.is(setProfilerData)) {
        profile = e.value;
        fromEffect = true;
      }
    }
    if (fromEffect) {
      return {
        profile,
        markers: buildMarkers(tr.state.doc, profile),
      };
    }
    if (tr.docChanged && profile) {
      return {
        profile,
        markers: buildMarkers(tr.state.doc, profile),
      };
    }
    if (tr.docChanged) {
      return {
        profile,
        markers: value.markers.map(tr.changes),
      };
    }
    return value;
  },
});

/** Theme for profiler gutter chips (void indigo). Hidden until profile data exists. */
export const profilerGutterTheme = EditorView.baseTheme({
  // Prefer hide when no lines — shown only under `.cm-profiler-has-data`.
  '.cm-profiler-gutter': {
    display: 'none',
    border: 'none',
  },
  '&.cm-profiler-has-data .cm-profiler-gutter': {
    display: 'flex',
    minWidth: '3.25em',
  },
  '.cm-profiler-gutter .cm-gutterElement': {
    padding: '0 2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  '.cm-profiler-pct': {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '2px',
    minWidth: '2.75em',
    maxWidth: '4.5em',
    height: '1.1em',
    padding: '0 3px',
    fontSize: '10px',
    lineHeight: '1',
    fontVariantNumeric: 'tabular-nums',
    color: '#a8adbf',
    borderRadius: '2px',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  '.cm-profiler-bar': {
    position: 'absolute',
    left: '0',
    top: '0',
    bottom: '0',
    width: 'var(--cm-profiler-bar, 0%)',
    background: 'rgba(147, 159, 255, 0.22)',
    borderRadius: '2px',
    pointerEvents: 'none',
    zIndex: '0',
  },
  '.cm-profiler-label': {
    position: 'relative',
    zIndex: '1',
    whiteSpace: 'nowrap',
  },
  '.cm-profiler-hot': {
    color: '#ffb454',
    fontWeight: '600',
  },
  '.cm-profiler-hot .cm-profiler-bar': {
    background: 'rgba(255, 180, 84, 0.28)',
  },
  '.cm-profiler-spacer': {
    visibility: 'hidden',
    pointerEvents: 'none',
  },
});

/**
 * Extension factory. Always safe to include; gutter hides when profile is
 * null / has no line data (driven by {@link setProfilerData}).
 */
export function profilerGutterExtension(): Extension {
  return [
    profilerStateField,
    profilerGutterTheme,
    gutter({
      class: 'cm-profiler-gutter',
      markers: (view) => view.state.field(profilerStateField).markers,
      initialSpacer: () => profilerSpacer,
      updateSpacer: (spacer) => spacer,
      lineMarkerChange: (update) => {
        if (update.docChanged) return true;
        return update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setProfilerData)),
        );
      },
    }),
    // Tag editor root so theme can show/hide the gutter column.
    EditorView.editorAttributes.of((view) => {
      const field = view.state.field(profilerStateField, false);
      if (!field || !hasProfilerMarkers(field.markers)) return null;
      return { class: 'cm-profiler-has-data' };
    }),
  ];
}

/**
 * Dispatch helper — push profile (or null to clear) into an EditorView.
 * Empty / null profiles clear markers so the gutter hides.
 */
export function applyProfilerProfile(
  view: EditorView,
  profile: RunProfile | null,
): void {
  let next: RunProfile | null = null;
  if (profile != null) {
    next = normalizeRunProfile(profile) ?? (profile.lines?.length ? profile : null);
  }
  if (next && (!next.lines || next.lines.length === 0)) {
    next = null;
  }
  view.dispatch({
    effects: setProfilerData.of(next),
  });
}
