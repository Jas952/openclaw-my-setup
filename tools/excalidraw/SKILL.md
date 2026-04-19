---
name: excalidraw
description: "Render Excalidraw JSON diagrams to PNG images. Use when: user provides a .excalidraw file or JSON and wants it converted to a PNG image. Supports rectangles, ellipses, diamonds, arrows, lines, text labels. NOT for: creating diagrams from scratch without JSON input."
homepage: https://excalidraw.com
metadata:
  {
    "openclaw":
      {
        "emoji": "✏️",
        "requires": { "bins": ["node"] },
      },
  }
---

# Excalidraw Renderer

Converts `.excalidraw` JSON files to PNG images. The user exports their diagram from [excalidraw.com](https://excalidraw.com) and you render it to PNG locally — no browser needed.

## When to Use

✅ **USE this skill when:**

- User shares a `.excalidraw` file or pastes Excalidraw JSON
- User asks to convert an Excalidraw diagram to PNG
- User wants a PNG export of their diagram without opening a browser

## When NOT to Use

❌ **DON'T use this skill when:**

- User wants to **create** a diagram from a description (create the JSON yourself, then render)
- User asks for Mermaid, PlantUML, or other diagram formats
- User needs vector output (SVG) — this tool outputs PNG only

## Supported Elements

| Type        | Description                              |
|-------------|------------------------------------------|
| rectangle   | Boxes with optional rounded corners      |
| ellipse     | Circles and ovals                        |
| diamond     | Decision shapes (flowchart)              |
| arrow       | Directional connectors with arrowheads   |
| line        | Connectors without arrowheads            |
| text        | Standalone or bound labels on shapes     |
| freedraw    | Freehand strokes                         |

## Command

```bash
node /Users/dmitriy/openclaw/tools/excalidraw/scripts/render.js <input.excalidraw> <output.png>
node /Users/dmitriy/openclaw/tools/excalidraw/scripts/render.js diagram.excalidraw out.png --scale 3
node /Users/dmitriy/openclaw/tools/excalidraw/scripts/render.js diagram.excalidraw out.png --padding 60
```

## Workflow

1. User provides `.excalidraw` file (or JSON pasted inline)
2. Save JSON to a temp file if needed: `/tmp/diagram.excalidraw`
3. Run render command → outputs PNG
4. Send the PNG to the user
