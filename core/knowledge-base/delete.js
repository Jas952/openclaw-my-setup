#!/usr/bin/env node
"use strict";

/**
 * Delete an entry from the knowledge base by ID.
 *
 * node delete.js <entry-id> [--json]
 *
 * Output (--json): { deleted: true, title, chunks_removed }
 */

const { getSqliteDb, getZvecCollection } = require("./db");

function parseArgs(argv) {
  const args = { id: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    if      (argv[i] === "--json") { args.json = true; }
    else if (!argv[i].startsWith("--")) { args.id = argv[i]; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.id) {
    console.error("Usage: node delete.js <entry-id> [--json]");
    process.exit(1);
  }

  const db    = getSqliteDb();
  const entry = db.prepare("SELECT id, title, chunk_count FROM entries WHERE id = ?").get(args.id);

  if (!entry) {
    if (args.json) { console.log(JSON.stringify({ deleted: false, error: "Entry not found" })); }
    else           { console.error(`Entry not found: ${args.id}`); }
    process.exit(1);
  }

  // Get chunk IDs from SQLite
  const chunkIds = db.prepare("SELECT id FROM chunks WHERE entry_id = ?")
    .all(args.id)
    .map(r => r.id);

  // Remove from zvec
  if (chunkIds.length > 0) {
    const col = getZvecCollection();
    col.deleteSync(chunkIds);
  }

  // Remove from SQLite
  db.prepare("DELETE FROM chunks  WHERE entry_id = ?").run(args.id);
  db.prepare("DELETE FROM entries WHERE id = ?").run(args.id);

  if (args.json) {
    console.log(JSON.stringify({ deleted: true, title: entry.title, chunks_removed: chunkIds.length }));
  } else {
    console.log(`✓ Deleted: "${entry.title}"`);
    console.log(`  Chunks removed: ${chunkIds.length}`);
  }
}

main();
