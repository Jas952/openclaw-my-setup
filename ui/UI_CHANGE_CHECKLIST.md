# UI Change Checklist

Date: 2026-03-17
Target: `beta/UI`

- [x] Updated visual direction to a restrained Jarvis-like style with black/gray dominance.
- [x] Reworked layout so the avatar block stays centered across screen resolutions.
- [x] Reworked layout so microphone + text composer stays centered under the avatar.
- [x] Reduced left thread panel footprint and made it compact.
- [x] Added animated avatar behavior for `idle`, `listening`, `thinking`, `streaming`, `error`.
- [x] Replaced vector redraw approach with image-based avatar component (`AgentAvatar`).
- [ ] Put the exact original mask image file at `beta/UI/public/assets/agent-mask-original.jpg` (no edits to the image).

Notes:
- Current UI expects the original image file at `/beta/UI/public/assets/agent-mask-original.jpg`.
- If the image is missing, UI shows a fallback placeholder message instead of crashing.
