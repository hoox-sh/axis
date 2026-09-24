---
type: "Code Module"
title: "src/storage"
description: "src/storage contains catalog.ts, cloud-config.ts, cloud.ts, and 13 more files."
resource: "src/storage"
tags: [code, storage]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:05:44Z
sources:
  - id: tree
    resource: "src/storage"
    title: "src/storage"
    author: process:git
okf_lock: generated
---

# Files

* `catalog.ts` — BUILTIN_STORAGES, _resetStorageRegistrationFlag, ensureStoragesRegistered, getStorage, listStorages, registerDynamicStorage, unregisterDynamicStorage
* `cloud-config.ts` — CloudConfig, coerceWorkerEndpoint, defaultCloudEndpoint, generateDemoApiKey, resolveCloudConfig, writeStoredCloudConfig
* `cloud.ts` — CloudConfig, cloudStoragePlugin, defaultCloudEndpoint, generateDemoApiKey, probeCloudStorage, resolveCloudConfig, writeStoredCloudConfig
* `git-config.ts` — DEFAULT_GIT_CONFIG, GitConfig, GitIndexCorruptError, GitProvider, assertGitConfig, assertSafeRepoPath, formatCommitMessage, indexPath, libraryDir, normalizeRepoPath, resolveGitConfig, resolveScriptRepoPath
* `git-github.ts` — IndexFile, githubDeleteFile, githubGetFile, githubGetFileAtRef, githubList, githubListFileCommits, githubPutFile, githubRead, githubReadIndex, githubRemove, githubStatus, githubWrite
* `git-gitlab.ts` — gitlabDeleteFile, gitlabGetFile, gitlabGetFileAtRef, gitlabList, gitlabListFileCommits, gitlabPutFile, gitlabRead, gitlabReadIndex, gitlabRemove, gitlabStatus, gitlabWrite, gitlabWriteIndex
* `git-oauth.ts` — DevicePollResult, DeviceStartResult, GitUserInfo, defaultVerificationUri, fetchGitUser, isOAuthProxyBase, manualTokenCreateUrl, pollDeviceFlow, resolveOAuthProxyBase, sanitizeVerificationUri, startDeviceFlow, waitForDeviceToken
* `git.ts` — ScriptDocument, ScriptMeta, ScriptVersion, gitStoragePlugin
* `idb.ts` — idbAvailable, idbReq, idbTxDone, openDb
* `import-pyne-files.ts` — ImportPyneResult, ImportedPyneScript, PyneSourceInput, SanitizePyneResult, dataTransferHasPyneFiles, filterPyneFiles, importPyneFiles, importPyneSources, isPyneFileName, readFileAsText, sanitizePyneSource, scriptNameFromFileName
* `import-pyne-open.ts` — ImportEditorHost, OpenImportedOptions, applyImportedPyneResult, importAndOpenPyneFiles, importAndOpenPyneSources
* `library-publish-io.ts` — PublishLibraryResult, _resetPublishedCacheForTests, formatImportSnippet, listPublishedLibraries, publishLibrary, readCachedLibrarySource, resolveLibrariesForScript, resolvePublishedLibrary
* `library-publish.ts` — LibraryImportSpec, PUBLISHED_CACHE_KEY, PUBLISHED_INDEX_VERSION, PublishedIndex, PublishedLibrary, buildPublishedRecord, contentSha, defaultPublishNamespace, emptyPublishedIndex, formatImportSnippet, latestPublished, nextPublishedVersion
* `local.ts` — LOCAL_STORAGE_VERSION, MAX_RESULTS_PER_SCRIPT, MAX_VERSIONS_PER_SCRIPT, _clearLocalLibraryForTests, _getMemResultsForTests, _resetLocalMigrationFlag, localStoragePlugin
* `service.ts` — CopyScriptFailure, CopyScriptsResult, ResultMeta, StoredRunResult, _resetPendingStorageChangeForTests, cancelPendingStorageChange, copyScriptsBetweenStorages, exportLibraryJson, getActiveStoragePlugin, getPendingStorageChange, getStorageStatus, importLibraryJson
* `workspace-snapshot.ts` — BuildWorkspaceSnapshotOptions, EDITOR_PREFS_KEYS, EditorPrefsKey, EditorPrefsSnapshot, PanelChromeSnapshot, ScriptSnapshotMeta, WORKSPACE_SNAPSHOT_KIND, WORKSPACE_SNAPSHOT_VERSION, WorkspaceSnapshot, WorkspaceSnapshotApplyFields, WorkspaceSnapshotParseError, WorkspaceSnapshotSetters

# Packages

`solid-js`

# Depends on

* [src/chart](/code/src/chart.md)
* [src/chart/drawings](/code/src/chart/drawings.md)
* [src/data](/code/src/data.md)
* [src/indicators](/code/src/indicators.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/panels](/code/src/ui/panels.md)

# Used by

* [src](/code/src.md)
* [src/data](/code/src/data.md)
* [src/desktop](/code/src/desktop.md)
* [src/editor](/code/src/editor.md)
* [src/indicators](/code/src/indicators.md)
* [src/mcp](/code/src/mcp.md)
* [src/onchain](/code/src/onchain.md)
* [src/optimize](/code/src/optimize.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/architecture](/code/src/ui/architecture.md)
* [src/ui/library](/code/src/ui/library.md)
* [src/ui/plugins](/code/src/ui/plugins.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [tests](/code/tests.md)
* [tests/integration](/code/tests/integration.md)
* [tests/security](/code/tests/security.md)
