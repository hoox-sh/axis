// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
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
  BUILTIN_BAR_THEMES,
  barTokensEqual,
  barTokensFromState,
  defaultChartThemeState,
  isBuiltinBarThemeId,
  serializeTheme,
  themesEqual,
  type BarColorTheme,
  type SavedCustomTheme,
} from '../theme';
import {
  AppButton,
  StudioEmpty,
  StudioHint,
  StudioInput,
  StudioList,
  StudioRow,
  useMicrofeedback,
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
  const saveFb = useMicrofeedback({ successHoldMs: 700, errorHoldMs: 1100 });

  const dirty = (theme: SavedCustomTheme) =>
    !themesEqual(serializeTheme(live()), serializeTheme(theme.theme));

  const onSave = async () => {
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
          void saveFb.run(onSave);
        }}
      >
        <StudioInput
          value={name()}
          placeholder="Theme name"
          testId="axis-theme-save-name"
          autocomplete="off"
          onInput={setName}
        />
        <AppButton
          design="soft"
          tone="primary"
          size="sm"
          type="submit"
          testId="axis-theme-save"
          feedback={saveFb.state()}
        >
          Save theme
        </AppButton>
      </form>
      <StudioHint>Matching name replaces that theme. Bar coloring is included.</StudioHint>
      <Show when={themes().length > 0} fallback={<StudioEmpty>No saved themes yet.</StudioEmpty>}>
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
                          <AppButton design="soft" tone="primary" size="sm" type="submit">
                            Save
                          </AppButton>
                          <AppButton
                            design="soft"
                            tone="ghost"
                            size="sm"
                            onClick={() => {
                              setRenamingId(null);
                              setRenameError('');
                            }}
                          >
                            Cancel
                          </AppButton>
                        </form>
                        <Show when={renameError()}>
                          <p class="ax-error">{renameError()}</p>
                        </Show>
                      </Show>
                    </div>
                    <Show when={renamingId() !== theme.id}>
                      <div class="ax-entity-actions ax-theme-actions">
                        <AppButton
                          design="soft"
                          tone={active() && !dirty(theme) ? 'ghost' : 'primary'}
                          size="sm"
                          disabled={active() && !dirty(theme)}
                          testId={`axis-theme-apply-${theme.id}`}
                          title={
                            active() && dirty(theme)
                              ? 'Restore this theme, including its bar coloring'
                              : 'Apply this theme'
                          }
                          onClick={async () => {
                            applyCustomTheme(theme.id);
                          }}
                        >
                          {active() && !dirty(theme) ? 'Applied' : 'Apply'}
                        </AppButton>
                        <AppButton
                          design="soft"
                          tone="ghost"
                          size="sm"
                          testId={`axis-theme-update-${theme.id}`}
                          title="Store the current chart, including its bar coloring, in this theme"
                          onClick={async () => {
                            updateCustomTheme(theme.id);
                          }}
                        >
                          Update
                        </AppButton>
                        <AppButton
                          design="soft"
                          tone="ghost"
                          size="sm"
                          testId={`axis-theme-rename-${theme.id}`}
                          onClick={() => startRename(theme)}
                        >
                          Rename
                        </AppButton>
                        <AppButton
                          design="soft"
                          tone="danger"
                          size="sm"
                          testId={`axis-theme-delete-${theme.id}`}
                          onClick={async () => {
                            deleteCustomTheme(theme.id);
                          }}
                        >
                          Delete
                        </AppButton>
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

function BarThemeRow(props: {
  bar: BarColorTheme;
  builtin?: boolean;
  inUse: boolean;
  users: number;
  useTitle: string;
  renamingId: string | null;
  draft: string;
  renameError: string;
  onUse: () => void;
  onUpdate?: () => void;
  onRenameStart?: () => void;
  onRenameSave?: () => void;
  onRenameCancel?: () => void;
  onRenameDraft?: (v: string) => void;
  onDelete?: () => void;
}) {
  const swatch = () => barSwatches(props.bar.tokens);
  return (
    <StudioRow testId={`axis-bar-theme-${props.bar.id}`}>
      <div class="ax-entity">
        <div class="ax-entity-body">
          <Show
            when={!props.builtin && props.renamingId === props.bar.id}
            fallback={
              <div class="ax-entity-head">
                <span class="ax-card-title">{props.bar.name}</span>
                <Swatches up={swatch().up} down={swatch().down} />
                <Show when={props.builtin}>
                  <span class="ax-card-kicker">Built-in</span>
                </Show>
                <Show when={props.inUse}>
                  <span class="ax-cap ax-cap--active">In use</span>
                </Show>
                <Show when={props.users > 0}>
                  <span class="ax-card-kicker">
                    In {props.users} theme{props.users === 1 ? '' : 's'}
                  </span>
                </Show>
              </div>
            }
          >
            <form
              class="ax-inline ax-theme-rename"
              onSubmit={(e) => {
                e.preventDefault();
                props.onRenameSave?.();
              }}
            >
              <StudioInput
                value={props.draft}
                testId={`axis-bar-theme-rename-input-${props.bar.id}`}
                onInput={(v) => props.onRenameDraft?.(v)}
              />
              <AppButton design="soft" tone="primary" size="sm" type="submit">
                Save
              </AppButton>
              <AppButton design="soft" tone="ghost" size="sm" onClick={() => props.onRenameCancel?.()}>
                Cancel
              </AppButton>
            </form>
            <Show when={props.renameError}>
              <p class="ax-error">{props.renameError}</p>
            </Show>
          </Show>
        </div>
        <Show when={props.builtin || props.renamingId !== props.bar.id}>
          <div class="ax-entity-actions ax-theme-actions">
            <AppButton
              design="soft"
              tone={props.inUse ? 'ghost' : 'primary'}
              size="sm"
              disabled={props.inUse}
              testId={`axis-bar-theme-use-${props.bar.id}`}
              title={props.useTitle}
              onClick={async () => {
                props.onUse();
              }}
            >
              {props.inUse ? 'In use' : 'Use'}
            </AppButton>
            <Show when={!props.builtin}>
              <AppButton
                design="soft"
                tone="ghost"
                size="sm"
                testId={`axis-bar-theme-update-${props.bar.id}`}
                title="Replace this bar coloring with the current bars, including inside themes that use it"
                onClick={async () => {
                  props.onUpdate?.();
                }}
              >
                Update
              </AppButton>
              <AppButton
                design="soft"
                tone="ghost"
                size="sm"
                testId={`axis-bar-theme-rename-${props.bar.id}`}
                onClick={() => props.onRenameStart?.()}
              >
                Rename
              </AppButton>
              <AppButton
                design="soft"
                tone="danger"
                size="sm"
                testId={`axis-bar-theme-delete-${props.bar.id}`}
                onClick={async () => {
                  props.onDelete?.();
                }}
              >
                Delete
              </AppButton>
            </Show>
          </div>
        </Show>
      </div>
    </StudioRow>
  );
}

