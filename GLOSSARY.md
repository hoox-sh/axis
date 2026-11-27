# Glossary

How axis names things. Read this before naming a module, route, event,
state, or command — and add a term here in the same change that coins it.

Format: **Term** — one line. _Avoid:_ the near-synonym that causes drift.

<!-- oo:glossary-seed — delete this marker once every TODO below is filled in. -->

## Project terms

- **TODO** — replace this with the first domain term the team coins. _Avoid:_ TODO.
- **axis** — AXIS — open charting PWA: CEX OHLCV, drawings, on-chain overlays, and Pine Script™ via PYNE (local API, Cloudflare Worker, or Pyodide). Part of HOOX: hoox.sh/axis
- **Docs** — TODO: what the docs slice owns, and what it never does.
- **Engineering** — TODO: what the engineering slice owns, and what it never does.
- **Identity** — TODO: what the identity slice owns, and what it never does.
- **Design** — TODO: what the design slice owns, and what it never does.

<!-- oo:glossary:begin -->

## Engineering vocabulary

Shared ground for humans and seats, adapted from the codebase-design skill.
Use these terms exactly; do not substitute near-synonyms.

- **Module** — anything with an interface and an implementation. Scale-agnostic: a function, a package, or a tier-spanning slice. _Avoid:_ unit, component, service.
- **Interface** — everything a caller must know: the signature plus invariants, ordering constraints, error modes, required configuration. _Avoid:_ API, signature (both too narrow).
- **Implementation** — what sits behind the interface. _Avoid:_ guts, internals.
- **Depth** — leverage at the interface: how much behaviour a caller exercises per unit of interface learned. A deep module hides a lot behind a small interface.
- **Seam** — where you can alter behaviour without editing in that place; the location where an interface lives. _Avoid:_ boundary (overloaded with bounded context).
- **Adapter** — a concrete thing that satisfies an interface at a seam. _Avoid:_ wrapper, shim.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, and verification concentrate in one place.
- **Deep module** — small interface, large implementation. The default goal.
- **Shallow module** — the interface is nearly as complex as the implementation; complexity leaks to every caller. _Avoid:_ pass-through helpers.

## Maintaining this file

1. Coin the term in code and here in the same change.
2. One line per term; link the doc that owns the detail instead of growing entries.
3. If this file and the code disagree, one of them is wrong — fix it in the same change.
4. Reviewers: flag domain terms that appear without an entry here.

<!-- oo:glossary:end -->
