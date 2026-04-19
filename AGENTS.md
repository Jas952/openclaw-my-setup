# Operational Guardrails

## Gateway Safety Rule (Critical)
- Before any edit to OpenClaw configuration files (for example `~/.openclaw/openclaw.json`), always stop gateway/background OpenClaw processes first.
- After config changes are applied, keep gateway stopped unless the user explicitly asks to start/restart it.
- If gateway was started by the assistant during troubleshooting, stop it again before finishing the task unless explicitly instructed otherwise.

## Scope
- Applies to all assistant actions in this repo/workspace when changing runtime/config behavior.
- Primary target process names: `openclaw-gateway`, `openclaw` (parent launcher), and browser helpers under `~/.openclaw/browser/openclaw`.
