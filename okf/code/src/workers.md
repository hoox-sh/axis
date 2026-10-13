---
type: "Code Module"
title: "src/workers"
description: "AXIS workers catalog + health probes (Workers Manager)."
resource: "src/workers"
tags: [code, workers]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-13T19:44:07Z
sources:
  - id: tree
    resource: "src/workers"
    title: "src/workers"
    author: process:git
okf_lock: generated
---

# Files

* `catalog.ts` — DEFAULT_AXIS_WORKER_BASE, DEFAULT_PYNE_PRO_BASE, LOCAL_AXIS_WORKER_BASE, PRODUCT_PYNE_PRO_HINT, PRODUCT_SAME_ORIGIN_API_HOSTS, WORKER_CATALOG, endpointsMatch, getWorkerCatalogEntry, isLoopbackBase, isProductSameOriginApiHost, listWorkerCatalog, matchCatalogForEndpoint
* `index.ts` — DEFAULT_AXIS_WORKER_BASE, DEFAULT_PYNE_PRO_BASE, LOCAL_AXIS_WORKER_BASE, PRODUCT_PYNE_PRO_HINT, PRODUCT_SAME_ORIGIN_API_HOSTS, WORKER_CATALOG, WorkerCatalogEntry, WorkerHealthStatus, WorkerIconKey, WorkerId, WorkerInstallStep, WorkerKind
* `probe.ts` — ProbeWorkerOpts, probeAbortSignal, probeAllWorkers, probeWorker, workerHealthLabel
* `pyodide-client.ts` — ABORTED, PyodideAbortedError, PyodideWorkerError, PyodideWorkerFactory, PyodideWorkerLoadInfo, PyodideWorkerRuntime, PyodideWorkerTransport, isPyodideWorkerLoaded, loadPyodideWorker, pyodideWorkerAvailable, raceAbort, runPyodideWorker
* `pyodide-protocol.ts` — PyodideLoadBody, PyodideLoadRequest, PyodideRunBody, PyodideRunRequest, PyodideWorkerRequest, PyodideWorkerResponse
* `pyodide-runtime.ts` — PyodideLike, assertZipAsset, callPyodideRunScript, formatPyodideBridgeError, installPynescriptRuntime, pyodideRuntimeAcceptsInputs
* `pyodide-worker-core.ts` — PyodideWorkerCoreDeps, createPyodideWorkerCore
* `pyodide.worker.ts`
* `types.ts` — WorkerCatalogEntry, WorkerHealthStatus, WorkerIconKey, WorkerId, WorkerInstallStep, WorkerKind, WorkerProbeResult, WorkerRole, WorkersOverviewSnapshot

# Packages

`micropip`

# Depends on

* [src/data](/code/src/data.md)
* [src/engines](/code/src/engines.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/utils](/code/src/utils.md)

# Used by

* [src/engines](/code/src/engines.md)
* [src/ui/runtime](/code/src/ui/runtime.md)
* [src/ui/workers](/code/src/ui/workers.md)
* [tests](/code/tests.md)
