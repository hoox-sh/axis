// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings → Theme → Motion. One block per registered effect.
 *
 * @module ui/effects/EffectsPanel
 */

import { For, Show, createSignal } from 'solid-js';
import { StudioButton, StudioField, StudioHint, StudioSection, StudioToggle } from '../studio';
import {
  effectActive,
  effectDirty,
  effectEnabled,
  effectParam,
  listEffects,
  prefersReducedMotion,
  resetEffect,
  setEffectEnabled,
  setEffectParam,
} from './manager';
import type { EffectDef } from './types';

function slug(id: string): string {
  return id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function EffectBlock(props: { def: EffectDef }) {
  const id = () => slug(props.def.id);
  const [dir, setDir] = createSignal<'up' | 'down' | ''>('');
  let frame = 0;

  const play = (next: 'up' | 'down') => {
    if (!effectActive(props.def.id)) return;
    setDir('');
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    const start = () => setDir(next);
    frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(start) : 0;
    if (!frame) start();
  };

  return (
    <div class="flex flex-col gap-3" data-testid={`axis-fx-${id()}`}>
      <StudioToggle
        id={`axis-fx-${id()}-enabled`}
        checked={effectEnabled(props.def.id)}
        label={props.def.label}
        hint={props.def.summary}
        testId={`axis-fx-${id()}-enabled`}
        onChange={(on) => setEffectEnabled(props.def.id, on)}
      />

      <Show when={props.def.preview}>
        {(preview) => (
          <div
            class={preview().sampleClass}
            classList={{
              [preview().upClass]: dir() === 'up',
              [preview().downClass]: dir() === 'down',
            }}
            data-testid={`axis-fx-${id()}-preview`}
          >
            <span class="font-semibold">
              BTC<span class="text-text-faint font-normal text-[10px]">USDT</span>
            </span>
            <span class="font-mono tabular-nums text-[12px]">84,996.75</span>
            <span
              class={`font-mono tabular-nums text-[11px] ${
                dir() === 'down' ? 'axis-wl-change-down' : 'axis-wl-change-up'
              }`}
            >
              {dir() === 'down' ? '−0.12%' : '+0.12%'}
            </span>
          </div>
        )}
      </Show>

      <For each={props.def.params}>
        {(spec) => {
          const value = () => effectParam(props.def.id, spec.id);
          return (
            <StudioField
              label={`${spec.label} · ${value()}${spec.unit}`}
              for={`axis-fx-${id()}-${spec.id}`}
              hint={spec.hint}
            >
              <input
                id={`axis-fx-${id()}-${spec.id}`}
                class="ax-range"
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={value()}
                disabled={!effectEnabled(props.def.id)}
                data-testid={`axis-fx-${id()}-${spec.id}`}
                aria-valuemin={spec.min}
                aria-valuemax={spec.max}
                aria-valuenow={value()}
                aria-label={spec.label}
                onInput={(e) => {
                  setEffectParam(props.def.id, spec.id, Number(e.currentTarget.value));
                  if (!props.def.preview) return;
                  play(spec.id === 'downStrength' ? 'down' : 'up');
                }}
              />
            </StudioField>
          );
        }}
      </For>

      <Show when={props.def.preview}>
        <div class="ax-toolbar">
          <StudioButton
            testId={`axis-fx-${id()}-play-up`}
            disabled={!effectActive(props.def.id)}
            onClick={() => play('up')}
          >
            Play up
          </StudioButton>
          <StudioButton
            testId={`axis-fx-${id()}-play-down`}
            disabled={!effectActive(props.def.id)}
            onClick={() => play('down')}
          >
            Play down
          </StudioButton>
          <Show when={effectDirty(props.def.id)}>
            <StudioButton testId={`axis-fx-${id()}-reset`} onClick={() => resetEffect(props.def.id)}>
              Reset
            </StudioButton>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** Motion tunes. Live — this tab does not use Save / Cancel. */
export function EffectsPanel() {
  return (
    <StudioSection
      title="Motion"
      lead="Short chrome flashes. Each effect can be tuned here, and later parts of the app register the same way."
      testId="axis-fx-panel"
    >
      <Show when={prefersReducedMotion()}>
        <StudioHint>
          Reduced motion is on in the browser. Flashes stay off until that changes. The sliders
          still save.
        </StudioHint>
      </Show>
      <div class="flex flex-col gap-4">
        <For each={listEffects()}>{(def) => <EffectBlock def={def} />}</For>
      </div>
    </StudioSection>
  );
}
