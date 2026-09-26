// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Saved chart themes and the bar coloring stored inside each one.
 *
 * Bar colorings are a library of their own. Applying one writes it into the
 * selected chart theme. Updating one rewrites every theme that links it.
 *
 * @module ui/ThemeLibrary
 */

import { For, Show, createMemo, createSignal } from 'solid-js';
import {
  applyBarColorTheme,
  applyCustomTheme,
  deleteBarColorTheme,
  deleteCustomTheme,
  renameBarColorTheme,
  renameCustomTheme,
  saveBarColorTheme,
  saveCustomTheme,
  store,
  updateBarColorTheme,
  updateCustomTheme,
} from '../store';
import {
  barTokensEqual,
  barTokensFromState,
  defaultChartThemeState,
  serializeTheme,
  themesEqual,
  type BarColorTheme,
  type SavedCustomTheme,
} from '../theme';
import {
  StudioButton,
  StudioEmpty,
  StudioHint,
  StudioInput,
  StudioList,
  StudioRow,
} from './studio';

function Swatches(props: { up: string; down: string }) {
  return (
    <span class="ax-theme-swatches" aria-hidden="true">
      <span class="ax-theme-swatch" style={{ background: props.up || 'transparent' }} />
      <span class="ax-theme-swatch" style={{ background: props.down || 'transparent' }} />
    </span>
  );
}

function barSwatches(tokens: { [key: string]: string | number | boolean } | undefined) {
  return {
    up: String(tokens?.['bar.up.color'] ?? ''),
    down: String(tokens?.['bar.down.color'] ?? ''),
  };
}

