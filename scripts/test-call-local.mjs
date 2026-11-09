#!/usr/bin/env node
/**
 * Brings up everything the manual "Test AI Call" needs on this machine, stays in the foreground until Ctrl-C, then stops
 * everything it started. The database is always a disposable local Postgres.
 *
 *   node scripts/test-call-local.mjs                free: fake Twilio and a loopback mock model
 *   node scripts/test-call-local.mjs --live --secrets <file> --public-url https://… --allow +9665XXXXXXXX
 *
 * --live places REAL, CHARGED calls to the allowed numbers. Options: --bridge-port (live, default 3300), --skip-build,
 * --dry-run (print variable names and non-secret values, start nothing).
 * Logs: /tmp/naqah-test-call/logs. Nothing from --secrets is printed or written to disk.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = "/tmp/naqah-test-call";
const LOGS = join(ROOT, "logs");
const PGDATA = join(ROOT, "pg");
const SOCK = join(ROOT, "sock");
const STACK_ENV = join(ROOT, "stack.env");
export const READY_FILE = join(ROOT, "ready.json");
const PG_BIN = "/opt/homebrew/opt/postgresql@17/bin";
const POSTGREST_BIN = "/opt/homebrew/bin/postgrest";
const DB = "naqah_test_call";
const PG_PORT = 54350;
const REST_PORT = 54351;
const GATEWAY_PORT = 54352;
const PROVIDER_PORT = 3313;
export const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
export const PORTS = {
  mock: { next: 3311, bridge: 3310 },
  live: { next: 3301, bridge: 3300 },
};

export const TESTER = { email: "test-call@example.test", password: "local-test-password" };
export const CONTROL = { email: "control-owner@example.test", password: "local-test-password" };
export const TEST_FARM = "11111111-1111-4111-8111-111111111111";
export const CONTROL_FARM = "22222222-2222-4222-8222-222222222222";
export const WORKER_PLACEHOLDER = "+966500000099";

const FAKE_SID = `AC${"0".repeat(32)}`;
const FAKE_TOKEN = "local-test-auth-token";
export const MOCK_PUBLIC_BASE = "https://naqah-test-call.example.test";
export const MOCK_ALLOWED = ["+966500000001", "+966500000002", "+15555550199"];
export const REPORT_PATH_WORKER = "+966500000010";

const SECRET_NAMES = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "OPENAI_API_KEY", "NAQAH_VOICE_SECRET"];
/** Never present in a live environment: these turn on unattended or owner-facing calls. */
export const FORBIDDEN_LIVE = ["CRON_SECRET", "NAQAH_SCHEDULED_CALLS", "NAQAH_MANUAL_REPORT_CALLS", "NAQAH_CALL_OWNER"];
const MASKED = new Set([...SECRET_NAMES.filter((name) => name !== "TWILIO_PHONE_NUMBER"), "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
const LOOPBACK_HOST = /^(localhost|127(\.\d+){3}|\[::1\]|::1)$/;
const SAUDI_MOBILE = /^\+9665\d{8}$/;

export class UsageError extends Error {}

/* ─────────────────── arguments and environment (pure, unit tested) ─────────────────── */

export function parseArgs(argv) {
  const options = { mode: null, secrets: null, publicUrl: null, allow: [], bridgePort: null, dryRun: false, skipBuild: false, reportPath: false };
  const takeValue = (index, name) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${name} needs a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--mock" || name === "--live") {
      const mode = name.slice(2);
      if (options.mode && options.mode !== mode) throw new UsageError("Choose either --mock or --live");
      options.mode = mode;
    } else if (name === "--dry-run") options.dryRun = true;
    else if (name === "--skip-build") options.skipBuild = true;
    else if (name === "--report-path") options.reportPath = true;
    else if (name === "--secrets") { options.secrets = takeValue(index, name); index += 1; }
    else if (name === "--public-url") { options.publicUrl = takeValue(index, name); index += 1; }
    else if (name === "--allow") { options.allow.push(...takeValue(index, name).split(",").map((item) => item.trim())); index += 1; }
    else if (name === "--bridge-port") {
      const port = Number(takeValue(index, name));
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError("--bridge-port must be a port number");
      options.bridgePort = port;
      index += 1;
    } else throw new UsageError(`Unknown option: ${name}`);
  }
  options.mode ??= "mock";

  if (options.mode === "mock") {
    for (const [given, name] of [[options.secrets, "--secrets"], [options.publicUrl, "--public-url"], [options.allow.length || null, "--allow"], [options.bridgePort, "--bridge-port"]]) {
      if (given !== null) throw new UsageError(`${name} is for --live only`);
    }
    return options;
  }

  if (options.reportPath) throw new UsageError("--report-path is for --mock only");
  if (!options.secrets) throw new UsageError("--live needs --secrets <file>");
  if (!options.publicUrl) throw new UsageError("--live needs --public-url https://…");
  if (!options.allow.length) throw new UsageError("--live needs --allow +9665XXXXXXXX");
  options.publicUrl = validatePublicUrl(options.publicUrl);
  options.allow = options.allow.map((number) => {
    if (!SAUDI_MOBILE.test(number)) throw new UsageError(`--allow takes exact Saudi mobiles such as +9665XXXXXXXX, not ${number}`);
    return number;
  });
  options.allow = [...new Set(options.allow)];
  options.bridgePort ??= PORTS.live.bridge;
  if (options.bridgePort === PORTS.live.next) throw new UsageError(`--bridge-port cannot be ${PORTS.live.next}: Next uses it`);
  return options;
}