/** Bar coloring library. The selected chart theme keeps the one you apply. */
export function BarColorLibrary() {
  const [name, setName] = createSignal('');
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal('');
  const [renameError, setRenameError] = createSignal('');
  const savedBars = () => store.savedBarThemes || [];
  const builtins = () => BUILTIN_BAR_THEMES as BarColorTheme[];
  const live = createMemo(() => store.chartTheme || defaultChartThemeState());
  const activeTheme = createMemo(
    () =>
      (store.savedChartThemes || []).find((theme) => theme.id === store.activeSavedThemeId) ?? null,
  );
  const saveFb = useMicrofeedback({ successHoldMs: 700, errorHoldMs: 1100 });

  const inUse = (bar: BarColorTheme) =>
    store.activeBarThemeId === bar.id && barTokensEqual(barTokensFromState(live()), bar.tokens);

  const useTitleFor = (bar: BarColorTheme) => {
    const selected = activeTheme();
    return selected ? `Use these bars in ${selected.name}` : 'Use these bars on the chart';
  };

  const usersOf = (bar: BarColorTheme) =>
    (store.savedChartThemes || []).filter((theme) => theme.barTheme.refId === bar.id).length;

  const onSave = async () => {
    saveBarColorTheme(name());
    setName('');
  };

  const commitRename = (id: string) => {
    if (isBuiltinBarThemeId(id)) return;
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
            No saved theme selected. Built-in candle packs and saved palettes can be applied anytime.
          </StudioHint>
        }
      >
        {(theme) => (
          <StudioHint>
            Linked in {theme().name}: {theme().barTheme.name}. Use writes into that theme; Update
            rewrites every theme that points here.
          </StudioHint>
        )}
      </Show>
      <form
        class="ax-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void saveFb.run(onSave);
        }}
      >
        <StudioInput
          value={name()}
          placeholder="Bar coloring name"
          testId="axis-bar-theme-save-name"
          autocomplete="off"
          onInput={setName}
        />
        <AppButton
          design="soft"
          tone="primary"
          size="sm"
          type="submit"
          testId="axis-bar-theme-save"
          feedback={saveFb.state()}
        >
          Save bar colors
        </AppButton>
      </form>
      <StudioList class="ax-list--entity">
        <For each={builtins()}>
          {(bar) => (
            <BarThemeRow
              bar={bar}
              builtin
              inUse={inUse(bar)}
              users={usersOf(bar)}
              useTitle={useTitleFor(bar)}
              renamingId={renamingId()}
              draft={draft()}
              renameError={renameError()}
              onUse={() => {
                applyBarColorTheme(bar.id);
              }}
            />
          )}
        </For>
      </StudioList>
      <Show
        when={savedBars().length > 0}
        fallback={<StudioEmpty>No saved bar colorings yet.</StudioEmpty>}
      >
        <StudioList class="ax-list--entity">
          <For each={savedBars()}>
            {(bar) => (
              <BarThemeRow
                bar={bar}
                inUse={inUse(bar)}
                users={usersOf(bar)}
                useTitle={useTitleFor(bar)}
                renamingId={renamingId()}
                draft={draft()}
                renameError={renameError()}
                onUse={() => {
                  applyBarColorTheme(bar.id);
                }}
                onUpdate={() => {
                  updateBarColorTheme(bar.id);
                }}
                onRenameStart={() => {
                  setRenamingId(bar.id);
                  setDraft(bar.name);
                  setRenameError('');
                }}
                onRenameSave={() => commitRename(bar.id)}
                onRenameCancel={() => {
                  setRenamingId(null);
                  setRenameError('');
                }}
                onRenameDraft={setDraft}
                onDelete={() => {
                  deleteBarColorTheme(bar.id);
                }}
              />
            )}
          </For>
        </StudioList>
      </Show>
    </div>
  );
}
