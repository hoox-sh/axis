---
type: "Code Module"
title: "packages/cli/src/commands"
description: "packages/cli/src/commands contains deploy.ts, dev.ts, doctor.ts, and 7 more files."
resource: "packages/cli/src/commands"
tags: [cli, code, commands, packages]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-10T20:32:38Z
sources:
  - id: tree
    resource: "packages/cli/src/commands"
    title: "packages/cli/src/commands"
    author: process:git
okf_lock: generated
---

# Files

* `deploy.ts` — deployAll, deployPages, deployWorker, parseDeployedWorkerUrl, registerDeploy
* `dev.ts` — registerDev
* `doctor.ts` — DoctorCheck, collectDoctorChecks, registerDoctor, runDoctor
* `health.ts` — registerHealth, runHealth
* `install.ts` — registerInstall, runInstall
* `keys.ts` — registerKeys, runKeysCreate, runKeysValidate
* `mcp.ts` — mcpClientConfig, mcpEndpoint, postMcp, registerMcp, runStdioProxy
* `secrets.ts` — KNOWN_SECRETS, dropPlaintextVarForSecret, isBindingNameInUse, registerSecrets, requiresDeployRetry, secretDelete, secretList, secretPut
* `setup.ts` — SetupResult, applyScriptsSchema, d1ApplyPlan, kvTitleMatchesBinding, printCloudStorageNextSteps, prodBootstrapError, registerSetup, runSetupAll, setupKv
* `whoami.ts` — registerWhoami

# Packages

`commander`, `node:fs`, `node:path`, `node:readline`
