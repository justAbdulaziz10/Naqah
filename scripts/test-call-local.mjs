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
 * --owner-call-now (LOCAL DEMO ONLY, needs --repeat-demo-reports; live also needs --dashboard-call): the presentation
 *   ranch's Dashboard gets «العامل / المالك» above «اتصال حقيقي». «المالك» calls the ranch's saved owner number now with the
 *   briefing (instructions per plan). With --owner-approves the owner approves their own number in Settings, with the
 *   same confirmation and agreement as a worker number. Approved numbers, one call at a time and the call cap apply;
 *   scheduled owner calls (NAQAH_CALL_OWNER) stay off.
 * Logs: /tmp/naqah-test-call/logs. Nothing from --secrets is printed or written to disk.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcpConnect } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
/**
 * NAQAH_TEST_CALL_ISOLATED=1: a second, separate stack (its own folder and ports +100) for mock checks, so they
 * never touch the running demo's kept database.
 */
const ISOLATED = /^[1-5]$/.test(process.env.NAQAH_TEST_CALL_ISOLATED ?? "") ? Number(process.env.NAQAH_TEST_CALL_ISOLATED) : 0;
const SHIFT = ISOLATED * 100;
export const ROOT = ISOLATED === 0 ? "/tmp/naqah-test-call" : ISOLATED === 1 ? "/tmp/naqah-test-call-iso" : `/tmp/naqah-test-call-iso${ISOLATED}`;
const LOGS = join(ROOT, "logs");
const PGDATA = join(ROOT, "pg");
/** Approved numbers, read by the app on every call: approving one needs no restart (see scripts/demo/approve-number.mjs). */
export const APPROVED_FILE = join(ROOT, "approved-numbers.txt");
const SOCK = join(ROOT, "sock");
const STACK_ENV = join(ROOT, "stack.env");
export const READY_FILE = join(ROOT, "ready.json");
const PG_BIN = "/opt/homebrew/opt/postgresql@17/bin";
const POSTGREST_BIN = "/opt/homebrew/bin/postgrest";
const DB = "naqah_test_call";
export const PG_PORT = 54350 + SHIFT;
const REST_PORT = 54351 + SHIFT;
const GATEWAY_PORT = 54352 + SHIFT;
const PROVIDER_PORT = 3313 + SHIFT;
export const GATEWAY = `http://127.0.0.1:${GATEWAY_PORT}`;
export const PORTS = {
  mock: { next: 3311 + SHIFT, bridge: 3310 + SHIFT },
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
const IPV4_FIRST = "--dns-result-order=ipv4first";

export class UsageError extends Error {}

/* ─────────────────── arguments and environment (pure, unit tested) ─────────────────── */

export function parseArgs(argv) {
  const options = { mode: null, secrets: null, publicUrl: null, allow: [], bridgePort: null, dryRun: false, skipBuild: false, reportPath: false, dashboardCall: false, traceTranscripts: false, resetReport: false };
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
    else if (name === "--dashboard-call") options.dashboardCall = true;
    else if (name === "--trace-transcripts") options.traceTranscripts = true;
    else if (name === "--reset-report") options.resetReport = true;
    else if (name === "--natural") options.natural = true;
    else if (name === "--keep-data") options.keepData = true;
    else if (name === "--owner-approves") options.ownerApproves = true;
    else if (name === "--repeat-demo-reports") options.repeatDemoReports = true;
    else if (name === "--no-demo-call-limit") options.noDemoCallLimit = true;
    else if (name === "--demo-autofill") options.demoAutofill = true;
    else if (name === "--owner-call-now") options.ownerCallNow = true;
    else if (name === "--voice") {
      options.voice = takeValue(index, name);
      if (!/^(marin|cedar|alloy|ash|ballad|coral|echo|sage|shimmer|verse)$/.test(options.voice)) throw new UsageError("--voice takes a realtime voice such as marin or cedar");
      index += 1;
    }
    else if (name === "--max-call-seconds") {
      options.maxCallSeconds = takeValue(index, name);
      if (!/^\d{2,4}$/.test(options.maxCallSeconds)) throw new UsageError("--max-call-seconds needs a number of seconds");
      index += 1;
    }
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
  if (options.resetReport) {
    if (argv.length !== 1) throw new UsageError("--reset-report must be used on its own");
    return options;
  }

  if (options.ownerCallNow && !options.repeatDemoReports) throw new UsageError("--owner-call-now needs --repeat-demo-reports: it is for the presentation ranch only");
  if (options.mode === "mock") {
    for (const [given, name] of [[options.secrets, "--secrets"], [options.publicUrl, "--public-url"], [options.allow.length || null, "--allow"], [options.bridgePort, "--bridge-port"], [options.dashboardCall || null, "--dashboard-call"]]) {
      if (given !== null) throw new UsageError(`${name} is for --live only`);
    }
    return options;
  }

  if (options.reportPath) throw new UsageError("--report-path is for --mock only");
  if (!options.secrets) throw new UsageError("--live needs --secrets <file>");
  if (!options.publicUrl) throw new UsageError("--live needs --public-url https://…");
  // --owner-approves: the owner approves numbers in Settings (with the recipient's agreement), so none is required here.
  if (!options.allow.length && !options.ownerApproves) throw new UsageError("--live needs --allow +9665XXXXXXXX (or --owner-approves)");
  options.publicUrl = validatePublicUrl(options.publicUrl);
  options.allow = options.allow.map((number) => {
    if (!SAUDI_MOBILE.test(number)) throw new UsageError(`--allow takes exact Saudi mobiles such as +9665XXXXXXXX, not ${number}`);
    return number;
  });
  options.allow = [...new Set(options.allow)];
  if (options.ownerCallNow && !options.dashboardCall) throw new UsageError("--owner-call-now needs --dashboard-call");
  if (options.dashboardCall && options.allow.length < 1 && !options.ownerApproves) throw new UsageError("--dashboard-call needs at least one --allow number, or --owner-approves");
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
    ...(live || options.ownerApproves ? { NAQAH_CALL_ALLOWLIST_FILE: APPROVED_FILE } : {}),
    ...(options.ownerApproves ? { NAQAH_OWNER_APPROVES_TEST_NUMBERS: "1" } : {}),
    NAQAH_BRIDGE_PUBLIC_URL: bridgePublic, NAQAH_PUBLIC_BASE_URL: publicBase,
  };
  if (options.maxCallSeconds) next.NAQAH_CALL_TIME_LIMIT_SECONDS = options.maxCallSeconds;
  // The owner's «اتصال حقيقي» on the Dashboard. Scheduling and owner calls stay off; the allowlist,
  // per-ranch rate limits, 300-second cap and no-retry rule of manual calls all still apply.
  if (live && options.dashboardCall) next.NAQAH_MANUAL_REPORT_CALLS = "1";
  if (options.traceTranscripts) next.NAQAH_CALL_TRACE_DIR = join(tmpdir(), "naqah-call-transcripts");
  const bridge = {
    NODE_ENV: "production", PORT: String(ports.bridge),
    NAQAH_BRIDGE_PUBLIC_URL: bridgePublic, NAQAH_BRIDGE_UPSTREAM: upstream,
    NAQAH_VOICE_SECRET: credentials.NAQAH_VOICE_SECRET, TWILIO_AUTH_TOKEN: credentials.TWILIO_AUTH_TOKEN,
    OPENAI_API_KEY: live ? secrets.OPENAI_API_KEY : "local-test-key",
  };
  if (options.maxCallSeconds) bridge.NAQAH_CALL_TIME_LIMIT_SECONDS = options.maxCallSeconds;
  if (options.voice) bridge.NAQAH_REALTIME_VOICE = options.voice;
  // One natural conversation, no keypad: local presentation runs only.
  if (options.natural) next.NAQAH_VOICE_STYLE = "natural";
  if (options.traceTranscripts) bridge.NAQAH_CALL_TRACE_DIR = next.NAQAH_CALL_TRACE_DIR;
  // Some networks (NAT64) list an unreachable IPv6 address first for api.twilio.com: placement then times out.
  next.NODE_OPTIONS = IPV4_FIRST;
  bridge.NODE_OPTIONS = IPV4_FIRST;
  if (!live) {
    next.NODE_OPTIONS = `${IPV4_FIRST} --import=${join(REPO, "supabase/local-validation/mock-outbound.mjs")}`;
    next.NAQAH_TEST_OUTBOUND_GATEWAY = `http://127.0.0.1:${PROVIDER_PORT}/`;
    if (options.reportPath) next.NAQAH_MANUAL_REPORT_CALLS = "1";
    bridge.NODE_OPTIONS = `${IPV4_FIRST} --import=${join(REPO, "scripts/mocks/loopback-guard.mjs")}`;
    bridge.NAQAH_REALTIME_URL = `ws://127.0.0.1:${PROVIDER_PORT}/v1/realtime`;
  }
  const browserStack = { ...stack };
  delete browserStack.SUPABASE_SECRET_KEY;
  const naturalFlag = {
    ...(options.natural ? { NEXT_PUBLIC_NAQAH_NATURAL_CALLS: "1" } : {}),
    ...(options.ownerApproves ? { NEXT_PUBLIC_NAQAH_OWNER_APPROVES_NUMBERS: "1" } : {}),
    // The Dashboard's «اتصال حقيقي» is the demo's call; the Test AI Call page serves only the test ranch, so its menu
    // link would send the demo owner back to the Overview.
    ...(options.dashboardCall ? { NEXT_PUBLIC_NAQAH_TEST_CALL: "0" } : {}),
    ...(options.ownerCallNow ? { NEXT_PUBLIC_NAQAH_DEMO_OWNER_CALL: "1" } : {}),
    // «تعبئة تجريبية» buttons in onboarding, sign-in and Settings (fill only, never save).
    ...(options.demoAutofill ? { NEXT_PUBLIC_NAQAH_DEMO_AUTOFILL: "1" } : {}),
  };
  // LOCAL DEMO ONLY: «المالك» on the presentation ranch's Dashboard (see --owner-call-now). NAQAH_CALL_OWNER stays unset.
  if (options.ownerCallNow) next.NAQAH_DEMO_OWNER_CALL = "1";
  Object.assign(next, naturalFlag);
  return { build: { ...browserStack, ...accountFlags, ...naturalFlag, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" }, next, bridge, ports, publicBase };
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

/** With --keep-data the database survives restarts: the owner's saved numbers and questions stay as saved. */
function startPostgres(base, keep = false) {
  const kept = keep && existsSync(join(PGDATA, "PG_VERSION"));
  if (!kept) {
    rmSync(PGDATA, { recursive: true, force: true });
    rmSync(join(ROOT, "users.json"), { force: true });
  }
  mkdirSync(SOCK, { recursive: true });
  if (!kept) execFileSync(join(PG_BIN, "initdb"), ["-D", PGDATA, "-U", "postgres", "--auth=trust", "-E", "UTF8"], { env: pgEnv(base), stdio: "ignore" });
  execFileSync(join(PG_BIN, "pg_ctl"), ["-D", PGDATA, "-w", "-l", join(LOGS, "postgres.log"), "-o", `-p ${PG_PORT} -h 127.0.0.1 -k ${SOCK} -c fsync=off`, "start"], { env: pgEnv(base), stdio: "ignore" });
}

function stopPostgres(base, keep = false) {
  if (!existsSync(PGDATA)) return;
  try { execFileSync(join(PG_BIN, "pg_ctl"), ["-D", PGDATA, "-m", "fast", "-w", "stop"], { env: pgEnv(base), stdio: "ignore" }); } catch { /* already stopped */ }
  if (!keep) rmSync(PGDATA, { recursive: true, force: true });
}

/** A kept database that already holds the test ranch: nothing is seeded or overwritten. */
function keptDatabase(base) {
  try {
    return execFileSync(join(PG_BIN, "psql"), ["-X", "-A", "-t", "-d", DB, "-c", `select count(*) from farms where id = '${TEST_FARM}'`], { env: pgEnv(base), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "1";
  } catch { return false; }
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

export function resetLocalReport(env, runSql = localSql(cleanBaseEnv())) {
  assertLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL, "Supabase URL");
  runSql(`begin;
    do $$ begin
      if inet_server_addr() is null or not (inet_server_addr() <<= inet '127.0.0.0/8' or inet_server_addr() = inet '::1') then
        raise exception 'Refusing a non-loopback database';
      end if;
      perform 1 from public.farms f join public.test_call_ranches t on t.farm_id = f.id
        where f.id = '${TEST_FARM}' for update of f, t;
      if not found then raise exception 'No marked local test ranch'; end if;
      if exists (select 1 from public.report_call_runs where farm_id = '${TEST_FARM}' and state in ('calling', 'answered'))
        or exists (select 1 from public.test_calls where farm_id = '${TEST_FARM}' and status in ('calling', 'ringing', 'connected')) then
        raise exception 'A call is still active; wait for it to finish before resetting';
      end if;
    end $$;
    delete from public.reports where farm_id = '${TEST_FARM}' and at >= (
      select (case when plan = 'basic' then date_trunc('week', (now() at time zone 'Asia/Riyadh') + interval '1 day') - interval '1 day'
        else date_trunc('day', now() at time zone 'Asia/Riyadh') end) at time zone 'Asia/Riyadh'
      from public.farms where id = '${TEST_FARM}');
    delete from public.voice_call_sessions where farm_id = '${TEST_FARM}';
    update public.farms set last_update_at = (select max(at) from public.reports where farm_id = '${TEST_FARM}'), revision = revision + 1
      where id = '${TEST_FARM}';
    commit;`);
}

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
  LIVE MODE: pressing "Test AI Call"${options.dashboardCall ? " or the Dashboard's «اتصال حقيقي»" : ""} places a REAL, CHARGED phone call
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
  if (options.resetReport) {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "Supabase URL");
    const stack = readFileSync(STACK_ENV, "utf8");
    const url = stack.match(/export NEXT_PUBLIC_SUPABASE_URL='([^']*)'/)?.[1];
    resetLocalReport({ NEXT_PUBLIC_SUPABASE_URL: url });
    console.log("PASS local test ranch report reset. Rate limits are unchanged; no call placed.");
    return;
  }
  if (options.traceTranscripts) console.log("Local transcript tracing is enabled. Files older than 24 hours are cleaned on first write. All call participants must consent. Directory: " + join(tmpdir(), "naqah-call-transcripts"));
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
    stopPostgres(base, options.keepData);
    console.log("Stopped.");
    process.exit(code);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => shutdown(0));

  try {
    console.log("Starting the disposable database and local stack…");
    startPostgres(base, options.keepData);
    const kept = options.keepData && keptDatabase(base);
    if (options.mode === "live" || options.ownerApproves) {
      // Approved numbers: these plus any already approved for this kept stack.
      const already = kept && existsSync(APPROVED_FILE) ? readFileSync(APPROVED_FILE, "utf8").split("\n").filter((line) => SAUDI_MOBILE.test(line.trim())).map((line) => line.trim()) : [];
      const start = options.mode === "live" ? options.allow : [...MOCK_ALLOWED.filter((number) => SAUDI_MOBILE.test(number)), ...(options.reportPath ? [REPORT_PATH_WORKER] : [])];
      writeFileSync(APPROVED_FILE, [...new Set([...already, ...start])].join("\n") + "\n", { mode: 0o600 });
    }
    const stackChild = background("stack", "sh", [join(REPO, "supabase/local-validation/run-stack.sh"), STACK_ENV], {
      ...pgEnv(base), ...(kept ? { NAQAH_TEST_KEEP_DB: "1" } : {}),
      // Kept with the database, so the local logins still work after a restart.
      ...(options.keepData ? { NAQAH_TEST_USERS_FILE: join(ROOT, "users.json") } : {}), NAQAH_TEST_DB: DB, NAQAH_TEST_REST_PORT: String(REST_PORT), NAQAH_TEST_GATEWAY_PORT: String(GATEWAY_PORT), POSTGREST_BIN,
    });
    await waitFor(() => {
      if (stackChild.exitCode !== null) throw new UsageError(`The local stack exited early; see ${LOGS}/stack.log`);
      return existsSync(STACK_ENV);
    }, "the local stack", 480).catch((error) => { if (error instanceof UsageError) throw error; throw new Error(`${error.message}; see ${LOGS}/stack.log`); });
    const stack = Object.fromEntries([...readFileSync(STACK_ENV, "utf8").matchAll(/export (\w+)='([^']*)'/g)].map((match) => [match[1], match[2]]));
    const envs = buildEnvironments(options, stack, secrets);

    let testerId;
    let controlId;
    if (kept) {
      // The owner's saved numbers, questions and history stay exactly as they were saved.
      console.log("Keeping the saved local data (--keep-data): nothing is seeded or overwritten.");
      const ownerOf = (farm) => localSql(base)(`select owner_id from farms where id = '${farm}'`);
      testerId = ownerOf(TEST_FARM);
      controlId = ownerOf(CONTROL_FARM);
    } else {
      console.log("Creating local accounts and sample ranches…");
      testerId = await createUser(TESTER);
      controlId = await createUser(CONTROL);
      seed(base, testerId, controlId);
      // A fresh test ranch starts on the first approved number; after that the owner's saved number is used.
      if (options.dashboardCall && options.allow[0]) localSql(base)(`update workers set phone = '${options.allow[0]}' where farm_id = '${TEST_FARM}'`);
    }

    if (options.repeatDemoReports) {
      // Only the presentation ranch (named «… (عرض تجريبي)») may take another call after today's report.
      const ids = localSql(base)(`select coalesce(string_agg(id::text, ','), '') from farms where name like '%(عرض تجريبي)%'`);
      envs.next.NAQAH_DEMO_REPEAT_FARMS = ids;
      // Until the presentation: no hourly or daily limit on the presentation ranch's «اتصال حقيقي».
      if (options.noDemoCallLimit) envs.next.NAQAH_DEMO_NO_CALL_LIMIT = "1";
      console.log(ids ? `Repeat demo calls: on for ${ids.split(",").length} presentation ranch(es)${options.noDemoCallLimit ? ", no call limit" : ""}.` : "Repeat demo calls: no presentation ranch yet (seed it, then restart).");
    }

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

    const url = `http://127.0.0.1:${envs.ports.next}/ar/app${options.dashboardCall ? "" : "/lab"}`;
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
