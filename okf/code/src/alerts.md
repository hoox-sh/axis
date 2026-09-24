---
type: "Code Module"
title: "src/alerts"
description: "AXIS alerts engine — public API."
resource: "src/alerts"
tags: [alerts, code]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "src/alerts"
    title: "src/alerts"
    author: process:git
okf_lock: generated
---

# Files

* `drawing-levels.ts` — DRAWING_FIB_RATIOS, DrawingLike, drawingAlertLabel, drawingPricesById, pricesFromDrawing
* `engine.ts` — DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT, OnchainEvalContext, OnchainEvalEvent, OnchainEvalFired, applyFired, becomesTrue, clearPrevPrices, crossesLevel, evaluateAlerts, evaluateOnchainEventAlertsPure, evaluateOne, eventAbsPct
* `form.ts` — AlertFormDraft, AlertFormErr, AlertFormOk, AlertFormResult, OnchainDirection, PctDirection, buildAlertFromDraft, isDrawingKind, isIndicatorKind, isOnchainKind, isPctKind, isPineAlertKind
* `format.ts` — ALERT_KINDS, ALERT_KIND_GROUPS, alertKindGroup, formatAlertCondition, formatAlertKind, formatLastFired
* `index.ts` — ALERTS_STORAGE_KEY, ALERT_KINDS, ALERT_KIND_GROUPS, Alert, AlertCreateInput, AlertKind, AlertParams, AlertUpdatePatch, AlertsStoreV1, CreateOnchainTvlSpikeAlertInput, DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT, DRAWING_FIB_RATIOS
* `indicator.ts` — IndicatorSeriesLike, PINE_COMPARE_OPS, PineCompareOp, PlotSampleLike, lastNumericSample, listPlotKeys, plotSampleKey, plotSamplesFromCache, prevNumericSample
* `pine-bridge.ts` — EvaluatePineAlertsOpts, evaluatePineAlertsFromRun, notifyPineAlertsFromRun
* `pine.ts` — PINE_ALERT_CALL_RE, PineAlertEvalContext, PineAlertEvent, PineAlertFired, PineAlertSource, collectPineAlertEvents, evaluatePineAlertEventsPure, eventMatchesPineAlert, isPineScriptAlert, listPineAlertTitles, parsePineAlertConditions, parsePineAlertEvents
* `storage.ts` — ALERTS_STORAGE_KEY, _setMemoryAlertsForTests, clearAlertsStorage, loadAlerts, parseAlert, parseAlertsBlob, removeAlert, saveAlerts, subscribeAlerts, upsertAlert
* `tick.ts` — evaluateLiveAlerts, noteLiveBarForAlerts
* `types.ts` — Alert, AlertCreateInput, AlertKind, AlertParams, AlertUpdatePatch, AlertsStoreV1, EvaluateBar, EvaluateContext, L2WebhookPayload, PlotSampleRef, WebhookPayload
* `webhook.ts` — WEBHOOK_TIMEOUT_MS, buildL2WebhookPayload, buildWebhookPayload, deliverAlert, fireWebhook, formatAlertFireMessage, isAllowedWebhookUrl, notifyBrowserAlert

# Depends on

* [src/chart/drawings](/code/src/chart/drawings.md)
* [src/store](/code/src/store.md)

# Used by

* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/mcp](/code/src/mcp.md)
* [src/onchain](/code/src/onchain.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [tests](/code/tests.md)
