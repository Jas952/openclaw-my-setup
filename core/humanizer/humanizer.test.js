"use strict";

const assert = require("node:assert/strict");
const { mergeConfig, shouldProcess, humanizeText, runAdaptiveHumanizer } = require("./core.js");

const baseCfg = mergeConfig({
  minChars: 30,
  minWords: 5,
  minSentences: 2,
  maxEditRatio: 0.9
});

function testStockPhrases() {
  const text = "At the end of the day, it's worth noting that this plan works. In conclusion, we should proceed.";
  const res = humanizeText(text, baseCfg);
  assert.equal(res.changed, true);
  assert.equal(/at the end of the day/i.test(res.text), false);
  assert.equal(/it's worth noting/i.test(res.text), false);
  assert.equal(/in conclusion/i.test(res.text), false);
}

function testEmDashRemoval() {
  const text = "This matters - but also this matters. And this one — too.";
  const res = humanizeText(text, baseCfg);
  assert.equal(res.changed, true);
  assert.equal(/[—–]/.test(res.text), false);
}

function testRuleOfThree() {
  const text = "The design improved speed, stability, and clarity. It worked in production.";
  const res = humanizeText(text, baseCfg);
  assert.equal(res.changed, true);
  assert.equal(/speed, stability, and clarity/i.test(res.text), false);
  assert.equal(/speed and stability, plus clarity/i.test(res.text), true);
}

function testSkipStructured() {
  const cfg = mergeConfig({ ...baseCfg, structuredRatioThreshold: 0.2 });
  const text = "1. First item\n2. Second item\n3. Third item\n\nThis is a short tail sentence.";
  const gate = shouldProcess(text, cfg, { channelId: "telegram", to: "455103738" });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "structured");
}

function testChannelFilter() {
  const cfg = mergeConfig({ ...baseCfg, channels: ["telegram"] });
  const text = "At the end of the day, this is a long enough message. It has two sentences.";
  const gate = shouldProcess(text, cfg, { channelId: "slack", to: "455103738" });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "channel_filtered");
}

function testTargetFilter() {
  const cfg = mergeConfig({ ...baseCfg, targetPeerIds: ["455103738", "-1001774997176"] });
  const text = "At the end of the day, this is a long enough message. It has two sentences.";

  const allowedDm = shouldProcess(text, cfg, { channelId: "telegram", to: "455103738" });
  assert.equal(allowedDm.ok, true);

  const allowedTopic = shouldProcess(text, cfg, { channelId: "telegram", to: "-1001774997176:topic:1" });
  assert.equal(allowedTopic.ok, true);

  const blockedOther = shouldProcess(text, cfg, { channelId: "telegram", to: "-1003713665447:topic:11" });
  assert.equal(blockedOther.ok, false);
  assert.equal(blockedOther.reason, "target_filtered");
}

async function testAdaptiveCompat() {
  const text = "At the end of the day, it is worth noting that this may potentially work. In conclusion, we proceed.";
  const res = await runAdaptiveHumanizer(text, baseCfg);
  assert.equal(res.source, "rules");
  assert.equal(res.changed, true);
  assert.equal(/at the end of the day/i.test(res.text), false);
}

async function run() {
  testStockPhrases();
  testEmDashRemoval();
  testRuleOfThree();
  testSkipStructured();
  testChannelFilter();
  testTargetFilter();
  await testAdaptiveCompat();
  process.stdout.write("humanizer tests: ok\n");
}

run().catch((error) => {
  process.stderr.write(`humanizer tests: failed: ${error.message}\n`);
  process.exit(1);
});
