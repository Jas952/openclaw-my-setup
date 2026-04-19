#!/usr/bin/env node
"use strict";

/**
 * Query the knowledge base with natural language.
 *
 * node query.js "what is X?" [--limit 5] [--tags tag1,tag2] [--json]
 *
 * Output (--json): [{ score, title, source, tags, chunk_text }]
 */

const { withZvecReadOnly }        = require("./db");
const { embedQuery }        = require("./embed");

function parseArgs(argv) {
  const args = { query: null, limit: 5, tags: [], json: false };
  for (let i = 2; i < argv.length; i++) {
    if      (argv[i] === "--limit" && argv[i + 1]) { args.limit = parseInt(argv[++i], 10); }
    else if (argv[i] === "--tags"  && argv[i + 1]) { args.tags  = argv[++i].split(",").map(s => s.trim()); }
    else if (argv[i] === "--json")                 { args.json  = true; }
    else if (!argv[i].startsWith("--"))            { args.query = argv[i]; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.query) {
    console.error('Usage: node query.js "your question" [--limit N] [--tags tag1,tag2] [--json]');
    process.exit(1);
  }

  const queryEmbedding = await embedQuery(args.query);

  let filter;
  if (args.tags && args.tags.length > 0) {
    filter = args.tags.map(t => `tags like "%${t}%"`).join(" or ");
  }

  const queryParams = {
    fieldName:    "embedding",
    vector:       queryEmbedding,
    topk:         args.limit,
    outputFields: ["entry_id", "title", "source", "chunk_text", "tags"],
  };
  if (filter) queryParams.filter = filter;

  const results = (await withZvecReadOnly(async (col) => col.querySync(queryParams))) || [];

  if (results.length === 0) {
    if (args.json) { console.log("[]"); }
    else           { console.log("No results found."); }
    return;
  }

  // zvec COSINE metric returns distance (lower = more similar); convert to similarity %
  const toSim = dist => parseFloat(((1 - dist) * 100).toFixed(1));

  if (args.json) {
    const out = results.map(r => ({
      similarity: toSim(r.score),
      title:      r.fields.title,
      source:     r.fields.source,
      tags:       JSON.parse(r.fields.tags || "[]"),
      chunk_text: r.fields.chunk_text,
    }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`Results for: "${args.query}"\n`);
  for (let i = 0; i < results.length; i++) {
    const r     = results[i];
    const score = toSim(r.score);
    const tags  = JSON.parse(r.fields.tags || "[]").join(", ") || "none";
    const text  = r.fields.chunk_text.slice(0, 400);

    console.log(`${i + 1}. [${score}% match] ${r.fields.title}`);
    console.log(`   Source: ${r.fields.source}`);
    console.log(`   Tags:   ${tags}`);
    console.log(`   ---`);
    console.log(`   ${text}${r.fields.chunk_text.length > 400 ? "..." : ""}`);
    console.log();
  }
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
