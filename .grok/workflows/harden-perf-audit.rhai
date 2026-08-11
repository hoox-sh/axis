let meta = #{
    name: "harden-perf-audit",
    description: "4-agent code hardening audit + performance scan, then prioritized fix plan",
    phases: [
        #{ title: "Audit", detail: "four parallel specialist scanners" },
        #{ title: "Synthesize", detail: "merge, de-dupe, rank, write report" },
    ],
    when_to_use: "Security hardening and performance improvement pass across AXIS client + worker",
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 10,
            "items": #{
                "type": "object",
                "required": ["severity", "area", "file", "issue", "fix", "effort"],
                "properties": #{
                    "severity": #{ "type": "string", "enum": ["critical", "high", "medium", "low"] },
                    "area": #{ "type": "string", "enum": ["security", "hardening", "performance", "reliability"] },
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "fix": #{ "type": "string" },
                    "effort": #{ "type": "string", "enum": ["S", "M", "L"] },
                    "evidence": #{ "type": "string" },
                },
            },
        },
        "notes": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["summary", "top_fixes", "report_markdown"],
    "properties": #{
        "summary": #{ "type": "string" },
        "top_fixes": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["priority", "severity", "area", "file", "issue", "fix", "effort"],
                "properties": #{
                    "priority": #{ "type": "integer" },
                    "severity": #{ "type": "string" },
                    "area": #{ "type": "string" },
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "fix": #{ "type": "string" },
                    "effort": #{ "type": "string" },
                },
            },
        },
        "report_markdown": #{ "type": "string" },
    },
};

// Scope: full AXIS repo unless args.root narrows it.
let root = if args == () { "repo root (src/, worker/, packages/cli/, server.ts)" } else if args.root == () {
    "repo root (src/, worker/, packages/cli/, server.ts)"
} else {
    args.root
};

phase("Audit");

let common = "";
common += "You are auditing the AXIS repo (SolidJS + Vite PWA + Cloudflare Worker). ";
common += "Workspace is the git root. Use read_file, grep, list_dir only — read-only. ";
common += "Do NOT invent APIs. Do NOT claim TradingView affiliation. ";
common += "Inspect real code before reporting. Empty findings only after real searches. ";
common += "Each finding needs concrete file path, short issue, concrete fix, effort S/M/L, ";
common += "and evidence (function name or quote). Max 10 findings, highest impact first. ";
common += "Scope: " + root + ". ";

let p1 = common;
p1 += "ROLE: Security auditor. Focus: auth (worker/src/auth.ts, keys.ts, git-oauth.ts), ";
p1 += "CORS/origin (worker/src/index.ts), SSRF/allowlist on /api/onchain (worker/src/onchain.ts), ";
p1 += "XSS/innerHTML, postMessage, plugin loader (src/plugins), secret leakage, open redirects, ";
p1 += "API key in query strings, WebSocket auth, Tauri capabilities if present. ";
p1 += "Search for: extractBearer, ALLOW_OPEN_KEYS, pickOrigin, allowlist, innerHTML, eval, ";
p1 += "postMessage, Bearer, ?key=, dangerously, URL construction.";

let p2 = common;
p2 += "ROLE: Hardening / reliability auditor. Focus: input validation, error handling that ";
p2 += "swallows failures, race conditions, unbounded caches, missing timeouts, retry storms, ";
p2 += "WS reconnect (src/engines/engine-ws.ts, streams), service worker (src/sw, public/sw.js), ";
p2 += "runner hardening (src/indicators/runner.ts), storage migration safety, uncaught promises. ";
p2 += "Search for: catch (_), catch (e) {}, setInterval, while (true), Map(, cache, AbortSignal, ";
p2 += "timeout, reconnect, queue, mutex, lock.";

let p3 = common;
p3 += "ROLE: Client performance auditor. Focus: SolidJS re-render churn (src/ui, src/app.tsx), ";
p3 += "chart series updates (src/chart), heavy lists without virtualization, JSON parse on hot path, ";
p3 += "duplicate network fetches, localStorage thrash (src/state.js, storage), editor load cost, ";
p3 += "indicator re-run cost, O(n^2) loops on bars. ";
p3 += "Search for: createEffect, createMemo, forEach on bars, JSON.parse, requestAnimationFrame, ";
p3 += "setData, update, subscribe, debounce, throttle, batch.";

let p4 = common;
p4 += "ROLE: Data-path / worker performance auditor. Focus: data-source-manager backfill ";
p4 += "(src/data/data-source-manager.ts), bars cache/gap-fill, onchain jobs (src/onchain), ";
p4 += "Worker proxy caching, D1 query patterns (worker/src/scripts.ts), multiplex streams, ";
p4 += "payload size, N+1 fetches, unnecessary full-history loads. ";
p4 += "Search for: backfill, gap, cache, fetch(, Promise.all, limit, page, cursor, batch, ";
p4 += "deflama, gecko, OHLCV.";

let jobs = [
    #{ prompt: p1, label: "audit:security", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p2, label: "audit:hardening", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p3, label: "audit:client-perf", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p4, label: "audit:data-perf", capability_mode: "read-only", output_schema: findings_schema },
];

let results = parallel(jobs);

let all = [];
let i = 0;
for r in results {
    if r != () && r.success && r.output.findings != () {
        for f in r.output.findings {
            all.push(f);
        }
        log("auditor " + i.to_string() + " returned findings");
    } else {
        log("auditor " + i.to_string() + " failed or empty");
    }
    i += 1;
}

if all.len() == 0 {
    complete(#{ summary: "No findings from any auditor.", top_fixes: [], report_markdown: "No findings." });
}

phase("Synthesize");

let synth = "";
synth += "You are the lead engineer synthesizing a hardening + performance audit of AXIS. ";
synth += "Below is JSON of raw findings from 4 specialists. De-duplicate, drop false positives, ";
synth += "rank by (severity, user impact, effort). Produce top_fixes (max 12) and a full ";
synth += "report_markdown with: Executive summary, Critical/High list, Medium/Low backlog, ";
synth += "Recommended first PR (3-6 concrete file-level changes), and Out of scope notes. ";
synth += "Use only the provided findings plus your judgment; do not invent new issues. ";
synth += "Raw findings JSON:\n";
synth += json_encode(all);

let s = agent(synth, #{
    label: "synthesize",
    capability_mode: "read-only",
    output_schema: report_schema,
});

if s == () || !s.success || s.output.report_markdown == () {
    // Fail open with raw dump if synthesizer fails
    let fallback = "# Hardening + Performance Audit (raw)\n\nSynthesizer failed; raw findings:\n\n";
    fallback += json_encode(all);
    let path = write_scratch_file("harden-perf-report.md", fallback);
    complete(#{
        summary: "Synthesizer failed; " + all.len().to_string() + " raw findings retained.",
        top_fixes: [],
        report_markdown: fallback,
        path: path,
    });
}

let report = s.output.report_markdown;
let path = write_scratch_file("harden-perf-report.md", report);
log("wrote report to " + path);
complete(#{
    summary: s.output.summary,
    top_fixes: s.output.top_fixes,
    report_markdown: report,
    path: path,
    raw_count: all.len(),
});
