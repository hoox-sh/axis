# playbooks

# Concepts

* [AXIS map](axis-map.md) - Where the chart, data plane, editor, worker, and CLI live, and which repo owns Pine evaluation.
* [Chart apply and bar windows](chart-apply-and-bar-windows.md) - Repair never drop at the setData boundary, and the three bar counts a live tick has to keep straight.
* [Engine stream](engine-stream.md) - The WS subscription plane (subscribe → status → full → delta → close): profiles, frames, watermark, close verification, and reconnect.
* [Live chart engine](hp-engine.md) - Lightweight Charts paints the chart. The ingest worker decodes AXB1. The shared-memory ring and GPU overlay are gone.
* [Live evaluation sessions](live-evaluation-sessions.md) - When the O(delta) session path may run (calculator profile), what continuity requires, which responses are not results, and how failures are memoised. For the stream profile see…
* [How to read the AXIS bundle](read-this-first.md) - Read the root index, open one concept, and follow its links instead of scanning the repo.
