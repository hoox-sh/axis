---
type: "Code Module"
title: "src/plugins"
description: "Public entry for the AXIS plugin system."
resource: "src/plugins"
tags: [code, plugins]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-25T04:56:02Z
sources:
  - id: tree
    resource: "src/plugins"
    title: "src/plugins"
    author: process:git
okf_lock: generated
---

# Files

* `active.ts` — getActiveEngine, getActiveEngineConfig, getActiveEngineId, getActiveProvider, getActiveSource, getActiveSourceConfig, getActiveSourceId, getActiveStorage, getActiveStorageId, getActiveStream, getActiveStreamConfig, getActiveStreamId
* `bootstrap.ts` — _resetBootstrapFlag, ensureBuiltins, registerBuiltins
* `example-cf-do-stream.js`
* `example-coingecko-source.js`
* `example-tiny-pyne-engine.js`
* `hpo.ts` — HPO_PLUGIN_ID, _resetHpoRegistrationFlag, ensureHpoRegistered, hpoPlugin
* `index.ts` — PLUGINS_KEY, PluginRegistry, ensureBuiltins, exportLibraryJson, getActiveEngine, getActiveEngineConfig, getActiveEngineId, getActiveProvider, getActiveSource, getActiveSourceConfig, getActiveSourceId, getActiveStorage
* `loader.ts` — DEFAULT_PYNE_AGENT_ENDPOINT, DEFAULT_PYNE_AGENT_PLUGIN_URL, DEFAULT_REMOTE_PLUGIN_HOSTS, InstalledPlugin, LEGACY_PYNE_AGENT_PLUGIN_URL, PLUGINS_KEY, assertPluginRemoteAllowed, assertSafePluginUrl, getInstalledPlugins, isRemoteHttpPluginUrl, loadPluginFromUrl, migratePyneAgentPluginUrl
* `registry.ts` — PluginRegistry, registry
* `types.ts` — AnyPlugin, ComponentPlugin, ConfigSchema, DatasetPlugin, EngineLibrarySource, EngineOpts, EnginePlugin, FieldSchema, PlotSample, PluginBase, PluginCapabilities, PluginContext

# Other files

* `README.md`

# Packages

`…/plugins`

# Depends on

* [src/data](/code/src/data.md)
* [src/engines](/code/src/engines.md)
* [src/onchain](/code/src/onchain.md)
* [src/sources](/code/src/sources.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/utils](/code/src/utils.md)

# Used by

* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/data](/code/src/data.md)
* [src/editor](/code/src/editor.md)
* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/mcp](/code/src/mcp.md)
* [src/onchain](/code/src/onchain.md)
* [src/optimize](/code/src/optimize.md)
* [src/results](/code/src/results.md)
* [src/sources](/code/src/sources.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [src/ui/architecture](/code/src/ui/architecture.md)
* [src/ui/library](/code/src/ui/library.md)
* [src/ui/plugins](/code/src/ui/plugins.md)
* [src/ui/runtime](/code/src/ui/runtime.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [src/ui/workers](/code/src/ui/workers.md)
* [src/workers](/code/src/workers.md)
* [tests](/code/tests.md)
* [tests/integration](/code/tests/integration.md)
* [tests/security](/code/tests/security.md)