/** Name, save, apply, update, rename, and delete named chart themes. */
export function SavedThemeLibrary() {
  const [name, setName] = createSignal('');
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal('');
  const [renameError, setRenameError] = createSignal('');
  const themes = () => store.savedChartThemes || [];
  const live = createMemo(() => store.chartTheme || defaultChartThemeState());

  const dirty = (theme: SavedCustomTheme) =>
    !themesEqual(serializeTheme(live()), serializeTheme(theme.theme));

  const onSave = () => {
    saveCustomTheme(name());
    setName('');
  };

  const startRename = (theme: SavedCustomTheme) => {
    setRenamingId(theme.id);
    setDraft(theme.name);
    setRenameError('');
  };

  const commitRename = (id: string) => {
    const result = renameCustomTheme(id, draft());
    if (result === 'duplicate') {
      setRenameError('That name is already used.');
      return;
    }
    if (result === 'empty') {
      setRenameError('Enter a name.');
      return;
    }
    setRenamingId(null);
    setRenameError('');
  };

  return (
    <div class="ax-theme-library" data-testid="axis-saved-themes">
      <form
        class="ax-inline"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <StudioInput
          value={name()}
          placeholder="Theme name"
          testId="axis-theme-save-name"
          autocomplete="off"
          onInput={setName}
        />
        <StudioButton variant="primary" type="submit" testId="axis-theme-save">
          Save theme
        </StudioButton>
      </form>
      <StudioHint>
        A matching name replaces that theme. The save includes the bar coloring on the chart.
      </StudioHint>
      <Show
        when={themes().length > 0}
        fallback={<StudioEmpty>No saved themes yet.</StudioEmpty>}
      >
        <StudioList class="ax-list--entity">
          <For each={themes()}>
            {(theme) => {
              const active = () => store.activeSavedThemeId === theme.id;
              const swatch = () => barSwatches(theme.barTheme.tokens);
              return (
                <StudioRow testId={`axis-theme-saved-${theme.id}`}>
                  <div class="ax-entity">
                    <div class="ax-entity-body">
                      <Show
                        when={renamingId() === theme.id}
                        fallback={
                          <div class="ax-entity-head">
                            <span class="ax-card-title">{theme.name}</span>
                            <Swatches up={swatch().up} down={swatch().down} />
                            <span class="ax-card-kicker">Bars · {theme.barTheme.name}</span>
                            <Show when={active() && !dirty(theme)}>
                              <span class="ax-cap ax-cap--active">Active</span>
                            </Show>
                            <Show when={active() && dirty(theme)}>
                              <span class="ax-cap">Edited</span>
                            </Show>
                          </div>
                        }
                      >
                        <form
                          class="ax-inline ax-theme-rename"
                          onSubmit={(e) => {
                            e.preventDefault();
                            commitRename(theme.id);
                          }}
                        >
                          <StudioInput
                            value={draft()}
                            testId={`axis-theme-rename-input-${theme.id}`}
                            onInput={setDraft}
                          />
                          <StudioButton variant="primary" type="submit" class="ax-btn--compact">
                            Save
                          </StudioButton>
                          <StudioButton
                            class="ax-btn--compact"
                            onClick={() => {
                              setRenamingId(null);
                              setRenameError('');
                            }}
                          >
                            Cancel
                          </StudioButton>
                        </form>
                        <Show when={renameError()}>
                          <p class="ax-error">{renameError()}</p>
                        </Show>
                      </Show>
                    </div>
                    <Show when={renamingId() !== theme.id}>
                      <div class="ax-entity-actions ax-theme-actions">
                        <StudioButton
                          variant={active() && !dirty(theme) ? 'ghost' : 'primary'}
                          class="ax-btn--compact"
                          disabled={active() && !dirty(theme)}
                          testId={`axis-theme-apply-${theme.id}`}
                          title={
                            active() && dirty(theme)
                              ? 'Restore this theme, including its bar coloring'
                              : 'Apply this theme'
                          }
                          onClick={() => applyCustomTheme(theme.id)}
                        >
                          {active() && !dirty(theme) ? 'Applied' : 'Apply'}
                        </StudioButton>
                        <StudioButton
                          class="ax-btn--compact"
                          testId={`axis-theme-update-${theme.id}`}
                          title="Store the current chart, including its bar coloring, in this theme"
                          onClick={() => updateCustomTheme(theme.id)}
                        >
                          Update
                        </StudioButton>
                        <StudioButton
                          class="ax-btn--compact"
                          testId={`axis-theme-rename-${theme.id}`}
                          onClick={() => startRename(theme)}
                        >
                          Rename
                        </StudioButton>
                        <StudioButton
                          variant="danger"
                          class="ax-btn--compact"
                          testId={`axis-theme-delete-${theme.id}`}
                          onClick={() => deleteCustomTheme(theme.id)}
                        >
                          Delete
                        </StudioButton>
                      </div>
                    </Show>
                  </div>
                </StudioRow>
              );
            }}
          </For>
        </StudioList>
      </Show>
    </div>
  );
}

