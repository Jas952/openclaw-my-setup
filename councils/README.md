# Councils

Canonical structure:

- `engine/` - orchestration (`run-council.js`, registry, cadence, evidence normalization)
- `checks/security-checks/` - reusable checks and security modules
- `checks/review-profiles/` - council profiles (Security / Platform Health / Heartbeat)
- `data/` - reports, evidence, state, delivery scripts (Telegram + deep-dive)

## Machine-readable output

Council reports are saved under:

- `councils/data/reports/<profile>/latest.json`
- `councils/data/reports/<profile>/<profile>-<timestamp>.json`

Format guarantees:

- `reportFormatVersion`
- `headings` (`SECURITY_CONTEXT`, `PERSPECTIVE_ANALYSIS`, `NUMBERED_RECOMMENDATIONS`, `EVIDENCE_INDEX`)
- `recommendations[]` with severity, perspective, recommendation text
- `references[]` with explicit `path:line`
- `evidenceIndex[]` for fast parser/LLM navigation

## Compatibility

Legacy paths in `security-and-safety/` are preserved as wrappers/symlinks and forward to `councils/`.
