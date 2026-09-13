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
 * Editor **color tools**: chips for colors in the script, one working color
 * (picker + transparency + write-as), and click-to-copy format rows.
 *
 * @module editor/ColorToolsPanel
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  untrack,
} from 'solid-js';
import { copyToClipboard } from '../ui/clipboard';
import {
  alphaToTransp,
  colorFormats,
  formatReplacement,
  parseColorInput,
  replaceAllColorHits,
  replaceColorHit,
  scanPineColors,
  styleFromColorKind,
  toCssRgba,
  toHex6,
  uniqueColorChips,
  type ColorFormats,
  type PineColorHit,
  type RgbaColor,
  type UniqueColorChip,
  rgbaFromChannels,
  transpToAlpha,
} from './pine-colors';

export type ColorToolsPanelProps = {
  /** Current editor document (reactive). */
  doc: string;
  /** Replace the whole document after apply. */
  onApplyDoc: (next: string) => void;
  /** Jump/select a hit in the editor. */
  onJump?: (hit: PineColorHit) => void;
};

type OutStyle = 'hex' | 'rgb' | 'new' | 'named';

const WRITE_STYLES: { id: OutStyle; label: string; hint: string }[] = [
  { id: 'hex', label: 'Hex', hint: 'Bare #RRGGBB, or color.new when transparent' },
  { id: 'rgb', label: 'color.rgb', hint: 'color.rgb(r, g, b[, t])' },
  { id: 'new', label: 'color.new', hint: 'color.new(#RRGGBB, t)' },
  { id: 'named', label: 'Named', hint: 'color.red / color.blue / … when exact' },
];

const FORMAT_ROWS: {
  id: string;
  label: string;
  pick: (f: ColorFormats) => string | null;
}[] = [
  { id: 'hex6', label: 'Hex', pick: (f) => f.hex6 },
  { id: 'hex8', label: 'Hex + α', pick: (f) => f.hex8 },
  { id: 'css', label: 'CSS', pick: (f) => f.cssRgba },
  { id: 'pineRgb', label: 'color.rgb', pick: (f) => f.pineRgb },
  { id: 'pineRgbT', label: 'color.rgb + t', pick: (f) => f.pineRgbTransp },
  { id: 'pineNew', label: 'color.new', pick: (f) => f.pineNew },
  { id: 'named', label: 'Named', pick: (f) => f.named },
];

function toColorInputValue(hex6: string): string {
  const s = hex6.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  return '#000000';
}

function chipCss(chip: UniqueColorChip): string {
  return toCssRgba(
    rgbaFromChannels(chip.r, chip.g, chip.b, transpToAlpha(chip.transp)),
  );
}

