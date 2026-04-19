---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: "REPLACE_WITH_LINEAR_PROJECT_SLUG"
  assignee: $LINEAR_ASSIGNEE
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
polling:
  interval_ms: 15000
workspace:
  root: $SYMPHONY_WORKSPACE_ROOT
hooks:
  after_create: |
    if [ -n "${SOURCE_REPO_PATH:-}" ]; then
      if [ ! -d "${SOURCE_REPO_PATH}" ]; then
        echo "SOURCE_REPO_PATH does not exist: ${SOURCE_REPO_PATH}"
        exit 1
      fi
      rsync -a --delete \
        --exclude '.git' \
        --exclude 'tools/symphony/.runtime/workspaces' \
        --exclude 'tools/symphony/.runtime/logs' \
        "${SOURCE_REPO_PATH}/" .
      exit 0
    fi
    if [ -z "${SOURCE_REPO_URL:-}" ]; then
      echo "SOURCE_REPO_PATH or SOURCE_REPO_URL is required"
      exit 1
    fi
    git clone --depth 1 "$SOURCE_REPO_URL" .
  before_run: |
    git remote -v >/dev/null 2>&1 || exit 0
    git fetch --all --prune || true
  timeout_ms: 120000
agent:
  max_concurrent_agents: 2
  max_turns: 12
  max_retry_backoff_ms: 180000
codex:
  command: ${CODEX_BIN:-codex} app-server
  approval_policy: on-request
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
  turn_timeout_ms: 1800000
  read_timeout_ms: 5000
  stall_timeout_ms: 180000
---

You are working on Linear issue {{ issue.identifier }}.

Title: {{ issue.title }}
State: {{ issue.state }}
URL: {{ issue.url }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

Rules:
1. Work only inside current issue workspace.
2. Keep changes minimal and focused on acceptance criteria.
3. Run relevant validation before final turn.
4. If blocked by missing secrets/permissions, report blocker precisely.
5. Do not guess target paths. If the request is ambiguous and multiple locations match, report ambiguity and ask for explicit path in the issue comments.
6. For requests about "openclaw logs" without explicit path: check `./logs` first. Do not use `./openclaw_x` or `./beta/openclaw_x` unless explicitly mentioned in title or description.
7. Before posting final result, include exact file path(s) used to collect data or make changes.
8. Do not move issue to terminal state when path ambiguity remains unresolved.
