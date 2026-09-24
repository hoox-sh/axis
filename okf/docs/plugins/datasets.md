---
type: "Document"
title: "Datasets"
description: "Dataset plugins — fetchDataset contract. The only built-in is defillama-tvl. GeckoTerminal pool candles are the geckoterminal-ohlcv source."
resource: "docs/plugins/datasets.mdx"
tags: [datasets, doc, docs, plugins]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/plugins/datasets.mdx"
    title: "docs/plugins/datasets.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/plugins/datasets.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * DatasetFetchOpts
  * OnchainDataset
* Providers
  * Worker proxy (CORS)
* Related

# Mentions

* [src/onchain](/code/src/onchain.md)
* [worker/src](/code/worker/src.md)
