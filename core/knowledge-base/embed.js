"use strict";

// Uses @huggingface/transformers (ESM) via dynamic import from CJS
// Model: Xenova/multilingual-e5-small — 384-dim, ~117MB, multilingual (RU/EN/etc.)
// multilingual-e5 requires prefixes: "query: " for search, "passage: " for documents

let _embedder = null;

async function getEmbedder() {
  if (_embedder) return _embedder;

  const { pipeline, env } = await import("@huggingface/transformers");

  env.useBrowserCache = false;

  _embedder = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", {
    dtype: "fp32",
  });

  return _embedder;
}

async function _run(text) {
  const pipe   = await getEmbedder();
  const result = await pipe(text.slice(0, 2000), { pooling: "mean", normalize: true });
  return Array.from(result.data);
}

// For indexing document chunks — add "passage: " prefix
async function embedPassage(text) {
  return _run("passage: " + text);
}

// For search queries — add "query: " prefix
async function embedQuery(text) {
  return _run("query: " + text);
}

module.exports = { embedPassage, embedQuery };
