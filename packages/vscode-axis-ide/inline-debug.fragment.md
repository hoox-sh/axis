# Inline debug chips (parent wiring)

Do not import the PWA modules `src/results/inline-debug.ts` or `src/editor/inline-debug.ts`.
The VS Code collector is `packages/vscode-axis-ide/src/host/inline-debug.ts`
(`collectInlineDebug`, `parseSourceLine`, `truncateInlineDebugChip`, `redactInlineDebugText`).

## activate

In `packages/vscode-axis-ide/src/extension.ts` `activate`, after `resultsStore` exists
(next to `registerProfilerView(context, resultsStore)`):

```ts
import { registerInlineDebugDecorations } from './host/inline-debug-decorations';

registerInlineDebugDecorations(context, resultsStore);
```

`registerInlineDebugDecorations` subscribes like `attachProfiler`: current `getLastRun()`,
then each Results snapshot's `lastRun`. It paints end-of-line chips on visible editors
whose language id is `pinescript` (PYNE `contributes.languages`) and clears them when
the run has no annotations. Dispose is pushed on `context.subscriptions`.

## Coverage gate

In `packages/vscode-axis-ide/scripts/check-coverage.mjs` `EXCLUDE`, add:

```js
'host/inline-debug-decorations.ts',
```

`src/host/inline-debug.ts` stays in the pure-host 100% line gate.
`src/host/inline-debug-decorations.ts` is the VS Code decoration shim (no unit test).
