"use strict";

/**
 * Generates bar chart PNGs via QuickChart.io API (no npm dependencies).
 * Claude Code color palette: dark bg, blue/green/amber bars.
 */

const C = {
  input:  "#58a6ff",   // blue  — input tokens
  output: "#3fb950",   // green — output tokens
  cache:  "#e3b341",   // amber — cache tokens
  text:   "#c9d1d9",   // light gray — labels / title
  dim:    "#8b949e",   // muted gray — axis ticks
  grid:   "#21262d",   // dark grid lines
  border: "#30363d",   // axis border
  bg:     "#0d1117"    // deep dark background
};

// QuickChart evaluates function strings server-side
const TICK_FN =
  "function(v){" +
  "if(v===0)return'0';" +
  "var m=v/1000000;" +
  "if(m>=1)return(m<10?m.toFixed(1):Math.round(m))+'M';" +
  "var k=v/1000;" +
  "if(k>=1)return(k<100?k.toFixed(1):Math.round(k))+'k';" +
  "return Math.round(v);" +
  "}";

function trimLabel(s, max) {
  s = String(s || "unknown")
    .replace(/^gpt-/, "")
    .replace(/^claude-/, "");
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

function buildConfig(labels, groups, title) {
  return {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Input",
          data: groups.map(g => g.input),
          backgroundColor: C.input,
          borderRadius: 3
        },
        {
          label: "Output",
          data: groups.map(g => g.output),
          backgroundColor: C.output,
          borderRadius: 3
        },
        {
          label: "Cache",
          data: groups.map(g => g.cacheRead),
          backgroundColor: C.cache,
          borderRadius: 3
        }
      ]
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: title,
          color: C.text,
          font: { size: 14, weight: "bold" },
          padding: { bottom: 12 }
        },
        legend: {
          position: "top",
          labels: { color: C.text, font: { size: 12 }, padding: 16 }
        }
      },
      scales: {
        x: {
          ticks: { color: C.dim, font: { size: 11 } },
          grid: { color: C.grid },
          border: { color: C.border }
        },
        y: {
          beginAtZero: true,
          ticks: { color: C.dim, font: { size: 11 }, callback: TICK_FN },
          grid: { color: C.grid },
          border: { color: C.border }
        }
      },
      layout: { padding: { top: 4, right: 20, bottom: 4, left: 4 } }
    }
  };
}

async function fetchPng(config) {
  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      width: 800,
      height: 380,
      backgroundColor: C.bg,
      chart: config
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QuickChart ${res.status}: ${text.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function generateWeeklyChart(data) {
  const groups = data.weekly.byModel;
  const labels = groups.map(g => trimLabel(g.model, 16));
  return fetchPng(buildConfig(labels, groups, "Weekly Token Usage"));
}

async function generateDailyChart(data) {
  const groups = data.daily.byModel;
  const labels = groups.map(g => trimLabel(g.model, 16));
  return fetchPng(buildConfig(labels, groups, "Daily Token Usage"));
}

async function generateAgentChart(data) {
  const groups = data.byAgent;
  const labels = groups.map(g => trimLabel(g.agentId, 20));
  return fetchPng(buildConfig(labels, groups, "Daily Usage by Agent"));
}

module.exports = { generateWeeklyChart, generateDailyChart, generateAgentChart };