/** Color chips + editor + formats for the Pine editor. */
export const ColorToolsPanel: Component<ColorToolsPanelProps> = (props) => {
  const hits = createMemo(() => scanPineColors(props.doc || ''));
  const chips = createMemo(() => uniqueColorChips(hits()));

  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  const [selectedHit, setSelectedHit] = createSignal<PineColorHit | null>(null);
  const [draftR, setDraftR] = createSignal(147);
  const [draftG, setDraftG] = createSignal(159);
  const [draftB, setDraftB] = createSignal(255);
  const [draftTransp, setDraftTransp] = createSignal(0);
  const [textDraft, setTextDraft] = createSignal('#939FFF');
  const [outStyle, setOutStyle] = createSignal<OutStyle>('hex');
  const [status, setStatus] = createSignal('');

  const selectedChip = createMemo(() => {
    const k = selectedKey();
    if (!k) return null;
    return chips().find((c) => c.key === k) ?? null;
  });

  const seedFromRgba = (c: RgbaColor, hit?: PineColorHit | null) => {
    setDraftR(c.r);
    setDraftG(c.g);
    setDraftB(c.b);
    setDraftTransp(alphaToTransp(c.a));
    setTextDraft(toHex6(c));
    if (hit) setSelectedHit(hit);
  };

  const seedFromChip = (chip: UniqueColorChip) => {
    seedFromRgba(
      rgbaFromChannels(chip.r, chip.g, chip.b, transpToAlpha(chip.transp)),
      chip.first,
    );
    setOutStyle(styleFromColorKind(chip.first.kind));
  };

  // Keep selection attached to a live chip; seed draft when the key changes.
  createEffect(() => {
    const list = chips();
    if (!list.length) {
      untrack(() => {
        setSelectedKey(null);
        setSelectedHit(null);
      });
      return;
    }
    const k = untrack(() => selectedKey());
    const chip = (k && list.find((c) => c.key === k)) || list[0];
    if (!chip) return;
    if (k !== chip.key) {
      setSelectedKey(chip.key);
      seedFromChip(chip);
      return;
    }
    setSelectedHit(chip.first);
  });

  const draftRgba = createMemo(() =>
    rgbaFromChannels(draftR(), draftG(), draftB(), transpToAlpha(draftTransp())),
  );
  const draftFmts = createMemo(() => colorFormats(draftRgba()));
  const draftPreview = createMemo(() => toCssRgba(draftRgba()));
  const draftHex = createMemo(() => toHex6(draftRgba()));
  const replacement = createMemo(() =>
    formatReplacement(draftR(), draftG(), draftB(), draftTransp(), outStyle()),
  );
  const textParsed = createMemo(() => parseColorInput(textDraft()));
  const namedAvailable = createMemo(() => Boolean(draftFmts().named));

  const formatEntries = createMemo(() =>
    FORMAT_ROWS.map((row) => ({ ...row, value: row.pick(draftFmts()) })).filter(
      (row): row is typeof row & { value: string } => Boolean(row.value),
    ),
  );

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus((cur) => (cur === msg ? '' : cur)), 1600);
  };

  const selectChip = (key: string, jump: boolean) => {
    const chip = chips().find((c) => c.key === key);
    if (!chip) return;
    setSelectedKey(key);
    seedFromChip(chip);
    setStatus('');
    if (jump) props.onJump?.(chip.first);
  };

  const onChipKeyDown = (e: KeyboardEvent, index: number) => {
    const list = chips();
    if (!list.length) return;
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(list.length - 1, index + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      const cur = list[index];
      if (!cur) return;
      e.preventDefault();
      selectChip(cur.key, e.key === 'Enter');
      return;
    } else return;
    const dest = list[next];
    if (!dest) return;
    e.preventDefault();
    selectChip(dest.key, false);
    const el = document.querySelector<HTMLElement>(
      `[data-testid="axis-editor-color-chips"] [data-chip-index="${next}"]`,
    );
    el?.focus();
  };

  const applyRgb = (c: RgbaColor, syncText: boolean) => {
    setDraftR(c.r);
    setDraftG(c.g);
    setDraftB(c.b);
    if (c.a < 255) setDraftTransp(alphaToTransp(c.a));
    if (syncText) setTextDraft(toHex6(c));
  };

  const resolveTargetHit = (): PineColorHit | null => {
    const hit = selectedHit();
    if (!hit) return null;
    const doc = props.doc || '';
    if (doc.slice(hit.from, hit.to) === hit.text) return hit;
    const chip = selectedChip();
    if (!chip) return null;
    return (
      hits().find(
        (h) =>
          h.r === chip.r && h.g === chip.g && h.b === chip.b && h.transp === chip.transp,
      ) ?? null
    );
  };

  const applyToScript = (all: boolean) => {
    const target = resolveTargetHit();
    if (!target) {
      flash('Select a color in the script first');
      return;
    }
    const doc = props.doc || '';
    const text = replacement();
    const chip = selectedChip();
    let next: string;
    if (all && chip) {
      const matches = hits().filter(
        (h) =>
          h.r === chip.r && h.g === chip.g && h.b === chip.b && h.transp === chip.transp,
      );
      next = replaceAllColorHits(doc, matches, text);
      flash(`Replaced ${matches.length} × ${text}`);
    } else {
      next = replaceColorHit(doc, target, text);
      flash(`Replaced L${target.line}`);
    }
    props.onApplyDoc(next);
    const c = draftRgba();
    setSelectedKey(`${c.r},${c.g},${c.b},${Math.round(100 * (1 - c.a / 255))}`);
  };

  const copyValue = async (label: string, text: string) => {
    const ok = await copyToClipboard(text);
    flash(ok ? `Copied ${label}` : 'Copy failed');
  };

  return (
    <div
      class="flex-shrink-0 border-t-2 border-border bg-bg-panel text-[11px] max-h-[min(42vh,360px)] overflow-auto"
      data-testid="axis-editor-colors"
    >
      <div class="px-2.5 pt-2 pb-1.5 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="sc-label !mb-0">Colors in script</span>
          <span class="text-text-faint font-mono tabular-nums min-w-0 truncate">
            <Show when={status()}>
              <span class="text-accent-2 mr-2">{status()}</span>
            </Show>
            {chips().length} unique · {hits().length} hit{hits().length === 1 ? '' : 's'}
          </span>
        </div>

        <Show
          when={chips().length > 0}
          fallback={
            <p class="sc-hint m-0">
              No colors found — use <code class="font-mono">#RRGGBB</code>,{' '}
              <code class="font-mono">color.red</code>,{' '}
              <code class="font-mono">color.rgb(...)</code>, or{' '}
              <code class="font-mono">color.new(...)</code>.
            </p>
          }
        >
          <div
            class="flex flex-wrap gap-1"
            role="listbox"
            aria-label="Colors in document"
            data-testid="axis-editor-color-chips"
          >
            <For each={chips()}>
              {(chip, index) => {
                const active = () => selectedKey() === chip.key;
                return (
                  <button
                    type="button"
                    role="option"
                    data-chip-index={index()}
                    aria-selected={active()}
                    title={`${chip.label} ×${chip.count} · L${chip.first.line} — double-click to jump`}
                    class={`inline-flex items-center gap-1.5 max-w-[11rem] px-1.5 py-0.5 rounded border text-left transition-colors ${
                      active()
                        ? 'border-accent bg-bg-hover text-text'
                        : 'border-border-soft bg-bg-elev text-text-dim hover:border-border hover:text-text'
                    }`}
                    onClick={() => selectChip(chip.key, false)}
                    onDblClick={() => selectChip(chip.key, true)}
                    onKeyDown={(e) => onChipKeyDown(e, index())}
                  >
                    <span
                      class="axis-color-check w-3.5 h-3.5 rounded-sm border border-border flex-shrink-0 overflow-hidden"
                      aria-hidden="true"
                    >
                      <span class="block w-full h-full" style={{ background: chipCss(chip) }} />
                    </span>
                    <span class="font-mono text-[10px] truncate">{chip.shortLabel}</span>
                    <Show when={chip.count > 1}>
                      <span class="text-text-faint tabular-nums">×{chip.count}</span>
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1.5 border-t border-border-soft">
          <div class="flex flex-col gap-2 min-w-0" data-testid="axis-editor-color-editor">
            <span class="sc-label !mb-0">Working color</span>
            <div class="flex items-center gap-2">
              <div
                class="axis-color-check axis-color-swatch w-10 h-10"
                title={`${draftHex()} · t=${draftTransp()} — click to pick`}
              >
                <span class="axis-color-swatch-fill" style={{ background: draftPreview() }} />
                <input
                  type="color"
                  class="axis-color-swatch-input"
                  value={toColorInputValue(draftHex())}
                  aria-label="Pick color"
                  onInput={(e) => {
                    const p = parseColorInput(e.currentTarget.value);
                    if (p) applyRgb(p, true);
                  }}
                />
              </div>
              <label class="flex flex-col gap-0.5 flex-1 min-w-0">
                <span class="text-text-faint text-[10px]">Any form</span>
                <input
                  type="text"
                  class={`sc-input font-mono text-[11px] py-1 ${
                    textDraft().trim() && !textParsed() ? 'border-orange' : ''
                  }`}
                  value={textDraft()}
                  spellcheck={false}
                  placeholder="#9141AC · color.new(#f00, 50)"
                  aria-invalid={Boolean(textDraft().trim() && !textParsed())}
                  aria-label="Color value"
                  data-testid="axis-editor-color-input"
                  onInput={(e) => {
                    const v = e.currentTarget.value;
                    setTextDraft(v);
                    const p = parseColorInput(v);
                    if (p) applyRgb(p, false);
                  }}
                  onBlur={() => {
                    const p = textParsed();
                    if (p) setTextDraft(toHex6(p));
                  }}
                />
              </label>
            </div>

            <label class="flex flex-col gap-0.5">
              <span class="text-text-faint text-[10px] flex justify-between gap-2">
                <span>Transparency</span>
                <span class="font-mono tabular-nums text-text-dim">
                  t={draftTransp()}
                  <span class="text-text-faint"> · 0 opaque</span>
                </span>
              </span>
              <div class="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  class="sc-range flex-1 m-0"
                  value={draftTransp()}
                  aria-label="Pine transparency"
                  onInput={(e) => setDraftTransp(Number(e.currentTarget.value))}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  class="sc-input font-mono w-14 py-0.5 text-center"
                  value={draftTransp()}
                  aria-label="Transparency 0–100"
                  onInput={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (Number.isFinite(n)) setDraftTransp(Math.max(0, Math.min(100, Math.round(n))));
                  }}
                />
              </div>
            </label>

            <div class="flex flex-col gap-1">
              <span class="text-text-faint text-[10px]">Write as</span>
              <div class="sc-chip-row">
                <For each={WRITE_STYLES}>
                  {(opt) => {
                    const namedOff = () => opt.id === 'named' && !namedAvailable();
                    return (
                      <button
                        type="button"
                        class={`sc-chip ${outStyle() === opt.id ? 'is-active' : ''} ${
                          namedOff() ? 'opacity-40 cursor-not-allowed' : ''
                        }`}
                        aria-pressed={outStyle() === opt.id}
                        aria-disabled={namedOff()}
                        title={
                          namedOff()
                            ? 'No exact Pine named color for this RGB'
                            : opt.hint
                        }
                        disabled={namedOff()}
                        onClick={() => setOutStyle(opt.id)}
                      >
                        {opt.label}
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>

            <p
              class="m-0 font-mono text-[10px] text-text-dim truncate"
              title={replacement()}
              data-testid="axis-editor-color-preview"
            >
              {replacement()}
            </p>

            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                class="sc-btn sc-btn-primary sc-btn-sm"
                data-testid="axis-editor-color-apply"
                disabled={!selectedHit()}
                title={
                  selectedHit()
                    ? `Replace ${selectedHit()?.text} at line ${selectedHit()?.line}`
                    : 'Select a chip from the script first'
                }
                onClick={() => applyToScript(false)}
              >
                {selectedHit() ? `Replace L${selectedHit()?.line}` : 'Replace'}
              </button>
              <Show when={(selectedChip()?.count ?? 0) > 1}>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost sc-btn-sm"
                  data-testid="axis-editor-color-apply-all"
                  title={`Replace all ${selectedChip()?.count} matching colors`}
                  onClick={() => applyToScript(true)}
                >
                  Replace all {selectedChip()?.count}
                </button>
              </Show>
              <button
                type="button"
                class="sc-btn sc-btn-ghost sc-btn-sm"
                title="Copy replacement"
                onClick={() => void copyValue('Pine', replacement())}
              >
                Copy
              </button>
              <Show when={selectedHit()}>
                {(h) => (
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost sc-btn-sm"
                    title={`Jump to ${h().text}`}
                    onClick={() => props.onJump?.(h())}
                  >
                    Jump L{h().line}
                  </button>
                )}
              </Show>
            </div>
          </div>

          <div class="flex flex-col gap-1 min-w-0" data-testid="axis-editor-color-converter">
            <span class="sc-label !mb-0">Formats</span>
            <p class="sc-hint m-0 mb-0.5">Click a row to copy. Same color as the editor.</p>
            <For each={formatEntries()}>
              {(row) => (
                <button
                  type="button"
                  class="axis-color-format"
                  title={`Copy ${row.label}`}
                  onClick={() => void copyValue(row.label, row.value)}
                >
                  <span class="text-text-faint text-[10px]">{row.label}</span>
                  <code class="font-mono text-[10px] text-text">{row.value}</code>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
};
