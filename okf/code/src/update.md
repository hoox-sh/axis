---
type: "Code Module"
title: "src/update"
description: "App update manager — polls the deployed /version.json and surfaces new releases as a banner + notification with a hard-reload action."
resource: "src/update"
tags: [code, update]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-07T03:59:37Z
sources:
  - id: tree
    resource: "src/update"
    title: "src/update"
    author: process:git
okf_lock: generated
---

# Files

* `update-manager.ts` — CheckForUpdatesOptions, PollHandle, ReloadDeps, StartPollingOptions, UPDATE_CHECK_THROTTLE_MS, UPDATE_POLL_MS, UpdateInfo, UpdateNotifyHooks, UpdateSource, UpdateState, UpdateStatus, VersionJson

# Packages

`solid-js`

# Depends on

* [src](/code/src.md)
* [src/pwa](/code/src/pwa.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/utils](/code/src/utils.md)

# Used by

* [src](/code/src.md)
* [src/mcp](/code/src/mcp.md)
* [src/ui](/code/src/ui.md)
* [tests](/code/tests.md)
