<!--
Copyright (C) 2026 jango_blockchained

This file is part of AXIS IDE (hoox-sh.axis-ide).

AXIS IDE is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, version 3 of the License only.

AXIS IDE is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.

SPDX-License-Identifier: AGPL-3.0-only
-->

# Profiler line decorations — parent wiring

Per-line percent chips use `TextEditorDecorationType` (`before` contentText). The Profiler webview is unchanged.

In `src/extension.ts`, next to `registerProfilerView(context, resultsStore)`, call:

```ts
registerProfilerDecorations(context, resultsStore);
```

Import it from `./host/profiler-decorations`.

In `scripts/check-coverage.mjs`, add `'host/profiler-decorations.ts'` to `EXCLUDE` (VS Code shim; pure logic is `src/host/profile-lines.ts` and is covered). Do not edit `extension.ts` or `scripts/check-coverage.mjs` from the decoration task itself.

PYNE language id contributed by `hoox-sh.pyne` is `pinescript`. Decorations also accept `pine`, `pine-script`, and `pynescript`.