/** Bar coloring library. The selected chart theme keeps the one you apply. */
export function BarColorLibrary() {
  const [name, setName] = createSignal('');
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal('');
  const [renameError, setRenameError] = createSignal('');
  const bars = () => store.savedBarThemes || [];
  const live = createMemo(() => store.chartTheme || defaultChartThemeState());
  const activeTheme = createMemo(() =>
    (store.savedChartThemes || []).find((theme) => theme.id === store.activeSavedThemeId) ?? null,
  );

  const inUse = (bar: BarColorTheme) =>
    store.activeBarThemeId === bar.id && barTokensEqual(barTokensFromState(live()), bar.tokens);

  const onSave = () => {
    saveBarColorTheme(name());
    setName('');
  };

  const commitRename = (id: string) => {
    const result = renameBarColorTheme(id, draft());
    if (result === 'duplicate') {
      setRenameError('That name is already used.');
      return;
    }
    if (result === 'empty') {
      setRenameError('Enter a name.');
      return;
    }
    setRenamingId(null);
    setRenameError('');
  };

  return (
    <div class="ax-theme-library" data-testid="axis-bar-themes">
      <Show
        when={activeTheme()}
        fallback={
          <StudioHint>
            No saved theme is selected. A bar coloring saved here can be put inside a theme later.
          </StudioHint>
        }
      >
        {(theme) => (
          <StudioHint>
            Bar coloring inside {theme().name}: {theme().barTheme.name}. Saving or using a palette
            stores it in that theme. Updating a palette rewrites every theme that uses it.
          </StudioHint>
        )}
      </Show>
      <form
        class="ax-inline"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <StudioInput
          value={name()}
          placeholder="Bar coloring name"
          testId="axis-bar-theme-save-name"
          autocomplete="off"
          onInput={setName}
        />
        <StudioButton variant="primary" type="submit" testId="axis-bar-theme-save">
          Save bar colors
        </StudioButton>
      </form>
      <Show
        when={bars().length > 0}
        fallback={<StudioEmpty>No saved bar colorings yet.</StudioEmpty>}
      >
        <StudioList class="ax-list--entity">
          <For each={bars()}>
            {(bar) => {
              const swatch = () => barSwatches(bar.tokens);
              const useTitle = () => {
                const selected = activeTheme();
                return selected
                  ? `Use these bars in ${selected.name}`
                  : 'Use these bars on the chart';
              };
              const users = () =>
                (store.savedChartThemes || []).filter((theme) => theme.barTheme.refId === bar.id)
                  .length;
              return (
                <StudioRow testId={`axis-bar-theme-${bar.id}`}>
                  <div class="ax-entity">
                    <div class="ax-entity-body">
                      <Show
                        when={renamingId() === bar.id}
                        fallback={
                          <div class="ax-entity-head">
                            <span class="ax-card-title">{bar.name}</span>
                            <Swatches up={swatch().up} down={swatch().down} />
                            <Show when={inUse(bar)}>
                              <span class="ax-cap ax-cap--active">In use</span>
                            </Show>
                            <Show when={users() > 0}>
                              <span class="ax-card-kicker">
                                In {users()} theme{users() === 1 ? '' : 's'}
                              </span>
                            </Show>
                          </div>
                        }
                      >
                        <form
                          class="ax-inline ax-theme-rename"
                          onSubmit={(e) => {
                            e.preventDefault();
                            commitRename(bar.id);
                          }}
                        >
                          <StudioInput
                            value={draft()}
                            testId={`axis-bar-theme-rename-input-${bar.id}`}
                            onInput={setDraft}
                          />
                          <StudioButton variant="primary" type="submit" class="ax-btn--compact">
                            Save
                          </StudioButton>
                          <StudioButton
                            class="ax-btn--compact"
                            onClick={() => {
                              setRenamingId(null);
                              setRenameError('');
                            }}
                          >
                            Cancel
                          </StudioButton>
                        </form>
                        <Show when={renameError()}>
                          <p class="ax-error">{renameError()}</p>
                        </Show>
                      </Show>
                    </div>
                    <Show when={renamingId() !== bar.id}>
                      <div class="ax-entity-actions ax-theme-actions">
                        <StudioButton
                          variant={inUse(bar) ? 'ghost' : 'primary'}
                          class="ax-btn--compact"
                          disabled={inUse(bar)}
                          testId={`axis-bar-theme-use-${bar.id}`}
                          title={useTitle()}
                          onClick={() => applyBarColorTheme(bar.id)}
                        >
                          {inUse(bar) ? 'In use' : 'Use'}
                        </StudioButton>
                        <StudioButton
                          class="ax-btn--compact"
                          testId={`axis-bar-theme-update-${bar.id}`}
                          title="Replace this bar coloring with the current bars, including inside themes that use it"
                          onClick={() => updateBarColorTheme(bar.id)}
                        >
                          Update
                        </StudioButton>
                        <StudioButton
                          class="ax-btn--compact"
                          testId={`axis-bar-theme-rename-${bar.id}`}
                          onClick={() => {
                            setRenamingId(bar.id);
                            setDraft(bar.name);
                            setRenameError('');
                          }}
                        >
                          Rename
                        </StudioButton>
                        <StudioButton
                          variant="danger"
                          class="ax-btn--compact"
                          testId={`axis-bar-theme-delete-${bar.id}`}
                          onClick={() => deleteBarColorTheme(bar.id)}
                        >
                          Delete
                        </StudioButton>
                      </div>
                    </Show>
                  </div>
                </StudioRow>
              );
            }}
          </For>
        </StudioList>
      </Show>
    </div>
  );
}
