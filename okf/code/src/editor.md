---
type: "Code Module"
title: "src/editor"
description: "Root component for the standalone editor window (?view=editor)."
resource: "src/editor"
tags: [code, editor]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-25T05:15:59Z
sources:
  - id: tree
    resource: "src/editor"
    title: "src/editor"
    author: process:git
okf_lock: generated
---

# Files

* `ColorToolsPanel.tsx` — ColorToolsPanel, ColorToolsPanelProps
* `EditorApp.tsx` — EditorApp
* `EditorPane.tsx` — EditorPane
* `LanguageFeatureBar.tsx` — LanguageFeatureBar, LanguageFeatureBarProps
* `PyneEditor.tsx` — PyneEditor, PyneEditorCursor, PyneEditorRef, lineWrapExtension
* `ScriptLogsPane.tsx` — ScriptLogsPane
* `SymbolEmojiManager.tsx` — SymbolEmojiManager, SymbolEmojiManagerProps
* `cm-line-ops.ts` — RunKeymapHandlers, buildRunKeymap, deleteLine, deleteLineSpec, duplicateLine, duplicateLineSpec, moveLine, moveLineSpec, runKeymapBindings, toggleLineComment, toggleLineCommentSpec
* `cm-void.ts` — voidEditorExtensions, voidEditorTheme, voidHighlightStyle
* `code-folding.ts` — PINE_INDENT_WIDTH, codeFoldingExtension, foldMarker, foldPlaceholder, indentColumn, pineFoldRange, pineIndentFoldService
* `color-chips.ts` — buildColorChipDecorations, colorChipsExtension, colorChipsTheme
* `column-ruler.ts` — ColumnRulerOptions, DEFAULT_RULER_COLUMN, RULER_STROKE, columnRulerExtension, measureRulerLeft, normalizeRulerColumn, refreshColumnRuler, refreshColumnRulerEffect, rulerOffsetFromContent
* `diagnostics.ts` — DiagnosticSeverity, EditorDiagnostic, applyDiagnostics, combineEditorDiagnostics, countDiagnostics, diagnosticsExtension, diagnosticsFromLastRun, diagnosticsStateField, diagnosticsTheme, formatDiagnosticCount, jumpToDiagnostic, jumpToFirstDiagnostic
* `doc-stats.ts` — countDocStats, cursorLineCol
* `editor-bridge.ts` — BridgeMessage, EDITOR_CHANNEL, bridgePublish, bridgeSubscribe, isEditorView, openEditorWindow, readSharedDoc, writeSharedDoc
* `editor-intel.ts` — DEFAULT_EDITOR_INTEL, DEFAULT_PREEVAL_IDLE_MS, EDITOR_INTEL_REV, EditorIntelSettings, INTEL_HOVER_MS_MAX, INTEL_HOVER_MS_MIN, INTEL_IDLE_MS_MAX, INTEL_IDLE_MS_MIN, INTEL_MAX_OPTIONS_MAX, INTEL_MAX_OPTIONS_MIN, INTEL_TAB_SWITCH_MS_MAX, INTEL_TAB_SWITCH_MS_MIN
* `git-sync.ts` — GitStatusMeta, PullLibraryResult, formatGitStatus, getEditorStorageId, isGitStorageActive, pullLibrary, pushScript, statusMetaFromPull
* `indent-guides.ts` — IndentWidget, indentGuidesExtension, indentMatcher
* `inline-debug.ts` — DebugChipClickDetail, INLINE_DEBUG_CHIP_MAX, InlineDebugAnnotation, applyDebugPins, applyInlineDebug, debugPinFlashField, debugPinStateField, flashDebugPinLine, flashDebugPinLineEffect, getRegisteredDebugEditorView, inlineDebugExtension, inlineDebugStateField
* `language-features.ts` — EditorObservedActivity, FEATURE_BAR_LONG_PRESS_MS, FEATURE_BAR_POLL_MS, FeatureActivity, FeatureActivityKey, FeatureSetting, IDLE_EDITOR_ACTIVITY, IDLE_FEATURE_ACTIVITY, LANGUAGE_FEATURE_GROUPS, LanguageFeatureGroup, deriveFeatureActivity, featureGroupById
* `minimap.ts` — EditorMinimap, MINIMAP_MAX_LINES, MINIMAP_MIN_CONTAINER_WIDTH, MINIMAP_ROW_HEIGHT, MINIMAP_WIDTH, scrollFraction, scrollTopForFraction, viewportFraction
* `open-script-source.ts` — OpenScriptSourceDetail, openScriptSourceInEditor, subscribeOpenScriptSource
* `pine-call-params.ts` — CallArg, CallSite, PineCallSig, PineParamDef, ResolveCallSigOpts, classifyParams, findCallSite, formatCallHoverMarkdown, formatParamHoverMarkdown, paramCompletions, parseSignatureParams, resolveCallSignature
* `pine-colors.ts` — ColorFormats, PINE_NAMED_COLORS, PineColorHit, PineColorKind, RgbaColor, UniqueColorChip, alphaToTransp, chipShortLabel, colorFormats, formatPickedChipColor, formatReplacement, parseColorInput
* `pine-convert.ts` — PineConvertResult, convertPineToV6, convertPineToV6Result, detectPineVersion
* `pine-declare-types.ts` — DeclareTypesOptions, DeclareTypesResult, PineType1, PineType2, TypeDeclareEdit, addMissingTypeDeclarations, buildTypePrefix, inferType1, inferType2, parseAssignLine, wouldAddTypeDeclarations
* `pine-enums.ts` — NAMED_ARG_ENUM_ROOTS, NAMED_ENUM_ARGS, PINE_BUILTIN_VARS, PINE_ENUM_PATHS, PineEnumMeta, enumPrefixesForArg, findNearestCallName, namedArgEnumContext, pathMatchesEnumPrefixes, pineEnumMetas, styleNamespaceForCall
* `pine-format.ts` — PineFormatOptions, formatPineSource, pineSourceNeedsFormat
* `pine-hover-facts.ts` — HoverFact, HoverFactKind, HoverFactLookupOpts, UserSymbol, UserSymbolKind, declarationTypeFact, dottedSegmentAt, enclosingStringAt, formatColorLiteralMarkdown, formatHoverFactMarkdown, formatUserSymbolMarkdown, hexColorAt
* `pine-scan-util.ts` — QuoteChar, isQuoteChar, isQuoteClose
* `pine-symbols.ts` — PINE_SYMBOLS, PINE_SYMBOL_CATEGORIES, PineSymbol, PineSymbolCategory, PineSymbolUse, filterPineSymbols, plotcharSnippet, quotePineString
* `preevaluate.ts` — DottedRef, EXTRA_KNOWN_BUILTIN_PATHS, PREEVAL_DEBOUNCE_MS, PREEVAL_IDLE_MS, PreevalResult, cancelPreeval, checkUnknownBuiltinMembers, checkUnknownNamedArgs, checkUnknownUserIdents, clearPreevalOnEdit, collectUserBindings, collectUserFunctionParams
* `profiler-gutter.ts` — ProfileLineStat, RunProfile, applyProfilerProfile, normalizeRunProfile, profileLineMap, profilerGutterExtension, profilerGutterTheme, profilerStateField, setProfilerData
* `pyne-doc-annotations.ts` — PyneDocEntry, PyneDocKind, formatPyneDocMarkdown, lookupPyneDoc, parsePyneDocAnnotations
* `pyne-language.ts` — PineHighlightState, PineToken, advancePineLineState, defaultPineHighlightState, pineOffsetInLiteral, pyneParser, pyneScript, tokenizePine
* `pyne-lsp-client.ts` — LSP_COMPLETION_TIMEOUT_MS, LSP_COOLDOWN_MS, LSP_DIAGNOSTICS_TIMEOUT_MS, LSP_HOVER_TIMEOUT_MS, RemoteCompletionItem, RemoteDiagnostic, RemoteDiagnosticsResult, RemoteHover, _resetRemoteLspCooldownForTests, fetchRemoteCompletion, fetchRemoteDiagnostics, fetchRemoteHover
* `pyne-lsp.ts` — BuiltinMeta, COMPLETION_STYLE_ENUMS, appendInlineMarkdown, buildParamHintTooltip, completeCallParams, completeNamedArgEnum, enumsMatchingPrefixes, escapeDismissEditorOverlay, filterStyleEnums, looksLikeMarkdown, lookupBuiltin, lookupBuiltinMember
* `tabbed-editor.tsx` — TabbedEditor, countDocStats, cursorLineCol

# Packages

`@codemirror/autocomplete`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/search`, `@codemirror/state`, `@codemirror/view`, `@lezer/highlight`, `solid-js`

# Depends on

* [src/chart](/code/src/chart.md)
* [src/indicators](/code/src/indicators.md)
* [src/plugins](/code/src/plugins.md)
* [src/pwa](/code/src/pwa.md)
* [src/results](/code/src/results.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/theme](/code/src/theme.md)
* [src/ui](/code/src/ui.md)
* [src/ui/panels](/code/src/ui/panels.md)
* [src/ui/shortcuts](/code/src/ui/shortcuts.md)

# Used by

* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/indicators](/code/src/indicators.md)
* [src/results](/code/src/results.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/studio](/code/src/ui/studio.md)
* [tests](/code/tests.md)
