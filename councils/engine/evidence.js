"use strict";

function normalizeEvidenceRef(ref) {
  const raw = String(ref || "").trim();
  if (!raw) return null;

  const m = raw.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (m) {
    return {
      path: m[1],
      line: Number(m[2]),
      column: m[3] ? Number(m[3]) : 1,
      link: `${m[1]}:${m[2]}`
    };
  }

  return {
    path: raw,
    line: 1,
    column: 1,
    link: `${raw}:1`
  };
}

function normalizeEvidenceList(value) {
  const raw = String(value || "");
  return raw
    .split(";")
    .map((x) => normalizeEvidenceRef(x))
    .filter(Boolean)
    .slice(0, 20);
}

module.exports = {
  normalizeEvidenceRef,
  normalizeEvidenceList
};
