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
 * Editor **color tools**: chips for colors in the script, a small editor
 * (picker + transparency + apply), and a free-form format converter.
 *
 * @module editor/ColorToolsPanel
 */

import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';
import {
  colorFormats,
  formatReplacement,
  parseColorInput,
  replaceColorHit,
  scanPineColors,
  toCssRgba,
  toHex6,
  uniqueColorChips,
  type PineColorHit,
  type RgbaColor,
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

function toColorInputValue(hex6: string): string {
  const s = hex6.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  return '#000000';
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Color chips + editor + converter for the Pine editor. */
export const ColorToolsPanel: Component<ColorToolsPanelProps> = (props) => {
  const hits = createMemo(() => scanPineColors(props.doc || ''));
  const chips = createMemo(() => uniqueColorChips(hits()));

  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  const [selectedHit, setSelectedHit] = createSignal<PineColorHit | null>(null);

  // Editor draft
  const [draftR, setDraftR] = createSignal(147);
  const [draftG, setDraftG] = createSignal(159);
  const [draftB, setDraftB] = createSignal(255);
  const [draftTransp, setDraftTransp] = createSignal(0);
  const [outStyle, setOutStyle] = createSignal<OutStyle>('hex');
  const [applyMsg, setApplyMsg] = createSignal('');

  // Converter
  const [convIn, setConvIn] = createSignal('#939fff');
  const [copyFlash, setCopyFlash] = createSignal('');

  const selectedChip = createMemo(() => {
    const k = selectedKey();
    if (!k) return null;
    return chips().find((c) => c.key === k) ?? null;
  });

  const seedFromRgba = (c: RgbaColor, hit?: PineColorHit | null) => {
    setDraftR(c.r);
    setDraftG(c.g);
    setDraftB(c.b);
    setDraftTransp(Math.round(100 * (1 - c.a / 255)));
    if (hit) setSelectedHit(hit);
  };

  // Keep draft in sync when selecting a chip
  createEffect(() => {
    const chip = selectedChip();
    if (!chip) return;
    seedFromRgba(
      rgbaFromChannels(chip.r, chip.g, chip.b, transpToAlpha(chip.transp)),
      chip.first,
    );
  });

  const draftRgba = createMemo(() =>
    rgbaFromChannels(draftR(), draftG(), draftB(), transpToAlpha(draftTransp())),
  );
  const draftFmts = createMemo(() => colorFormats(draftRgba()));
  const draftPreview = createMemo(() => toCssRgba(draftRgba()));
  const draftHex = createMemo(() => toHex6(draftRgba()));

  const convParsed = createMemo(() => parseColorInput(convIn()));
  const convFmts = createMemo(() => {
    const p = convParsed();
    return p ? colorFormats(p) : null;
  });

  const selectChip = (key: string) => {
    setSelectedKey(key);
    setApplyMsg('');
    const chip = chips().find((c) => c.key === key);
    if (chip) {
      props.onJump?.(chip.first);
    }
  };

  const applyToHit = () => {
    const hit = selectedHit();
    if (!hit) {
      setApplyMsg('Select a color in the script first');
      return;
    }
    // Re-find hit by range if doc drifted; prefer exact range still valid
    let target = hit;
    const doc = props.doc || '';
    if (doc.slice(hit.from, hit.to) !== hit.text) {
      // Fall back to first current hit matching the selected chip key
      const chip = selectedChip();
      const again = chip
        ? hits().find(
            (h) =>
              h.r === chip.r && h.g === chip.g && h.b === chip.b && h.transp === chip.transp,
          )
        : null;
      if (!again) {
        setApplyMsg('Color range moved — reselect a chip');
        return;
      }
      target = again;
    }
    const replacement = formatReplacement(
      draftR(),
      draftG(),
      draftB(),
      draftTransp(),
      outStyle(),
    );
    const next = replaceColorHit(doc, target, replacement);
    props.onApplyDoc(next);
    setApplyMsg(`Applied ${replacement}`);
    // Reselect by new key after apply
    const c = draftRgba();
    setSelectedKey(
      `${c.r},${c.g},${c.b},${Math.round(100 * (1 - c.a / 255))}`,
    );
  };

  const flashCopy = async (label: string, text: string) => {
    const ok = await copyText(text);
    setCopyFlash(ok ? `Copied ${label}` : 'Copy failed');
    window.setTimeout(() => setCopyFlash(''), 1400);
  };

  return (
    <div
      class="flex-shrink-0 border-t-2 border-border bg-bg-panel text-[11px] max-h-[min(42vh,360px)] overflow-auto"
      data-testid="axis-editor-colors"
    >
      <div class="px-2.5 pt-2 pb-1.5 flex flex-col gap-2">
        {/* Chips from document */}
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between gap-2">
            <span class="sc-label !mb-0">Colors in script</span>
            <span class="text-text-faint font-mono tabular-nums">
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
              class="flex flex-wrap gap-1.5"
              role="listbox"
              aria-label="Colors in document"
              data-testid="axis-editor-color-chips"
            >
              <For each={chips()}>
                {(chip) => {
                  const active = () => selectedKey() === chip.key;
                  const css = () =>
                    toCssRgba(
                      rgbaFromChannels(
                        chip.r,
                        chip.g,
                        chip.b,
                        transpToAlpha(chip.transp),
                      ),
                    );
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={active()}
                      title={`${chip.label} ×${chip.count} · L${chip.first.line}`}
                      class={`inline-flex items-center gap-1.5 max-w-[12rem] px-1.5 py-0.5 rounded border text-left transition-colors ${
                        active()
                          ? 'border-accent bg-bg-hover text-text'
                          : 'border-border-soft bg-bg-elev text-text-dim hover:border-border hover:text-text'
                      }`}
                      onClick={() => selectChip(chip.key)}
                    >
                      <span
                        class="w-3.5 h-3.5 rounded-sm border border-border flex-shrink-0 shadow-inner"
                        style={{ background: css() }}
                        aria-hidden="true"
                      />
                      <span class="font-mono text-[10px] truncate">{chip.label}</span>
                      <Show when={chip.count > 1}>
                        <span class="text-text-faint tabular-nums">×{chip.count}</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>

        {/* Editor + converter grid */}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border-soft">
          {/* Color editor */}
          <div class="flex flex-col gap-2 min-w-0" data-testid="axis-editor-color-editor">
            <span class="sc-label !mb-0">Editor</span>
            <div class="flex items-center gap-2">
              <span
                class="w-9 h-9 rounded border-2 border-border flex-shrink-0"
                style={{ background: draftPreview() }}
                title={draftHex()}
              />
              <input
                type="color"
                class="w-9 h-9 p-0 border border-border rounded bg-transparent cursor-pointer"
                value={toColorInputValue(draftHex())}
                aria-label="Color picker"
                onInput={(e) => {
                  const v = e.currentTarget.value;
                  const p = parseColorInput(v);
                  if (!p) return;
                  setDraftR(p.r);
                  setDraftG(p.g);
                  setDraftB(p.b);
                }}
              />
              <label class="flex flex-col gap-0.5 flex-1 min-w-0">
                <span class="text-text-faint text-[10px]">Hex</span>
                <input
                  type="text"
                  class="sc-input font-mono text-[11px] py-1"
                  value={draftHex()}
                  spellcheck={false}
                  onChange={(e) => {
                    const p = parseColorInput(e.currentTarget.value);
                    if (!p) return;
                    setDraftR(p.r);
                    setDraftG(p.g);
                    setDraftB(p.b);
                    if (p.a < 255) {
                      setDraftTransp(Math.round(100 * (1 - p.a / 255)));
                    }
                  }}
                />
              </label>
            </div>
            <label class="flex flex-col gap-0.5">
              <span class="text-text-faint text-[10px] flex justify-between">
                <span>Transparency (Pine 0–100)</span>
                <span class="font-mono tabular-nums text-text-dim">{draftTransp()}</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                class="w-full accent-[var(--color-accent)]"
                value={draftTransp()}
                onInput={(e) => setDraftTransp(Number(e.currentTarget.value))}
              />
            </label>
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-text-faint text-[10px]">Write as</span>
              <For
                each={
                  [
                    ['hex', 'hex / new'],
                    ['rgb', 'color.rgb'],
                    ['new', 'color.new'],
                    ['named', 'named'],
                  ] as [OutStyle, string][]
                }
              >
                {([id, label]) => (
                  <button
                    type="button"
                    class={`sc-chip ${outStyle() === id ? 'is-active' : ''}`}
                    aria-pressed={outStyle() === id}
                    onClick={() => setOutStyle(id)}
                  >
                    {label}
                  </button>
                )}
              </For>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                class="sc-btn sc-btn-primary sc-btn-sm"
                data-testid="axis-editor-color-apply"
                disabled={!selectedHit()}
                title={
                  selectedHit()
                    ? `Replace ${selectedHit()!.text} at L${selectedHit()!.line}`
                    : 'Select a chip from the script first'
                }
                onClick={() => applyToHit()}
              >
                Apply to selection
              </button>
              <button
                type="button"
                class="sc-btn sc-btn-ghost sc-btn-sm font-mono"
                title="Copy draft as Pine"
                onClick={() =>
                  void flashCopy(
                    'Pine',
                    formatReplacement(
                      draftR(),
                      draftG(),
                      draftB(),
                      draftTransp(),
                      outStyle(),
                    ),
                  )
                }
              >
                Copy
              </button>
              <Show when={selectedHit()}>
                {(h) => (
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost sc-btn-sm"
                    onClick={() => props.onJump?.(h())}
                  >
                    Jump L{h().line}
                  </button>
                )}
              </Show>
            </div>
            <Show when={applyMsg()}>
              <p class="sc-hint m-0 text-accent-2">{applyMsg()}</p>
            </Show>
            <p class="sc-hint m-0 font-mono text-[10px] truncate" title={draftFmts().pineNew}>
              → {formatReplacement(draftR(), draftG(), draftB(), draftTransp(), outStyle())}
            </p>
          </div>

          {/* Converter */}
          <div class="flex flex-col gap-2 min-w-0" data-testid="axis-editor-color-converter">
            <span class="sc-label !mb-0">Converter</span>
            <label class="flex flex-col gap-0.5">
              <span class="text-text-faint text-[10px]">
                Any form — hex, color.red, color.rgb, color.new, rgba
              </span>
              <input
                type="text"
                class="sc-input font-mono text-[11px] py-1"
                value={convIn()}
                spellcheck={false}
                placeholder="#939fff or color.new(#f00, 50)"
                data-testid="axis-editor-color-converter-input"
                onInput={(e) => setConvIn(e.currentTarget.value)}
              />
            </label>
            <Show
              when={convFmts()}
              fallback={
                <p class="sc-hint m-0 text-orange">Unrecognized color string</p>
              }
            >
              {(f) => (
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2 mb-0.5">
                    <span
                      class="w-5 h-5 rounded border border-border flex-shrink-0"
                      style={{
                        background: toCssRgba(convParsed()!),
                      }}
                    />
                    <span class="text-text-faint text-[10px]">
                      t={f().transp}
                    </span>
                    <Show when={copyFlash()}>
                      <span class="text-accent-2 text-[10px] ml-auto">{copyFlash()}</span>
                    </Show>
                  </div>
                  <For
                    each={
                      [
                        ['hex6', f().hex6],
                        ['hex8', f().hex8],
                        ['css', f().cssRgba],
                        ['pine rgb', f().pineRgb],
                        ['pine rgb+t', f().pineRgbTransp],
                        ['pine new', f().pineNew],
                        ...(f().named ? ([['named', f().named!]] as [string, string][]) : []),
                      ] as [string, string][]
                    }
                  >
                    {([label, value]) => (
                      <button
                        type="button"
                        class="flex items-center gap-2 w-full text-left px-1.5 py-0.5 rounded border border-transparent hover:border-border-soft hover:bg-bg-elev"
                        title={`Copy ${label}`}
                        onClick={() => void flashCopy(label, value)}
                      >
                        <span class="text-text-faint w-14 flex-shrink-0 text-[10px]">
                          {label}
                        </span>
                        <code class="font-mono text-[10px] text-text truncate flex-1">
                          {value}
                        </code>
                      </button>
                    )}
                  </For>
                  <button
                    type="button"
                    class="sc-btn sc-btn-ghost sc-btn-sm self-start mt-0.5"
                    onClick={() => {
                      const p = convParsed();
                      if (!p) return;
                      seedFromRgba(p, null);
                      setSelectedHit(null);
                      setSelectedKey(null);
                      setApplyMsg('Loaded into editor (no script selection)');
                    }}
                  >
                    Load into editor
                  </button>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
};