export function validatePublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new UsageError("--public-url must be a full https:// URL"); }
  if (url.protocol !== "https:") throw new UsageError("--public-url must use https://");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new UsageError("--public-url must be an origin only, with no path, query or credentials");
  if (LOOPBACK_HOST.test(url.hostname)) throw new UsageError("--public-url must be reachable by Twilio, not a loopback address");
  return url.origin;
}

/** Only the five named variables are kept. Errors name a variable and never quote a value. */
export function parseSecrets(text) {
  const found = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || !SECRET_NAMES.includes(match[1])) continue;
    let value = match[2].trim();
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : null;
    if (quote) {
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : "";
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    found[match[1]] = value;
  }
  for (const name of SECRET_NAMES) {
    if (!found[name]) throw new UsageError(`The secrets file has no value for ${name}`);
  }
  if (!/^AC[0-9a-fA-F]{32}$/.test(found.TWILIO_ACCOUNT_SID)) throw new UsageError("TWILIO_ACCOUNT_SID in the secrets file is not a Twilio account SID");
  if (!/^\+[1-9]\d{7,14}$/.test(found.TWILIO_PHONE_NUMBER)) throw new UsageError("TWILIO_PHONE_NUMBER in the secrets file is not an E.164 number");
  if (found.TWILIO_ACCOUNT_SID === FAKE_SID || found.TWILIO_AUTH_TOKEN === FAKE_TOKEN) throw new UsageError("The secrets file holds the fake local credentials: --live needs real ones");
  return found;
}

/** Inherited settings never reach a child, so a stray shell export can't point a call at a real project. */
export function cleanBaseEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^(NAQAH_|TWILIO_|SUPABASE|NEXT_PUBLIC_|CRON_|PG|OPENAI|NODE_OPTIONS$|NODE_ENV$)/.test(key)));
}

export function assertLoopbackUrl(raw, label) {
  let host;
  try { host = new URL(raw).hostname; } catch { throw new Error(`${label} is not a URL`); }
  if (!LOOPBACK_HOST.test(host)) throw new Error(`Refusing non-loopback ${label}: ${host}`);
}

const accountFlags = { NEXT_PUBLIC_NAQAH_ACCOUNT_DATA: "1", NEXT_PUBLIC_NAQAH_TEST_CALL: "1" };

