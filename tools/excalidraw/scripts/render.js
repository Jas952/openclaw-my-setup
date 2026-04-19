#!/usr/bin/env node
"use strict";

/**
 * Render an Excalidraw JSON file to PNG.
 * Usage: node render.js <input.excalidraw> <output.png> [--scale N] [--padding N]
 *
 * Supported element types: rectangle, ellipse, diamond, arrow, line, freedraw, text, image(skipped)
 */

const fs   = require("fs");
const path = require("path");

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function getArg(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

const inputFile  = argv.find(a => !a.startsWith("--") && argv.indexOf(a) === 0) || argv[0];
const outputFile = argv.find(a => !a.startsWith("--") && argv.indexOf(a) === 1) || argv[1];
const SCALE      = Number(getArg("--scale"))   || 2;    // pixel density
const PADDING    = Number(getArg("--padding")) || 40;   // px around content

if (!inputFile || !outputFile) {
  console.error("Usage: node render.js <input.excalidraw> <output.png> [--scale N] [--padding N]");
  process.exit(1);
}

// ── Parse input ───────────────────────────────────────────────────────────────
const data     = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const elements = (data.elements || []).filter(e => !e.isDeleted);
const bgColor  = data.appState?.viewBackgroundColor || "#ffffff";

// ── Bounding box ──────────────────────────────────────────────────────────────
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

function expandBounds(x, y) {
  minX = Math.min(minX, x); minY = Math.min(minY, y);
  maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
}

for (const el of elements) {
  if (el.type === "freedraw" || el.type === "arrow" || el.type === "line") {
    for (const [px, py] of (el.points || [])) {
      expandBounds(el.x + px, el.y + py);
    }
  }
  expandBounds(el.x, el.y);
  expandBounds(el.x + (el.width || 0), el.y + (el.height || 0));
}

if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 600; maxY = 400; }

const vx = minX - PADDING;
const vy = minY - PADDING;
const vw = (maxX - minX) + PADDING * 2;
const vh = (maxY - minY) + PADDING * 2;

// ── Helpers ───────────────────────────────────────────────────────────────────
function escXml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fontFamily(ff) {
  if (ff === 1) return "'Virgil', 'Comic Sans MS', cursive";
  if (ff === 2) return "'Cascadia Code', 'Courier New', monospace";
  return "Helvetica, Arial, sans-serif";
}

function fill(el) {
  if (!el.backgroundColor || el.backgroundColor === "transparent") return "none";
  return el.backgroundColor;
}

function stroke(el) { return el.strokeColor || "#1e1e1e"; }
function sw(el)     { return el.strokeWidth  || 1; }
function opacity(el){ return ((el.opacity ?? 100) / 100).toFixed(3); }

function cornerRadius(el) {
  if (!el.roundness) return 0;
  if (el.roundness.type === 3) return Math.round(Math.min(el.width, el.height) * 0.1);
  return el.roundness.value || 0;
}

function strokeDash(el) {
  if (el.strokeStyle === "dashed")  return 'stroke-dasharray="8,4"';
  if (el.strokeStyle === "dotted")  return 'stroke-dasharray="2,4"';
  return "";
}

// ── Text rendering ────────────────────────────────────────────────────────────
function renderText(el) {
  if (!el.text?.trim()) return "";
  const lines   = el.text.split("\n");
  const fs      = el.fontSize || 20;
  const lh      = fs * 1.25;
  const cx      = el.x + (el.width  || 0) / 2;
  const cy      = el.y + (el.height || 0) / 2;
  const anchor  = el.textAlign === "left" ? "start" : el.textAlign === "right" ? "end" : "middle";
  const xPos    = el.textAlign === "left"  ? el.x :
                  el.textAlign === "right" ? el.x + (el.width || 0) : cx;
  const startY  = cy - ((lines.length - 1) * lh) / 2;
  const col     = stroke(el);
  const ff      = fontFamily(el.fontFamily);
  const op      = opacity(el);

  return lines.map((line, i) =>
    `<text x="${xPos}" y="${(startY + i * lh).toFixed(1)}" ` +
    `font-family="${ff}" font-size="${fs}" text-anchor="${anchor}" ` +
    `dominant-baseline="middle" fill="${col}" opacity="${op}">${escXml(line)}</text>`
  ).join("\n");
}

// ── Arrowhead marker ──────────────────────────────────────────────────────────
function makeMarker(id, color, reverse = false) {
  const pts = reverse ? "10 0, 0 3.5, 10 7" : "0 0, 10 3.5, 0 7";
  const refX = reverse ? 0 : 10;
  return `<marker id="${id}" markerWidth="10" markerHeight="7" ` +
         `refX="${refX}" refY="3.5" orient="auto" markerUnits="strokeWidth">` +
         `<polygon points="${pts}" fill="${color}"/></marker>`;
}

