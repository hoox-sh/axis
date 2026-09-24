---
type: "Code Module"
title: "src/pwa"
description: "src/pwa contains close-guard.ts, install-prompt.ts, register-sw.ts."
resource: "src/pwa"
tags: [code, pwa]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:05:44Z
sources:
  - id: tree
    resource: "src/pwa"
    title: "src/pwa"
    author: process:git
okf_lock: generated
---

# Files

* `close-guard.ts` — CloseGuardPredicate, _resetCloseGuardForTests, closeGuardPredicateIds, getCloseGuardMessage, installCloseGuard, isCloseGuardEnabled, registerCloseGuardPredicate, setCloseGuardEnabled, setCloseGuardMessage, shouldConfirmClose, uninstallCloseGuard, unregisterCloseGuardPredicate
* `install-prompt.ts` — BeforeInstallPromptEvent, _resetPwaInstallPromptForTests, dismissPwaInstallPrompt, listenForPwaInstallPrompt, promptPwaInstall, pwaInstallAvailable
* `register-sw.ts` — SKIP_WAITING_MESSAGE, _resetRegisterAxisServiceWorkerForTests, isDevBuild, isTauriShell, onWorkerInstalled, postSkipWaiting, registerAxisServiceWorker, requestWaitingWorkerActivation, shouldSoftReloadOnControllerChange, tryActivateWaitingWorker

# Packages

`solid-js`

# Used by

* [src](/code/src.md)
* [src/editor](/code/src/editor.md)
* [src/ui](/code/src/ui.md)
* [src/update](/code/src/update.md)
* [tests](/code/tests.md)
