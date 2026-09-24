# docs/plugins

# Concepts

* [Plugin contracts](contracts.md) - Formal TypeScript interfaces for AXIS source, stream, engine, storage, and component plugins (pynescript.axis.plugins.v1).
* [Datasets](datasets.md) - Dataset plugins — fetchDataset contract. The only built-in is defillama-tvl. GeckoTerminal pool candles are the geckoterminal-ohlcv source.
* [Dynamic plugin loader](dynamic-loader.md) - Install ES-module plugins from URL (source, stream, engine, dataset, component), persist, restore, safety rules.
* [Engines](engines.md) - Calculation engines: server (Flask/Worker) and client Pyodide — run contracts, assets, and readiness.
* [Plugins](index.md) - AXIS unified plugin system: source, stream, engine, storage, dataset — contracts, registry, catalogs, and dynamic ES-module loading.
* [PYNE Agent plugin](pyne-agent.md) - Install the pyne-agent-worker AXIS component plugin — natural-language PYNE script chat via Cloudflare® Workers AI™ (standalone or HOOX-enhanced).
* [Plugin registry](registry.md) - PluginRegistry singleton: ordered maps per kind, listeners, built-in protection, and bootstrap wiring.
* [Sources](sources.md) - Built-in historical data sources: venue REST, mock walk, CSV upload — contracts, config, and fallbacks.
* [Storage](storage.md) - Script library backends: local (IndexedDB), cloud (Worker /api/scripts), and git (GitHub/GitLab).
* [Streams](streams.md) - Live bar plugins: venue WebSockets, mock poll, and Cloudflare Durable Object relay example.
