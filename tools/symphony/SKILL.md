---
name: symphony
description: Run OpenAI Symphony as a standalone workspace orchestrator (Linear -> workspace -> codex app-server) without embedding into OpenClaw.
metadata:
  {
    "openclaw":
      {
        "emoji": "S",
        "requires": { "bins": ["git", "codex"] }
      }
  }
---

# Symphony

Use this tool when user asks to run/operate `openai/symphony` as external orchestrator.

## Files

- Bootstrap: `/Users/dmitriy/openclaw/tools/symphony/scripts/bootstrap.sh`
- Doctor: `/Users/dmitriy/openclaw/tools/symphony/scripts/doctor.sh`
- Runner: `/Users/dmitriy/openclaw/tools/symphony/scripts/run.sh`
- Workflow template: `/Users/dmitriy/openclaw/tools/symphony/WORKFLOW.openclaw.example.md`

## Typical flow

1. Bootstrap:
```bash
cd /Users/dmitriy/openclaw/tools/symphony
./scripts/bootstrap.sh
```

2. Create runtime workflow:
```bash
cp /Users/dmitriy/openclaw/tools/symphony/WORKFLOW.openclaw.example.md \
  /Users/dmitriy/openclaw/tools/symphony/.runtime/WORKFLOW.md
```

3. Set env:
```bash
export LINEAR_API_KEY='...'
export SOURCE_REPO_URL='git@github.com:org/repo.git'
# optional
export LINEAR_ASSIGNEE='me'
```

4. Validate:
```bash
./scripts/doctor.sh
```

5. Start:
```bash
./scripts/run.sh
./scripts/run.sh -- --port 4010
```

## Behavior

- Keeps Symphony isolated under `tools/symphony/.runtime/`.
- Does not modify OpenClaw gateway config.
- Uses Symphony CLI acknowledgement switch automatically.
