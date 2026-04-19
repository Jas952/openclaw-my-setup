#!/usr/bin/env node
"use strict";

/**
 * List all entries in the knowledge base.
 *
 * node list.js [--tags tag1,tag2] [--json]
 *
 * Output (--json): [{ id, title, source, type, tags, chunk_count, created_at }]
 */

const { getSqliteDb } = require("./db");

function parseArgs(argv) {
  const args = { tags: [], json: false };
  for (let i = 2; i < argv.length; i++) {
    if      (argv[i] === "--tags" && argv[i + 1]) { args.tags = argv[++i].split(",").map(s => s.trim()); }
    else if (argv[i] === "--json")                { args.json = true; }
  }
  return args;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function main() {
  const args = parseArgs(process.argv);
  const db   = getSqliteDb();

  let rows;
  if (args.tags && args.tags.length > 0) {
    const conditions = args.tags.map(() => "tags LIKE ?").join(" OR ");
    const params     = args.tags.map(t => `%${t}%`);
    rows = db.prepare(
      `SELECT id, title, source, type, tags, chunk_count, created_at FROM entries WHERE ${conditions} ORDER BY created_at DESC`
    ).all(...params);
  } else {
    rows = db.prepare(
      "SELECT id, title, source, type, tags, chunk_count, created_at FROM entries ORDER BY created_at DESC"
    ).all();
  }

  if (args.json) {
    const out = rows.map(r => ({ ...r, tags: JSON.parse(r.tags || "[]") }));
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  if (rows.length === 0) {
    console.log("Knowledge base is empty.");
    process.exit(0);
  }

  const stats = db.prepare("SELECT COALESCE(SUM(chunk_count), 0) AS docCount FROM entries").get();

  console.log(`Knowledge Base — ${rows.length} entr${rows.length === 1 ? "y" : "ies"}, ${stats.docCount} total chunks\n`);

  for (let i = 0; i < rows.length; i++) {
    const r    = rows[i];
    const tags = JSON.parse(r.tags || "[]").join(", ") || "none";
    console.log(`${i + 1}. ${r.title} [${r.chunk_count} chunks · ${r.type}]`);
    console.log(`   ID:      ${r.id}`);
    console.log(`   Source:  ${r.source}`);
    console.log(`   Tags:    ${tags}`);
    console.log(`   Added:   ${fmtDate(r.created_at)}`);
    console.log();
  }
}

main();