/** The environment for each child. `stack` holds the keys from the local stack, `secrets` is only set for --live. */
export function buildEnvironments(options, stack, secrets = null) {
  assertLoopbackUrl(stack.NEXT_PUBLIC_SUPABASE_URL, "Supabase URL");
  const live = options.mode === "live";
  const ports = live ? { next: PORTS.live.next, bridge: options.bridgePort } : PORTS.mock;
  const publicBase = live ? options.publicUrl : MOCK_PUBLIC_BASE;
  const bridgePublic = `wss://${new URL(publicBase).host}/voice-bridge/media`;
  const upstream = `http://127.0.0.1:${ports.next}`;
  const credentials = live
    ? { TWILIO_ACCOUNT_SID: secrets.TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN: secrets.TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER: secrets.TWILIO_PHONE_NUMBER, NAQAH_VOICE_SECRET: secrets.NAQAH_VOICE_SECRET }
    : { TWILIO_ACCOUNT_SID: FAKE_SID, TWILIO_AUTH_TOKEN: FAKE_TOKEN, TWILIO_PHONE_NUMBER: "+15555550100", NAQAH_VOICE_SECRET: "local-only-voice-secret-for-test-call" };
  const allowlist = live ? options.allow : [...MOCK_ALLOWED, ...(options.reportPath ? [REPORT_PATH_WORKER] : [])];

  const next = {
    ...stack, ...accountFlags, ...credentials,
    NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    NAQAH_TEST_CALLS: "1", NAQAH_TEST_CALL_ADMINS: TESTER.email, NAQAH_CALL_ALLOWLIST: allowlist.join(","),
    NAQAH_VOICE_MODE: "farm", NAQAH_VOICE_LOCALE: "ar", NAQAH_VOICE_ENGINE: "realtime",
    NAQAH_BRIDGE_PUBLIC_URL: bridgePublic, NAQAH_PUBLIC_BASE_URL: publicBase,
  };
  const bridge = {
    NODE_ENV: "production", PORT: String(ports.bridge),
    NAQAH_BRIDGE_PUBLIC_URL: bridgePublic, NAQAH_BRIDGE_UPSTREAM: upstream,
    NAQAH_VOICE_SECRET: credentials.NAQAH_VOICE_SECRET, TWILIO_AUTH_TOKEN: credentials.TWILIO_AUTH_TOKEN,
    OPENAI_API_KEY: live ? secrets.OPENAI_API_KEY : "local-test-key",
  };
  if (!live) {
    next.NODE_OPTIONS = `--import=${join(REPO, "supabase/local-validation/mock-outbound.mjs")}`;
    next.NAQAH_TEST_OUTBOUND_GATEWAY = `http://127.0.0.1:${PROVIDER_PORT}/`;
    if (options.reportPath) next.NAQAH_MANUAL_REPORT_CALLS = "1";
    bridge.NODE_OPTIONS = `--import=${join(REPO, "scripts/mocks/loopback-guard.mjs")}`;
    bridge.NAQAH_REALTIME_URL = `ws://127.0.0.1:${PROVIDER_PORT}/v1/realtime`;
  }
  const browserStack = { ...stack };
  delete browserStack.SUPABASE_SECRET_KEY;
  return { build: { ...browserStack, ...accountFlags, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" }, next, bridge, ports, publicBase };
}

export function describeEnvironment(name, env) {
  const lines = Object.keys(env).sort().map((key) => `  ${key}=${MASKED.has(key) ? "<set, hidden>" : env[key]}`);
  return `${name}:\n${lines.join("\n")}`;
}

/** Next loads .env* on top of what it is given, which could switch on scheduled calls or a hosted project. */
export function strayEnvFiles(dir = REPO) {
  return readdirSync(dir).filter((name) => name.startsWith(".env") && name !== ".env.example");
}

/** The process listening on a port, as "node (pid 123)", or null when the port is free. */
export function portHolder(port) {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { encoding: "utf8" });
  const pid = result.stdout?.match(/^p(\d+)/m)?.[1];
  if (!pid) return null;
  return `${result.stdout.match(/^c(.+)$/m)?.[1] ?? "unknown"} (pid ${pid})`;
}

/* ─────────────────── process control ─────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = new Map();
let stopping = false;

function background(name, command, args, env, cwd = REPO) {
  const out = openSync(join(LOGS, `${name}.log`), "a");
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", out, out], detached: true });
  closeSync(out);
  children.set(name, child);
  return child;
}

const portOpen = (port) => new Promise((resolve) => {
  const socket = tcpConnect(port, "127.0.0.1");
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

async function waitFor(probe, what, tries = 240) {
  for (let index = 0; index < tries; index += 1) {
    try { if (await probe()) return; } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const pgEnv = (base) => ({ ...base, PATH: `${PG_BIN}:${base.PATH}`, LC_ALL: "en_US.UTF-8", PGHOST: "127.0.0.1", PGPORT: String(PG_PORT), PGUSER: "postgres" });

function startPostgres(base) {
  rmSync(PGDATA, { recursive: true, force: true });
  mkdirSync(SOCK, { recursive: true });
  execFileSync(join(PG_BIN, "initdb"), ["-D", PGDATA, "-U", "postgres", "--auth=trust", "-E", "UTF8"], { env: pgEnv(base), stdio: "ignore" });
  execFileSync(join(PG_BIN, "pg_ctl"), ["-D", PGDATA, "-w", "-l", join(LOGS, "postgres.log"), "-o", `-p ${PG_PORT} -h 127.0.0.1 -k ${SOCK} -c fsync=off`, "start"], { env: pgEnv(base), stdio: "ignore" });
}

function stopPostgres(base) {
  if (!existsSync(PGDATA)) return;
  try { execFileSync(join(PG_BIN, "pg_ctl"), ["-D", PGDATA, "-m", "fast", "-w", "stop"], { env: pgEnv(base), stdio: "ignore" }); } catch { /* already stopped */ }
  rmSync(PGDATA, { recursive: true, force: true });
}

