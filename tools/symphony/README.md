# Symphony Tool (Workspace Orchestrator)

This folder wires `openai/symphony` as a separate tool for workspace-based Codex runs.
No OpenClaw embedding is required.

## What you get

- Local upstream clone at `tools/symphony/.runtime/upstream`
- Bootstrap/update script
- Doctor checks for required binaries/env
- Run script with guardrails acknowledgement pre-wired
- Detached service manager (`screen`): start/stop/status/logs
- Starter workflow template for Linear + Codex

## Quick start

1. Bootstrap upstream:

```bash
cd /Users/dmitriy/openclaw/tools/symphony
./scripts/bootstrap.sh
```

2. Prepare workflow file:

```bash
cp WORKFLOW.openclaw.example.md .runtime/WORKFLOW.md
```

Edit `.runtime/WORKFLOW.md` and set:

- `tracker.project_slug`
- `hooks.after_create` source repo URL (or keep `SOURCE_REPO_URL` env pattern)

3. Export required auth:

```bash
export LINEAR_API_KEY='...'
# if codex is not in PATH, pin binary explicitly
# export CODEX_BIN='/absolute/path/to/codex'
# optional: route tasks only assigned to you
export LINEAR_ASSIGNEE='me'
# if template hook uses env cloning
export SOURCE_REPO_URL='git@github.com:your-org/your-repo.git'
# or use local source tree snapshot mode
# export SOURCE_REPO_PATH='/absolute/path/to/source/tree'
# optional: keep issue workspaces outside source tree
# export SYMPHONY_WORKSPACE_ROOT='/absolute/path/to/workspaces'
```

Alternative: persist overrides in `.runtime/.env` (copy from `.runtime/.env.example`).

4. Run checks:

```bash
./scripts/doctor.sh
```

5. Start Symphony in detached mode (recommended):

```bash
./scripts/service.sh start -- --port 4010
# check health
./scripts/service.sh status
# tail output
./scripts/service.sh logs
```

6. Stop service:

```bash
./scripts/service.sh stop
```

Foreground mode (for debugging):

```bash
./scripts/run.sh -- --port 4010
```

## Notes

- `run.sh` accepts optional first positional arg as workflow path.
- Extra CLI args for `bin/symphony` can be passed after `--`.
- `service.sh start` accepts optional workflow path and extra args after `--`.
- `codex app-server` must be available on PATH.
- If `codex` is not on PATH, set `CODEX_BIN` (workflow uses `${CODEX_BIN:-codex} app-server`).
- Scripts auto-load optional `.runtime/.env`.
- Scripts auto-detect defaults:
  - `CODEX_BIN` from PATH or known local codex locations
  - `SOURCE_REPO_URL` from local repos (`openclaw_x`, `beta/openclaw_x`) when present
- `hooks.after_create` supports two modes:
  - `SOURCE_REPO_URL`: `git clone` mode
  - `SOURCE_REPO_PATH`: local tree sync mode (`rsync`)
- Without `LINEAR_API_KEY` or valid `tracker.project_slug`, Symphony will run but won't process Linear issues.
- This is still an engineering preview; start with low concurrency.
