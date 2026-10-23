# docs/architecture

# Concepts

* [Architecture Decision Records](adrs.md) - ADR-001 through ADR-015 for AXIS: registry, AXIS≠engine, Solid+Vite, three built-in engines, configSchema, URL load, storage, CF project id, proxies, DO fan-out, migration, CORS,…
* [Drawings and plot parity](drawings-parity.md) - Plan to make user drawing tools and Pine plot/drawing outputs match PYNE and render with correct pane, color, geometry, and settings.
* [Evaluation map](evaluation.md) - How AXIS runs Pine: Flask Pro API, Worker proxy, in-browser Pyodide. AXIS does not import PyneTS and does not place HOOX orders.
* [High-performance engine](hp-engine.md) - The opt-in HP plane: rungs HP-0…HP-4, feature flags, isolation, AXB1 transport, SAB memory, the GPU paint rung, HUD chip, and fallback rules.
* [Architecture](index.md) - AXIS system architecture: AXIS vs engine, plugin registry, topologies, ADRs, and state namespaces.
* [Architecture overview](overview.md) - End-to-end AXIS architecture: Solid AXIS UI, unified registry, three built-in engines, chart apply pipeline, and optional edge plane.
* [State namespaces](state-namespaces.md) - AXIS persistence keys, key migration, pluginsConfig, editor docs, library IDB, and URL hash state.
* [Topologies](topologies.md) - AXIS deploy and dev topologies: Vite+Flask, static PWA, Cloudflare® Pages+Worker, offline Pyodide lab, and local Bun sidecar.