async function stopChildren() {
  await Promise.all([...children.entries()].map(async ([, child]) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
    await Promise.race([exited, sleep(4000)]);
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
  }));
  children.clear();
}

async function createUser(account) {
  const response = await fetch(`${GATEWAY}/__test/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(account) });
  if (response.status !== 201) throw new Error(`Could not create the local user ${account.email}: ${response.status}`);
  return (await response.json()).id;
}

function seed(base, testerId, controlId) {
  const env = pgEnv(base);
  const psql = join(PG_BIN, "psql");
  const address = execFileSync(psql, ["-X", "-q", "-A", "-t", "-d", DB, "-c", "select inet_server_addr()::text"], { env, encoding: "utf8" }).trim();
  if (!/^(127\.|::1)/.test(address)) throw new Error(`Refusing to seed a non-local database (${address})`);
  execFileSync(psql, ["-X", "-q", "-d", DB, "-v", `tester_id=${testerId}`, "-v", `control_id=${controlId}`, "-f", join(REPO, "supabase/local-validation/test_call_seed.sql")], { env, stdio: ["ignore", "ignore", "inherit"] });
}

const localSql = (base) => (query) => execFileSync(join(PG_BIN, "psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", DB], { input: query, encoding: "utf8", env: pgEnv(base), maxBuffer: 1 << 26 }).trim();

/* ─────────────────── main ─────────────────── */

function refuseBusyPorts(options, ports) {
  const needed = [PG_PORT, REST_PORT, GATEWAY_PORT, ports.next, ports.bridge, ...(options.mode === "mock" ? [PROVIDER_PORT] : [])];
  const busy = needed.flatMap((port) => {
    const holder = portHolder(port);
    return holder ? [`port ${port} is held by ${holder}`] : [];
  });
  if (busy.length) throw new UsageError(`Refusing to start: ${busy.join("; ")}. Stop it or choose another port; this runner never stops a process it did not start.`);
}

function printLiveWarning(options, ports) {
  console.log(`
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  LIVE MODE: pressing "Test AI Call" places a REAL, CHARGED phone call
  through Twilio and OpenAI to: ${options.allow.join(", ")}
  Public address: ${options.publicUrl} (must tunnel to bridge port ${ports.bridge})
  The database is local. Scheduled calls and owner calls stay off.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
`);
}

function dryRun(options) {
  const placeholderStack = { NEXT_PUBLIC_SUPABASE_URL: GATEWAY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "<local>", SUPABASE_SECRET_KEY: "<local>" };
  const secrets = options.mode === "live" ? parseSecrets(readFileSync(options.secrets, "utf8")) : null;
  const envs = buildEnvironments(options, placeholderStack, secrets);
  if (options.mode === "live") printLiveWarning(options, envs.ports);
  console.log(`DRY RUN (${options.mode}). Nothing was started.\n`);
  console.log(describeEnvironment("build", envs.build));
  console.log(describeEnvironment("next", envs.next));
  console.log(describeEnvironment("bridge", envs.bridge));
  const stray = strayEnvFiles();
  if (stray.length) console.log(`\nA real start would refuse: ${stray.join(", ")} would be loaded by Next.`);
  for (const [label, port] of [["next", envs.ports.next], ["bridge", envs.ports.bridge]]) {
    const holder = portHolder(port);
    if (holder) console.log(`\nA real start would refuse: ${label} port ${port} is held by ${holder}.`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun) return dryRun(options);

  const stray = strayEnvFiles();
  if (stray.length) throw new UsageError(`Refusing to start: ${stray.join(", ")} would be loaded by Next and could add hosted or scheduling settings. Run from a checkout without them.`);
  const secrets = options.mode === "live" ? parseSecrets(readFileSync(options.secrets, "utf8")) : null;
  const ports = options.mode === "live" ? { next: PORTS.live.next, bridge: options.bridgePort } : PORTS.mock;
  refuseBusyPorts(options, ports);
  for (const tool of [join(PG_BIN, "initdb"), POSTGREST_BIN]) {
    if (!existsSync(tool)) throw new UsageError(`Missing ${tool}`);
  }
  if (options.mode === "live") printLiveWarning(options, ports);

  rmSync(READY_FILE, { force: true });
  mkdirSync(LOGS, { recursive: true });
  const base = cleanBaseEnv();
  let mock = null;

  const shutdown = async (code) => {
    if (stopping) return;
    stopping = true;
    console.log("\nStopping everything this runner started…");
    rmSync(READY_FILE, { force: true });
    await mock?.close().catch(() => {});
    await stopChildren();
    stopPostgres(base);
    console.log("Stopped.");
    process.exit(code);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => shutdown(0));

  try {
    console.log("Starting the disposable database and local stack…");
    startPostgres(base);
    const stackChild = background("stack", "sh", [join(REPO, "supabase/local-validation/run-stack.sh"), STACK_ENV], {
      ...pgEnv(base), NAQAH_TEST_DB: DB, NAQAH_TEST_REST_PORT: String(REST_PORT), NAQAH_TEST_GATEWAY_PORT: String(GATEWAY_PORT), POSTGREST_BIN,
    });
    await waitFor(() => {
      if (stackChild.exitCode !== null) throw new UsageError(`The local stack exited early; see ${LOGS}/stack.log`);
      return existsSync(STACK_ENV);
    }, "the local stack", 480).catch((error) => { if (error instanceof UsageError) throw error; throw new Error(`${error.message}; see ${LOGS}/stack.log`); });
    const stack = Object.fromEntries([...readFileSync(STACK_ENV, "utf8").matchAll(/export (\w+)='([^']*)'/g)].map((match) => [match[1], match[2]]));
    const envs = buildEnvironments(options, stack, secrets);

    console.log("Creating local accounts and sample ranches…");
    const testerId = await createUser(TESTER);
    const controlId = await createUser(CONTROL);
    seed(base, testerId, controlId);

    if (options.skipBuild && existsSync(join(REPO, ".next/BUILD_ID"))) {
      console.log("Using the existing build (--skip-build).");
    } else {
      console.log("Building (about a minute)…");
      const buildLog = openSync(join(LOGS, "build.log"), "w");
      const built = spawnSync("npm", ["run", "build"], { cwd: REPO, env: { ...base, ...envs.build }, stdio: ["ignore", buildLog, buildLog] });
      closeSync(buildLog);
      if (built.status !== 0) throw new Error(`The build failed; see ${LOGS}/build.log`);
    }

    if (options.mode === "mock") {
      const { startTestCallMock } = await import("./mocks/test-call-twilio.mjs");
      mock = await startTestCallMock({ port: PROVIDER_PORT, appOrigin: `http://127.0.0.1:${envs.ports.next}`, publicBase: envs.publicBase, bridgePort: envs.ports.bridge, sql: localSql(base) });
    }

    console.log("Starting Next and the voice bridge…");
    const nextChild = background("next", join(REPO, "node_modules/.bin/next"), ["start", "-p", String(envs.ports.next), "-H", "127.0.0.1"], { ...base, ...envs.next });
    const bridgeChild = background("bridge", process.execPath, [join(REPO, "services/voice-bridge/index.mjs")], { ...base, ...envs.bridge }, join(REPO, "services/voice-bridge"));
    for (const [name, child] of [["Next", nextChild], ["The voice bridge", bridgeChild], ["The local stack", stackChild]]) {
      child.once("exit", () => {
        if (stopping) return;
        console.error(`${name} stopped unexpectedly; see ${LOGS}.`);
        shutdown(1);
      });
    }
    await waitFor(async () => (await fetch(`http://127.0.0.1:${envs.ports.next}/api/cron/report-calls`)).status > 0, "Next", 240);
    await waitFor(() => portOpen(envs.ports.bridge), "the voice bridge", 80);

    const url = `http://127.0.0.1:${envs.ports.next}/ar/app/lab`;
    writeFileSync(READY_FILE, JSON.stringify({ mode: options.mode, app: `http://127.0.0.1:${envs.ports.next}`, bridge: envs.ports.bridge, provider: options.mode === "mock" ? `http://127.0.0.1:${PROVIDER_PORT}` : null, tester: TESTER, testerId, controlId }));

    console.log(`
Ready (${options.mode === "mock" ? "MOCK: no real call, Twilio and OpenAI are never contacted" : "LIVE: calls are real and charged"}).

  Open:      ${url}
  Sign in:   ${TESTER.email}
  Password:  ${TESTER.password}   (local-only test account)
  Numbers:   ${(options.mode === "mock" ? MOCK_ALLOWED.filter((number) => number.startsWith("+966")) : options.allow).join(", ")}
  Logs:      ${LOGS}
${options.mode === "mock" ? "\n  A mock proves the wiring only. It says nothing about the real model's Arabic or real telephony.\n" : ""}
Press Ctrl-C to stop everything.`);
    await new Promise(() => {});
  } catch (error) {
    console.error(`\n${error.message}`);
    await shutdown(error instanceof UsageError ? 2 : 1);
  }
  return undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(error instanceof UsageError ? 2 : 1);
  });
}
