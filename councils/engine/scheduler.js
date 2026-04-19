"use strict";

function shouldRunByCadence(cadence, now = new Date()) {
  if (!cadence) return true;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Moscow", hour: "2-digit", hour12: false }).format(now));

  if (cadence === "nightly") return hour >= 1 && hour <= 6;
  if (cadence === "daily") return true;
  if (cadence === "weekly") return now.getUTCDay() === 0;
  if (cadence === "monthly") return now.getUTCDate() === 1;

  return true;
}

module.exports = {
  shouldRunByCadence
};
