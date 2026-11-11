#!/usr/bin/env node
/**
 * LOCAL TEST ONLY. Approves a number for the running local stack's «اتصال حقيقي», or lists or removes approvals.
 * The app reads the list on every call, so nothing restarts. Only approve a number whose owner agreed to a test call.
 *
 *   node scripts/demo/approve-number.mjs                     list
 *   node scripts/demo/approve-number.mjs +9665XXXXXXXX       approve
 *   node scripts/demo/approve-number.mjs --remove +9665XXXXXXXX
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { APPROVED_FILE } from "../test-call-local.mjs";

const SAUDI_MOBILE = /^\+9665\d{8}$/;
const mask = (number) => number.slice(0, 6) + "•••••" + number.slice(-3);
const current = existsSync(APPROVED_FILE) ? readFileSync(APPROVED_FILE, "utf8").split("\n").map((line) => line.trim()).filter((line) => SAUDI_MOBILE.test(line)) : [];
const remove = process.argv[2] === "--remove";
const number = (remove ? process.argv[3] : process.argv[2])?.replace(/[\s-]/g, "");
if (number !== undefined && !SAUDI_MOBILE.test(number)) {
  console.error("Use an exact Saudi mobile such as +9665XXXXXXXX.");
  process.exit(2);
}
const next = number === undefined ? current : remove ? current.filter((item) => item !== number) : [...new Set([...current, number])];
if (number !== undefined) writeFileSync(APPROVED_FILE, next.join("\n") + (next.length ? "\n" : ""), { mode: 0o600 });
console.log(next.length ? `Approved for local test calls: ${next.map(mask).join(", ")}` : "No number is approved: «اتصال حقيقي» will not dial.");
