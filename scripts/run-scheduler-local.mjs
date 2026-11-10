#!/usr/bin/env node
/**
 * LOCAL ONLY. Calls the scheduler route the way a real cron would, against a server on this machine.
 *
 *   CRON_SECRET=... node scripts/run-scheduler-local.mjs [--base http://127.0.0.1:3000] [--every 300]
 *
 * Runs once by default; --every keeps calling at that many seconds. It only asks the app whether
 * anything is due. Whether a call is placed is still up to NAQAH_VOICE_MODE, NAQAH_SCHEDULED_CALLS,
 * NAQAH_CALL_OWNER and the mock or real caller the local server was started with.
 */
function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

const base = option("base", "http://127.0.0.1:3000");
const every = Number(option("every", "0"));
const secret = process.env.CRON_SECRET?.trim();

let url;
try {
  url = new URL("/api/cron/report-calls", base);
} catch {
  fail(`Not a URL: ${base}`);
}
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) fail(`Refusing a server that isn't on this machine: ${url.hostname}`);
if (!secret) fail("CRON_SECRET is required");
if (!Number.isFinite(every) || every < 0) fail("--every must be a number of seconds");

async function tick() {
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60_000) });
    console.log(`${new Date().toISOString()} ${response.status} ${await response.text()}`);
    return response.ok;
  } catch (error) {
    console.error(`${new Date().toISOString()} failed: ${error instanceof Error ? error.message : "unknown"}`);
    return false;
  }
}

if (every === 0) {
  process.exitCode = (await tick()) ? 0 : 1;
} else {
  for (;;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, every * 1000));
  }
}