// ── Line / Arrow ──────────────────────────────────────────────────────────────
function renderLineLike(el) {
  const pts = (el.points || []).map(([px, py]) => [el.x + px, el.y + py]);
  if (pts.length < 2) return "";

  const col   = stroke(el);
  const width = sw(el);
  const op    = opacity(el);
  const dash  = strokeDash(el);
  const uid   = el.id.replace(/[^a-z0-9]/gi, "_");

  const defs  = [];
  const attrs = [];

  if (el.endArrowhead && el.endArrowhead !== "none") {
    const mid = `m_e_${uid}`;
    defs.push(makeMarker(mid, col));
    attrs.push(`marker-end="url(#${mid})"`);
  }
  if (el.startArrowhead && el.startArrowhead !== "none") {
    const mid = `m_s_${uid}`;
    defs.push(makeMarker(mid, col, true));
    attrs.push(`marker-start="url(#${mid})"`);
  }

  // Build path — use cubic bezier if 4 points (Excalidraw curved arrow format)
  let d;
  if (pts.length === 4 && el.type === "arrow") {
    d = `M ${pts[0][0]} ${pts[0][1]} C ${pts[1][0]} ${pts[1][1]}, ${pts[2][0]} ${pts[2][1]}, ${pts[3][0]} ${pts[3][1]}`;
  } else {
    d = `M ${pts[0][0]} ${pts[0][1]}` + pts.slice(1).map(([x, y]) => ` L ${x} ${y}`).join("");
  }

  const defsStr  = defs.length  ? `<defs>${defs.join("")}</defs>` : "";
  const attrsStr = attrs.length ? " " + attrs.join(" ") : "";
  const pathEl   = `<path d="${d}" fill="none" stroke="${col}" stroke-width="${width}" ` +
                   `stroke-linecap="round" stroke-linejoin="round" opacity="${op}" ${dash}${attrsStr}/>`;

  return defsStr + pathEl;
}

// ── Element renderers ─────────────────────────────────────────────────────────
const renderers = {
  rectangle(el) {
    const rx = cornerRadius(el);
    return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" ` +
           `rx="${rx}" ry="${rx}" fill="${fill(el)}" stroke="${stroke(el)}" ` +
           `stroke-width="${sw(el)}" opacity="${opacity(el)}" ${strokeDash(el)}/>`;
  },

  ellipse(el) {
    const cx = el.x + el.width  / 2;
    const cy = el.y + el.height / 2;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${el.width / 2}" ry="${el.height / 2}" ` +
           `fill="${fill(el)}" stroke="${stroke(el)}" stroke-width="${sw(el)}" ` +
           `opacity="${opacity(el)}" ${strokeDash(el)}/>`;
  },

  diamond(el) {
    const cx = el.x + el.width  / 2;
    const cy = el.y + el.height / 2;
    const pts = `${cx},${el.y} ${el.x + el.width},${cy} ${cx},${el.y + el.height} ${el.x},${cy}`;
    return `<polygon points="${pts}" fill="${fill(el)}" stroke="${stroke(el)}" ` +
           `stroke-width="${sw(el)}" opacity="${opacity(el)}" ${strokeDash(el)}/>`;
  },

  arrow(el)    { return renderLineLike(el); },
  line(el)     { return renderLineLike(el); },

  freedraw(el) {
    if (!el.points?.length) return "";
    const pts = el.points.map(([px, py]) => `${el.x + px},${el.y + py}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${stroke(el)}" ` +
           `stroke-width="${sw(el)}" stroke-linecap="round" stroke-linejoin="round" ` +
           `opacity="${opacity(el)}"/>`;
  },

  text(el) { return renderText(el); },
  image()  { return ""; },   // images require fetching external data — skip
};

// ── Build SVG ─────────────────────────────────────────────────────────────────
const parts = [];

// Non-text first, text on top
const shapes = elements.filter(e => e.type !== "text");
const texts  = elements.filter(e => e.type === "text");

for (const el of [...shapes, ...texts]) {
  const fn = renderers[el.type];
  if (fn) parts.push(fn(el));
}

const svg = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<svg xmlns="http://www.w3.org/2000/svg"`,
  `     viewBox="${vx} ${vy} ${vw} ${vh}"`,
  `     width="${vw * SCALE}" height="${vh * SCALE}">`,
  `  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${bgColor}"/>`,
  ...parts,
  `</svg>`,
].join("\n");

// ── Render PNG ────────────────────────────────────────────────────────────────
async function main() {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    console.error("[excalidraw] sharp not found — run: npm install");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });

  await sharp(Buffer.from(svg))
    .resize(vw * SCALE, vh * SCALE)
    .png()
    .toFile(outputFile);

  console.log(`[excalidraw] rendered ${elements.length} element(s) → ${outputFile} (${vw * SCALE}×${vh * SCALE}px)`);
}

main().catch(err => { console.error("[excalidraw]", err.message); process.exit(1); });
