#!/usr/bin/env node
// LOCAL ONLY. Runs the four-call test-ranch flow against throwaway Postgres and mock providers.
import { randomBytes, createHmac } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync,
  rmSync, writeFileSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { createServerClient } from "@supabase/ssr";
import { readEnvFile } from "./env-file.mjs";
import { reserveLoopbackPorts } from "./ports.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE_DIR = resolve(process.env.NAQAH_EVIDENCE_DIR?.trim() || join(ROOT, ".realcall", "evidence"));
const EVIDENCE = join(EVIDENCE_DIR, "rehearsal");
const FARM_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
];
const WORKER_IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
];
const TEST_NUMBER = "+966500000101";
const OTHER_NUMBERS = ["+966500000102", "+966500000103"];
const TEST_EMAIL = "local-test-owner@example.invalid";
const OTHER_EMAILS = ["local-other-one@example.invalid", "local-other-two@example.invalid"];
const ISOLATION_TABLES = new Set([
  "farms", "workers", "camels", "resources", "report_call_runs", "reports", "report_answers", "findings", "calls", "events",
  "task_tickets", "relays", "pending_worker_calls", "pending_worker_call_tasks", "worker_call_attempts", "no_answer_tickets",
  "voice_events", "voice_call_sessions", "test_call_ranches", "test_calls",
]);
const ISOLATION_TIMESTAMP_TABLES = new Set([
  "farms", "workers", "camels", "resources", "report_call_runs", "task_tickets", "pending_worker_calls",
  "no_answer_tickets", "voice_events", "voice_call_sessions", "test_call_ranches", "test_calls",
]);
const FAKE_ACCOUNT = `AC${"0".repeat(32)}`;
const FAKE_TWILIO_TOKEN = "local-test-auth-token";
const VOICE_SECRET = "local-only-voice-secret";
const CRON_SECRET = "local-only-cron-secret";
const OPENAI_KEY = "local-only-openai-key";
const PRELOAD = join(ROOT, "scripts/test-ranch/local-provider-preload.mjs");

const report = { startedAt: new Date().toISOString(), steps: [], placements: 0, testNumberOnly: false, foreignChecksums: false };
const processes = new Set();
let portsReservation;
let tlsServer;
let mockServer;
let mockSockets;
let stackEnvPath;
let tempDir;
let originalNext;
let nextWasMoved = false;
let testFarmOwnerId;
let accountCookie = "";
let nextProcess;
let stackProcess;
let proxyProcess;
let bridgeProcess;
let currentStep = "initialization";
let tlsCertificate;
let appOrigin;
let publicOrigin;
let bridgePublicUrl;
let proxyOrigin;
let mockOrigin;
let realtimeOrigin;
let stackEnv = {};
let psqlBaseEnv = {};
let testStart;
let mockMetrics = { models: 0, realtimeConnections: 0 };

function record(name, passed, detail = "") {
  const row = { name, passed, detail };
  report.steps.push(row);
  currentStep = name;
  const line = `${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  process.stdout.write(`${line}\n`);
}

function assertStep(condition, name, detail = "") {
  if (!condition) {
    record(name, false, detail || "check failed");
    throw new Error("rehearsal_step_failed");
  }
  record(name, true, detail);
}

function cleanEnv(extra = {}) {
  const env = {
    PATH: process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME,
    TMPDIR: tempDir,
    LANG: "C",
    LC_ALL: "C",
    NAQAH_EVIDENCE_DIR: process.env.NAQAH_EVIDENCE_DIR,
    ...extra,
  };
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

function startProcess(command, args, env, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || ROOT,
    env: cleanEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.outputTail = "";
  const collect = (chunk) => {
    child.outputTail = (child.outputTail + chunk.toString()).slice(-30_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.closed = new Promise((resolveClose) => child.once("close", (code, signal) => resolveClose({ code, signal })));
  processes.add(child);
  child.once("close", () => processes.delete(child));
  return child;
}

function runCommand(command, args, { env = {}, cwd = ROOT, input, timeout = 120_000 } = {}) {
  try {
    return execFileSync(command, args, {
      cwd,
      env: cleanEnv(env),
      input,
      encoding: "utf8",
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    throw new Error("local_command_failed");
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const result = await Promise.race([
    child.closed,
    new Promise((resolveWait) => setTimeout(() => resolveWait(null), 8_000)),
  ]);
  if (!result && child.exitCode === null) {
    child.kill("SIGKILL");
    await child.closed;
  }
}

async function waitFor(predicate, label, timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`wait_failed_${label}`);
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function envText(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${JSON.stringify(String(value))}`)
    .join("\n") + "\n";
}

function writePrivate(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function responseAdapter(response) {
  const chunks = [];
  return new Promise((resolveResponse, rejectResponse) => {
    response.on("data", (chunk) => chunks.push(chunk));
    response.once("error", rejectResponse);
    response.once("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      resolveResponse({
        status: response.statusCode || 0,
        ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300,
        headers,
        async text() { return body; },
        async json() { return JSON.parse(body); },
        body: { async cancel() {} },
      });
    });
  });
}

function localRequest(target, init = {}) {
  const url = target instanceof URL ? target : new URL(String(target));
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname)) throw new Error("non_loopback_request_refused");
  const transport = url.protocol === "https:" ? https : http;
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported_local_protocol");
  const headers = new Headers(init.headers || {});
  const body = init.body === undefined ? undefined : (typeof init.body === "string" ? init.body : String(init.body));
  if (body !== undefined && !headers.has("content-length") && !headers.has("transfer-encoding")) {
    headers.set("content-length", String(Buffer.byteLength(body)));
  }
  return new Promise((resolveResponse, rejectResponse) => {
    const request = transport.request({
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init.method || "GET",
      headers: Object.fromEntries(headers.entries()),
      ...(url.protocol === "https:" ? { ca: tlsCertificate, rejectUnauthorized: true } : {}),
    }, (response) => { responseAdapter(response).then(resolveResponse, rejectResponse); });
    request.setTimeout(15_000, () => request.destroy(new Error("local_request_timeout")));
    request.once("error", rejectResponse);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function safeTwilioSignature(url, fields, token = FAKE_TWILIO_TOKEN) {
  const suffix = Object.keys(fields).sort().map((key) => `${key}${fields[key]}`).join("");
  return createHmac("sha1", token).update(url + suffix, "utf8").digest("base64");
}

async function signedPost(url, fields) {
  const body = new URLSearchParams(fields).toString();
  return localRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": safeTwilioSignature(url, fields),
    },
    body,
  });
}

function xmlText(xml, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match?.[1]
    .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'") ?? null;
}

function localTaskVerificationTime() {
  const due = new Date(Math.ceil((Date.now() + 2 * 60_000) / 60_000) * 60_000);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(due);
}

function callStageAnswer(session) {
  if (session.scenario === "report_call") {
    if (session.step === "report_summary") return "Yes";
    if (session.step === "report_question") {
      const item = session.data?.queue?.[session.data?.reportIndex ?? 0];
      if (item?.kind === "custom") return "The gate is closed.";
      if (session.inputMode === "number") return "10";
      if (session.inputMode === "time") return "18:00";
      if (session.inputMode === "text") return "No issues reported.";
    }
  }
  if (session.scenario === "owner_notification") {
    if (session.step === "instruction_yesno") return "Yes";
    if (session.step === "instruction_text") return "Check the gate latch";
    if (session.step === "instruction_kind") return session.replies?.find((reply) => reply.value === "actionable")?.label?.en ?? "A task";
    if (session.step === "instruction_schedule") {
      return session.replies?.find((reply) => reply.value === "later_today")?.label?.en ?? "Later today";
    }
    if (session.step === "instruction_time") return localTaskVerificationTime();
    if (session.step === "instruction_date") {
      return session.replies?.find((reply) => reply.value === "any_time")?.label?.en ?? "Any time";
    }
    if (session.step === "instruction_more") return "No, that's all";
    if (session.step === "instruction_review") return "Yes";
    if (session.inputMode === "text") return "Check the gate latch";
  }
  if (session.scenario === "worker_outbound") {
    if (session.step === "outbound_receipt") return session.replies?.find((reply) => reply.value === "received")?.label?.en ?? "Yes, I heard them";
    if (session.step === "outbound_task_confirmation") return "Yes";
  }
  if (session.inputMode === "text") return "The gate is closed.";
  if (session.inputMode === "number") return "10";
  if (session.inputMode === "time") return "18:00";
  const positive = new Set(["yes", "confirm_save", "good", "healthy", "all_present", "received", "actionable", "any_time", "instructions_confirm", "complete"]);
  const reply = session.replies?.find((item) => positive.has(item.value));
  return reply?.label?.en ?? "Yes";
}

function collectFromTwiML(xml) {
  const action = /<Gather\b[^>]*\baction="([^"]+)"/i.exec(xml)?.[1] ?? null;
  const redirect = xmlText(xml, "Redirect");
  return { action: action?.replaceAll("&amp;", "&") ?? null, redirect };
}

export function scriptedAnswerFor(session) {
  return callStageAnswer(session);
}

export function extractTwiMLTargets(xml) {
  return collectFromTwiML(xml);
}

function sql(command, { readOnly = false, variables = {}, input } = {}) {
  const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", "naqah_ranch_rehearsal"];
  for (const [name, value] of Object.entries(variables)) args.push("-v", `${name}=${value}`);
  if (input !== undefined) args.push("-c", input);
  else args.push("-f", command);
  const env = readOnly ? { ...psqlBaseEnv, PGUSER: "naqah_rehearsal_ro" } : psqlBaseEnv;
  return runCommand("psql", args, { env, cwd: ROOT, timeout: 30_000 }).trim();
}

function rlsGuardRefusesNonBypassRole(command, variables) {
  const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", "naqah_ranch_rehearsal"];
  for (const [name, value] of Object.entries(variables)) args.push("-v", `${name}=${value}`);
  args.push("-f", command);
  try {
    execFileSync("psql", args, {
      cwd: ROOT,
      env: cleanEnv({ ...psqlBaseEnv, PGUSER: "naqah_rehearsal_no_bypass" }),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    return false;
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    return stderr.includes("isolation evidence refused: role") && stderr.includes("cannot bypass row-level security");
  }
}

async function makeTestUser(gatewayUrl, email) {
  const password = randomBytes(24).toString("hex");
  const response = await localRequest(new URL("/__test/users", gatewayUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 201) throw new Error("local_test_user_creation_failed");
  const user = await response.json();
  if (!user.id || !user.email_confirmed_at) throw new Error("local_test_user_unconfirmed");
  return { id: user.id, email, password };
}

function fixtureFarmSql(farm, worker, phone, { testFarm = false } = {}) {
  const localNow = "(now() at time zone 'Asia/Riyadh')";
  const stale = "(now() - interval '8 days')";
  const taskFixture = testFarm ? "" : `
    with task as (
      insert into task_tickets (farm_id, instruction, created_at)
      values (${quoteSql(farm.id)}, 'Fixture due work', ${stale}) returning id
    )
    insert into pending_worker_calls (farm_id, purpose, message, task_ticket_id, next_attempt_at, created_at)
    select ${quoteSql(farm.id)}, 'instruction', 'Fixture due work', id, now() - interval '1 minute', ${stale} from task;
  `;
  const question = testFarm ? `
    insert into custom_questions (farm_id, text) values (${quoteSql(farm.id)}, 'Was the gate closed?');
  ` : "";
  return `
    insert into farms (id, owner_id, plan, setup_complete, plan_selected_at, name, owner_name, owner_phone,
                       call_time, call_day, owner_call_time, owner_call_day)
    values (${quoteSql(farm.id)}, ${quoteSql(farm.ownerId)}, 'ultimate', true, ${stale},
            ${quoteSql(testFarm ? "Local test ranch" : "Local other ranch")},
            ${quoteSql(testFarm ? "Test owner" : "Fixture owner")}, ${quoteSql(phone)},
            (${localNow} - interval '1 minute')::time(0), extract(dow from ${localNow}),
            (${localNow} - interval '55 minutes')::time(0), extract(dow from ${localNow} - interval '55 minutes'));
    insert into workers (id, farm_id, name, phone, language)
    values (${quoteSql(worker)}, ${quoteSql(farm.id)}, ${quoteSql(testFarm ? "Test worker" : "Fixture worker")}, ${quoteSql(phone)}, 'en');
    update farms set primary_worker_id = ${quoteSql(worker)} where id = ${quoteSql(farm.id)};
    ${question}
    ${taskFixture}
    insert into rate_limit_buckets (key, count, reset_at)
    values (${quoteSql(`fixture:farm:${farm.id}`)}, 2, ${stale});
  `;
}

async function signIn(gatewayUrl, anonKey, user) {
  const cookies = new Map();
  const client = createServerClient(gatewayUrl, anonKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach(({ name, value }) => cookies.set(name, value)),
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || data.user?.id !== user.id || !data.user.email_confirmed_at) throw new Error("local_owner_sign_in_failed");
  accountCookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function makeTlsFront({ cert, key, port, proxyPort, bridgePort }) {
  const forward = (request, response, targetPort) => {
    const headers = { ...request.headers, host: `127.0.0.1:${targetPort}` };
    delete headers.connection;
    const outgoing = http.request({ hostname: "127.0.0.1", port: targetPort, method: request.method, path: request.url, headers }, (incoming) => {
      response.writeHead(incoming.statusCode || 502, incoming.headers);
      incoming.pipe(response);
    });
    outgoing.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(outgoing);
  };
  const server = https.createServer({ cert, key }, (request, response) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    forward(request, response, path.startsWith("/voice-bridge/") ? bridgePort : proxyPort);
  });
  server.on("upgrade", (request, client, head) => {
    const upstream = http.request({ hostname: "127.0.0.1", port: bridgePort, method: "GET", path: request.url, headers: request.headers });
    upstream.once("upgrade", (response, socket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${response.statusCode || 101} ${response.statusMessage || "Switching Protocols"}`];
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) lines.push(`${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
      }
      client.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) socket.write(head);
      socket.pipe(client).pipe(socket);
    });
    upstream.once("response", (response) => {
      const lines = [`HTTP/1.1 ${response.statusCode || 502} ${response.statusMessage || "Bad Gateway"}`];
      for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) lines.push(`${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
      client.write(`${lines.join("\r\n")}\r\n\r\n`);
      response.pipe(client);
    });
    upstream.once("error", () => client.destroy());
    client.once("close", () => upstream.destroy());
    upstream.end();
  });
  return new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}

async function startMockOpenAI(httpPort, wsPort) {
  mockServer = http.createServer((request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/v1/models")) {
      mockMetrics.models += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "gpt-realtime-2.1" }] }));
      return;
    }
    response.writeHead(404).end();
  });
  mockSockets = new WebSocketServer({ server: mockServer });
  mockSockets.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "session.created", session: { id: "local-mock-session" } }));
    socket.on("message", (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated", session: event.session }));
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    mockServer.once("error", rejectListen);
    mockServer.listen(httpPort, "127.0.0.1", resolveListen);
  });
  const wsServer = http.createServer();
  const wsUpgrade = new WebSocketServer({ server: wsServer });
  wsUpgrade.on("connection", (socket) => {
    mockMetrics.realtimeConnections += 1;
    socket.send(JSON.stringify({ type: "session.created", session: { id: "local-mock-realtime" } }));
    socket.on("message", (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated", session: event.session }));
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    wsServer.once("error", rejectListen);
    wsServer.listen(wsPort, "127.0.0.1", resolveListen);
  });
  mockServer.wsServer = wsServer;
  mockServer.wsUpgrade = wsUpgrade;
}

function appEnvironment({ engine, locale = "en", ownerCalls = false, manualCalls = false, demoCapTest = false } = {}) {
  return {
    ...stackEnv,
    NODE_ENV: "production",
    NODE_OPTIONS: `--import=${PRELOAD}`,
    NODE_EXTRA_CA_CERTS: join(tempDir, "local-cert.pem"),
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(portsReservation.ports[5]),
    NEXT_PUBLIC_NAQAH_ACCOUNT_DATA: "1",
    NEXT_PUBLIC_NAQAH_BUILD_COMMIT: report.commit,
    NAQAH_TEST_OWNER_EMAIL: TEST_EMAIL,
    NAQAH_TEST_RANCH_ID: FARM_IDS[0],
    NAQAH_TEST_MAX_CALLS: "4",
    NAQAH_CALL_ALLOWLIST: TEST_NUMBER,
    NAQAH_VOICE_SECRET: VOICE_SECRET,
    NAQAH_VOICE_MODE: "farm",
    NAQAH_VOICE_ENGINE: engine,
    NAQAH_VOICE_LOCALE: locale,
    NAQAH_PUBLIC_BASE_URL: publicOrigin,
    NAQAH_BRIDGE_PUBLIC_URL: bridgePublicUrl,
    NAQAH_REALTIME_URL: realtimeOrigin,
    TWILIO_ACCOUNT_SID: FAKE_ACCOUNT,
    TWILIO_AUTH_TOKEN: FAKE_TWILIO_TOKEN,
    TWILIO_PHONE_NUMBER: "+966500000299",
    OPENAI_API_KEY: OPENAI_KEY,
    CRON_SECRET,
    NAQAH_CALL_OWNER: ownerCalls ? "1" : undefined,
    NAQAH_MANUAL_REPORT_CALLS: manualCalls ? "1" : undefined,
    NAQAH_TEST_OUTBOUND_GATEWAY: stackEnv.NEXT_PUBLIC_SUPABASE_URL,
    NAQAH_TEST_OPENAI_HTTP_ORIGIN: mockOrigin,
    ...(demoCapTest ? {
      NAQAH_CALL_ALLOWLIST_FILE: join(tempDir, "approved-number.txt"),
      NAQAH_DEMO_REPEAT_FARMS: FARM_IDS[0],
    } : {}),
  };
}

async function restartNext(options) {
  await stopProcess(nextProcess);
  nextProcess = startProcess(process.execPath, [join(ROOT, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(portsReservation.ports[5])], appEnvironment(options));
  await waitFor(async () => {
    try {
      const response = await localRequest(new URL("/api/integrations/status", appOrigin));
      return response.status === 200;
    } catch { return false; }
  }, "next_start");
}

function readSession(callSid) {
  const output = sql("", { input: `select session::text from public.voice_call_sessions where call_sid = ${quoteSql(callSid)};` });
  if (!output) return null;
  try { return JSON.parse(output); } catch { throw new Error("voice_session_parse_failed"); }
}

function countQuery(query) {
  return Number(sql("", { input: query }));
}

async function appPost(path, body, { authenticated = false } = {}) {
  const headers = {
    origin: appOrigin,
    "content-type": "application/json",
    ...(authenticated ? { cookie: accountCookie } : {}),
  };
  return localRequest(new URL(path, appOrigin), { method: "POST", headers, body: JSON.stringify(body) });
}

async function readPlacements() {
  const response = await localRequest(new URL("/__test/outbound", stackEnv.NEXT_PUBLIC_SUPABASE_URL));
  if (response.status !== 200) throw new Error("mock_provider_state_unavailable");
  const body = await response.json();
  return Array.isArray(body.requests) ? body.requests : [];
}

async function advanceConversation(callSid, responseXml, kind, maxTurns = 48) {
  let xml = responseXml;
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const session = readSession(callSid);
    if (!session) return { done: true, turns: turn, lastXml: xml };
    const targets = collectFromTwiML(xml);
    if (!targets.action) {
      if (session.done) return { done: true, turns: turn, lastXml: xml };
      throw new Error(`conversation_gather_missing_${kind}`);
    }
    if (kind === "report" && session.step === "report_summary") {
      const savedBeforeYes = countQuery(`select count(*) from public.reports where farm_id = ${quoteSql(FARM_IDS[0])}`);
      if (savedBeforeYes !== 0) throw new Error("report_saved_before_confirmation");
      report.reportStayedUnsaved = true;
    }
    const response = await signedPost(new URL(targets.action, publicOrigin).toString(), {
      CallSid: callSid,
      SpeechResult: callStageAnswer(session),
      Confidence: "0.99",
    });
    if (response.status !== 200) throw new Error(`conversation_turn_failed_${kind}`);
    xml = await response.text();
    if (session.step === "report_summary") {
      const savedAfterYes = countQuery(`select count(*) from public.reports where farm_id = ${quoteSql(FARM_IDS[0])}`);
      if (savedAfterYes !== 1) throw new Error("report_not_saved_after_confirmation");
      report.reportSavedAfterYes = true;
    }
    if (kind === "worker_instruction" && session.step === "outbound_receipt") report.receiptAsked = true;
    if (kind === "worker_verify" && session.step === "outbound_task_confirmation") report.verificationAsked = true;
    if (xml.includes("<Hangup") || xml.includes("<Redirect")) {
      const next = collectFromTwiML(xml);
      if (!next.action) return { done: true, turns: turn + 1, lastXml: xml };
    }
  }
  throw new Error(`conversation_turn_limit_${kind}`);
}

async function simulateTwilioCall(placement, kind) {
  if (typeof placement.Url !== "string" || typeof placement.StatusCallback !== "string" || typeof placement.sid !== "string") {
    throw new Error("mock_placement_shape_invalid");
  }
  const callback = placement.StatusCallback;
  if (kind === "report") {
    for (const status of ["initiated", "ringing", "answered"]) {
      const response = await signedPost(callback, { CallSid: placement.sid, CallStatus: status });
      if (response.status !== 204) throw new Error("report_progress_callback_failed");
    }
  }
  const amdUrl = new URL(placement.Url);
  const gate = await signedPost(amdUrl.toString(), { CallSid: placement.sid, AnsweredBy: "human" });
  if (gate.status !== 200) throw new Error("mock_amd_callback_failed");
  const gateXml = await gate.text();
  const gateTargets = collectFromTwiML(gateXml);
  if (!gateTargets.redirect) throw new Error("mock_answer_redirect_missing");
  const answerUrl = new URL(gateTargets.redirect, placement.Url).toString();
  const answer = await signedPost(answerUrl, { CallSid: placement.sid });
  if (answer.status !== 200) throw new Error("mock_answer_webhook_failed");
  const answerXml = await answer.text();
  const conversationKind = kind === "report" ? "report" : kind === "owner" ? "owner" : kind === "worker_instruction" ? "worker_instruction" : "worker_verify";
  await advanceConversation(placement.sid, answerXml, conversationKind);
  const finalStatus = await signedPost(callback, { CallSid: placement.sid, CallStatus: "completed" });
  if (finalStatus.status !== 204) throw new Error("mock_final_status_callback_failed");
  return placement.sid;
}

function bridgeSignature(timestamp, rawBody) {
  const key = createHmac("sha256", VOICE_SECRET).update("naqah-bridge-internal").digest();
  return createHmac("sha256", key).update(`${timestamp}.${rawBody}`).digest("hex");
}

async function bridgePost(path, body) {
  const raw = JSON.stringify(body);
  const timestamp = Date.now().toString();
  return localRequest(new URL(path, appOrigin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-naqah-bridge-timestamp": timestamp,
      "x-naqah-bridge-signature": bridgeSignature(timestamp, raw),
    },
    body: raw,
  });
}

function scheduledTaskAt(time) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const date = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
  return `${date}T${time}:00+03:00`;
}

async function simulateRealtimeOwnerCall(placement) {
  if (typeof placement.Url !== "string" || typeof placement.StatusCallback !== "string" || typeof placement.sid !== "string") {
    throw new Error("mock_placement_shape_invalid");
  }
  const gate = await signedPost(placement.Url, { CallSid: placement.sid, AnsweredBy: "human" });
  if (gate.status !== 200) throw new Error("owner_amd_callback_failed");
  const gateTargets = collectFromTwiML(await gate.text());
  if (!gateTargets.redirect) throw new Error("owner_answer_redirect_missing");
  const answer = await signedPost(new URL(gateTargets.redirect, placement.Url).toString(), { CallSid: placement.sid });
  if (answer.status !== 200) throw new Error("owner_answer_webhook_failed");
  const xml = await answer.text();
  if (!xml.includes("<Stream")) throw new Error("owner_realtime_stream_missing");
  const ticket = /name="ticket" value="([^"]+)"/.exec(xml)?.[1];
  if (!ticket) throw new Error("owner_realtime_ticket_missing");

  const opened = await bridgePost("/api/voice/realtime/session", { ticket, callSid: placement.sid });
  if (opened.status !== 200) throw new Error("owner_realtime_session_failed");
  const time = localTaskVerificationTime();
  const due = scheduledTaskAt(time);
  if (Date.parse(due) <= Date.now()) throw new Error("owner_task_time_not_future");
  const proposedResponse = await bridgePost("/api/voice/realtime/tool", {
    ticket, callSid: placement.sid, toolCallId: "local-owner-proposal", name: "propose_instructions",
    args: { items: [{ message: "Check the gate", kind: "task", due, evidence: `check the gate today at ${time}` }] },
    workerUtterance: `Tell him to check the gate today at ${time}`, userSpokeSinceLastTool: true,
  });
  if (proposedResponse.status !== 200) throw new Error("owner_instruction_proposal_failed");
  const proposed = await proposedResponse.json();
  if (proposed.awaitingConfirmation !== true || !proposed.summaryId) throw new Error("owner_instruction_readback_missing");

  const confirmedResponse = await bridgePost("/api/voice/realtime/tool", {
    ticket, callSid: placement.sid, toolCallId: "local-owner-confirm", name: "confirm_instructions",
    args: { confirmed: true }, workerUtterance: "Yes, save them", heardSummaryId: proposed.summaryId, userSpokeSinceLastTool: true,
  });
  if (confirmedResponse.status !== 200) throw new Error("owner_instruction_confirmation_failed");
  const confirmed = await confirmedResponse.json();
  if (JSON.parse(confirmed.output).status !== "saved") throw new Error("owner_instructions_not_saved");

  const closed = await bridgePost("/api/voice/realtime/closed", { ticket, callSid: placement.sid, reason: "normal" });
  if (closed.status !== 204) throw new Error("owner_realtime_close_failed");
  const finalStatus = await signedPost(placement.StatusCallback, { CallSid: placement.sid, CallStatus: "completed" });
  if (finalStatus.status !== 204) throw new Error("owner_final_status_callback_failed");
  return { callSid: placement.sid, scheduledAt: due };
}

function parseSnapshot(raw) {
  const rows = new Map();
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const [name, count, checksum] = line.split("|");
    if (ISOLATION_TABLES.has(name) && count !== undefined && checksum) rows.set(name, { count, checksum });
  }
  return rows;
}

export function parseIsolationSnapshot(raw) {
  return parseSnapshot(raw);
}

export function countPassedSteps(steps) {
  return { passed: steps.filter((step) => step?.passed === true).length, total: steps.length };
}

export function parseForeignChangeEvidence(raw) {
  const commitCheck = /foreign_rows_created_or_updated_since_test_start\|([^|\r\n]+)\|([^\r\n]*)/.exec(raw);
  const commitTimestampStatus = commitCheck?.[1] ?? "missing";
  const commitTimestampCount = commitCheck?.[2] ?? "missing";
  const timestampCounts = new Map(raw.split(/\r?\n/).flatMap((line) => {
    const match = /^([a-z_]+)\|(\d+)$/.exec(line);
    return match && ISOLATION_TIMESTAMP_TABLES.has(match[1]) ? [[match[1], Number(match[2])]] : [];
  }));
  const noForeignTimestampChanges = timestampCounts.size === ISOLATION_TIMESTAMP_TABLES.size && [...timestampCounts.values()].every((count) => count === 0);
  const commitTimestampSafe = (commitTimestampStatus === "available" && commitTimestampCount === "0") || commitTimestampStatus === "commit timestamps unavailable";
  return {
    commitTimestampStatus,
    noForeignTimestampChanges,
    safe: noForeignTimestampChanges && commitTimestampSafe,
  };
}

function sameSnapshot(before, after) {
  return before.size === after.size && [...before].every(([name, row]) => {
    const later = after.get(name);
    return later?.count === row.count && later?.checksum === row.checksum;
  });
}

async function prepare() {
  process.umask(0o077);
  tempDir = mkdtempSync("/private/tmp/naqah-test-ranch-rehearsal.");
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const commit = runCommand("git", ["rev-parse", "HEAD"], { cwd: ROOT }).trim();
  report.commit = commit;
  portsReservation = await reserveLoopbackPorts(9);
  const [pgPort, restPort, gatewayPort, mockHttpPort, mockWsPort, nextPort, bridgePort, proxyPort, tlsPort] = portsReservation.ports;
  psqlBaseEnv = { PGHOST: "127.0.0.1", PGPORT: String(pgPort), PGUSER: "postgres", PGDATABASE: "postgres" };
  appOrigin = `http://127.0.0.1:${nextPort}`;
  proxyOrigin = `http://127.0.0.1:${proxyPort}`;
  publicOrigin = `https://localhost:${tlsPort}`;
  bridgePublicUrl = `wss://localhost:${tlsPort}/voice-bridge/media`;
  mockOrigin = `http://127.0.0.1:${mockHttpPort}`;
  realtimeOrigin = `ws://127.0.0.1:${mockWsPort}/v1/realtime?model=gpt-realtime-2.1`;
  report.portRange = `${Math.min(...portsReservation.ports)}-${Math.max(...portsReservation.ports)}`;

  await portsReservation.close();
  const pgPrefix = runCommand("brew", ["--prefix", "postgresql@17"], { cwd: ROOT }).trim();
  const pgBin = join(pgPrefix, "bin");
  const initdb = join(pgBin, "initdb");
  const pgCtl = join(pgBin, "pg_ctl");
  const postgresData = join(tempDir, "pgdata");
  mkdirSync(postgresData, { recursive: true, mode: 0o700 });
  runCommand(initdb, ["-D", postgresData, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"], { cwd: ROOT, timeout: 30_000 });
  runCommand(pgCtl, ["-D", postgresData, "-l", join(tempDir, "postgres.log"), "-o", `-h 127.0.0.1 -p ${pgPort} -k '' -c track_commit_timestamp=on`, "-w", "start"], { cwd: ROOT, timeout: 45_000 });
  report.pgData = postgresData;
  report.pgCtl = pgCtl;

  await startMockOpenAI(mockHttpPort, mockWsPort);
  stackEnvPath = join(tempDir, "stack.env");
  const stackSecret = `local-only-${randomBytes(32).toString("hex")}`;
  const stackEnvironment = {
    ...psqlBaseEnv,
    NAQAH_TEST_DB: "naqah_ranch_rehearsal",
    NAQAH_TEST_REST_PORT: String(restPort),
    NAQAH_TEST_GATEWAY_PORT: String(gatewayPort),
    NAQAH_TEST_JWT_SECRET: stackSecret,
    NAQAH_TEST_SKIP_CRON_EXTENSIONS: "1",
    NAQAH_TEST_SKIP_SCHEDULER_MIGRATION: "1",
    POSTGREST_BIN: runCommand("/bin/sh", ["-c", "command -v postgrest"], { cwd: ROOT }).trim(),
  };
  stackProcess = startProcess("/bin/sh", [join(ROOT, "supabase/local-validation/run-stack.sh"), stackEnvPath], stackEnvironment);
  await waitFor(() => existsSync(stackEnvPath), "local_supabase_stack");
  stackEnv = readEnvFile(stackEnvPath);
  await waitFor(async () => {
    try { return (await localRequest(new URL("/auth/v1/.well-known/jwks.json", stackEnv.NEXT_PUBLIC_SUPABASE_URL))).status === 200; }
    catch { return false; }
  }, "mock_auth_gateway");
  report.gatewayUrl = stackEnv.NEXT_PUBLIC_SUPABASE_URL;

  const users = [];
  users.push(await makeTestUser(stackEnv.NEXT_PUBLIC_SUPABASE_URL, TEST_EMAIL));
  for (const email of OTHER_EMAILS) users.push(await makeTestUser(stackEnv.NEXT_PUBLIC_SUPABASE_URL, email));
  testFarmOwnerId = users[0].id;
  const fixtureRows = FARM_IDS.map((id, index) => ({ id, ownerId: users[index].id }));
  const fixtureSql = fixtureRows.map((farm, index) => fixtureFarmSql(farm, WORKER_IDS[index], index === 0 ? TEST_NUMBER : OTHER_NUMBERS[index - 1], { testFarm: index === 0 })).join("\n");
  sql("", { input: `begin; ${fixtureSql} commit;` });
  await signIn(stackEnv.NEXT_PUBLIC_SUPABASE_URL, stackEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, users[0]);
  report.testOwnerId = testFarmOwnerId;
  report.ranchCount = Number(sql("", { input: "select count(*) from public.farms;" }));
  report.testFarmId = FARM_IDS[0];
  report.userConfirmed = true;
  report.users = users;

  const grants = `do $$ begin create role naqah_rehearsal_ro login bypassrls; exception when duplicate_object then null; end $$;
    do $$ begin create role naqah_rehearsal_no_bypass login nobypassrls; exception when duplicate_object then null; end $$;
    grant select on all tables in schema public to naqah_rehearsal_ro, naqah_rehearsal_no_bypass;`;
  sql("", { input: grants });
  const startResult = sql("", { input: "select clock_timestamp()::text;" });
  testStart = startResult;

  const certFile = join(tempDir, "local-cert.pem");
  const keyFile = join(tempDir, "local-key.pem");
  runCommand("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyFile, "-out", certFile, "-days", "1", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-addext", "basicConstraints=critical,CA:TRUE"], { cwd: ROOT, timeout: 30_000 });
  chmodSync(keyFile, 0o600);
  chmodSync(certFile, 0o600);
  tlsCertificate = readFileSync(certFile);
  tlsServer = await makeTlsFront({ cert: tlsCertificate, key: readFileSync(keyFile), port: tlsPort, proxyPort, bridgePort });

  const proxyEnvFile = join(tempDir, "bridge-proxy.env");
  writePrivate(proxyEnvFile, envText({ PREVIEW_ORIGIN: appOrigin, VERCEL_AUTOMATION_BYPASS_SECRET: "local-only-bypass", PORT: proxyPort }));
  proxyProcess = startProcess(process.execPath, [join(ROOT, "scripts/test-ranch/bridge-proxy.mjs"), proxyEnvFile], {});
  await waitFor(async () => {
    try { return (await localRequest(new URL("/api/cron/report-calls", proxyOrigin), { method: "GET" })).status === 404; }
    catch { return false; }
  }, "bridge_proxy");

  const bridgeEnvironment = {
    PORT: String(bridgePort),
    NAQAH_BRIDGE_PUBLIC_URL: bridgePublicUrl,
    NAQAH_BRIDGE_UPSTREAM: proxyOrigin,
    NAQAH_REALTIME_URL: realtimeOrigin,
    OPENAI_API_KEY: OPENAI_KEY,
    TWILIO_ACCOUNT_SID: FAKE_ACCOUNT,
    TWILIO_AUTH_TOKEN: FAKE_TWILIO_TOKEN,
    NAQAH_VOICE_SECRET: VOICE_SECRET,
    NAQAH_TEST_OUTBOUND_GATEWAY: stackEnv.NEXT_PUBLIC_SUPABASE_URL,
    NAQAH_TEST_OPENAI_HTTP_ORIGIN: mockOrigin,
    NODE_OPTIONS: `--import=${PRELOAD}`,
    NODE_EXTRA_CA_CERTS: certFile,
  };
  bridgeProcess = startProcess(process.execPath, [join(ROOT, "services/voice-bridge/index.mjs")], bridgeEnvironment);
  await waitFor(async () => {
    try { return (await localRequest(new URL("/voice-bridge/health", publicOrigin))).status === 200; }
    catch { return false; }
  }, "voice_bridge");

  const original = join(ROOT, ".next");
  originalNext = join(tempDir, "original-next");
  if (existsSync(original)) {
    renameSync(original, originalNext);
    nextWasMoved = true;
  }
  const buildEnv = appEnvironment({ engine: "scripted", manualCalls: false });
  delete buildEnv.PORT;
  const build = startProcess(process.execPath, [join(ROOT, "node_modules/next/dist/bin/next"), "build"], buildEnv);
  const built = await build.closed;
  if (built.code !== 0 || !existsSync(join(ROOT, ".next/BUILD_ID"))) throw new Error("production_build_failed");
  report.productionBuild = true;
}

async function prepareBaseline() {
  const baselinePath = join(ROOT, "scripts/test-ranch/sql/isolation-baseline.sql");
  const baseline = sql(baselinePath, { readOnly: true, variables: { test_farm_id: FARM_IDS[0], test_start: testStart } });
  const snapshot = parseSnapshot(baseline);
  if (snapshot.size !== ISOLATION_TABLES.size) throw new Error("foreign_baseline_table_count_invalid");
  report.baselineCounts = Object.fromEntries([...snapshot].map(([name, row]) => [name, row.count]));
  report.baselineSnapshot = snapshot;
  report.baselineReadOnly = true;
  assertStep(rlsGuardRefusesNonBypassRole(baselinePath, { test_farm_id: FARM_IDS[0], test_start: testStart }),
    "RLS-limited isolation reader refused", "the SQL aborts before checksums when the role cannot bypass RLS");
}

async function preflight() {
  await restartNext({ engine: "realtime", manualCalls: true });
  const envFile = join(tempDir, "preview.ranch.env");
  writePrivate(envFile, envText({
    PREVIEW_ORIGIN: publicOrigin,
    NAQAH_TEST_RANCH_ID: FARM_IDS[0],
    NAQAH_CALL_ALLOWLIST: TEST_NUMBER,
    NAQAH_TEST_MAX_CALLS: "4",
    NAQAH_VOICE_SECRET: VOICE_SECRET,
    NAQAH_VOICE_MODE: "farm",
    NAQAH_VOICE_ENGINE: "realtime",
    NAQAH_VOICE_LOCALE: "en",
    TWILIO_AUTH_TOKEN: FAKE_TWILIO_TOKEN,
    VERCEL_AUTOMATION_BYPASS_SECRET: "local-only-bypass",
  }));
  const env = cleanEnv({
    NODE_OPTIONS: `--import=${PRELOAD}`,
    NODE_EXTRA_CA_CERTS: join(tempDir, "local-cert.pem"),
    NAQAH_TEST_OUTBOUND_GATEWAY: stackEnv.NEXT_PUBLIC_SUPABASE_URL,
    NAQAH_TEST_OPENAI_HTTP_ORIGIN: mockOrigin,
    TWILIO_ACCOUNT_SID: FAKE_ACCOUNT,
    TWILIO_AUTH_TOKEN: FAKE_TWILIO_TOKEN,
  });
  const child = startProcess(process.execPath, [join(ROOT, "scripts/test-ranch/preflight.mjs"), envFile, "--origin", publicOrigin, "--proxy-origin", proxyOrigin, "--local"], env);
  const outcome = await child.closed;
  const output = child.outputTail;
  const passCount = (output.match(/^PASS /gm) || []).length;
  const failCount = (output.match(/^FAIL /gm) || []).length;
  assertStep(outcome.code === 0 && failCount === 0 && passCount >= 19, "signed no-call and provider preflight", `${passCount} checks passed`);
  report.preflightPassCount = passCount;
  const ownerCheck = await localRequest(new URL("/api/report-call-now?preflight=1", appOrigin), {
    headers: { cookie: accountCookie },
  });
  const ownerPreflight = ownerCheck.status === 200 ? await ownerCheck.json() : null;
  const expectedChecks = [
    "worker_allowlisted", "no_active_run", "public_bridge_url", "twilio_account", "twilio_voice_number",
    "bridge_health", "bridge_configuration", "openai_key", "openai_realtime",
  ];
  const passedChecks = ownerPreflight?.checks?.filter((check) => check.passed).map((check) => check.name) ?? [];
  const failedChecks = ownerPreflight?.checks?.filter((check) => !check.passed).map((check) => check.name) ?? [];
  const providerDetail = ownerPreflight?.ready === true
    ? "all scoped provider checks passed without placing a call"
    : `status=${ownerCheck.status}; passed=${passedChecks.length}/9; failed=${failedChecks.join(",") || "preflight_response"}`;
  assertStep(ownerPreflight?.ok === true && ownerPreflight.ready === true &&
    expectedChecks.every((name) => passedChecks.includes(name)) && passedChecks.length === expectedChecks.length,
  "authenticated nine-check provider preflight", providerDetail);
  assertStep(mockMetrics.models > 0 && mockMetrics.realtimeConnections > 0,
    "mock Realtime provider probes reached", "HTTP models and WebSocket session probes stayed on loopback");
}

async function bridgeSmoke() {
  const healthResponse = await localRequest(new URL("/voice-bridge/health", publicOrigin));
  const health = await healthResponse.json();
  assertStep(healthResponse.status === 200 && health.ok === true && health.publicUrl === bridgePublicUrl && health.maxCallSeconds === 300, "bridge health", "loopback bridge reports the configured URL and 300 second cap");

  const unsigned = new WebSocket(bridgePublicUrl, { ca: tlsCertificate, rejectUnauthorized: true, handshakeTimeout: 5_000 });
  const unsignedResult = await new Promise((resolveResult) => {
    unsigned.once("unexpected-response", (_request, response) => { response.resume(); resolveResult(response.statusCode); });
    unsigned.once("open", () => { unsigned.close(); resolveResult(101); });
    unsigned.once("error", () => resolveResult(0));
  });
  assertStep(unsignedResult === 403, "unsigned bridge websocket rejected", "HTTP 403");

  const signature = createHmac("sha1", FAKE_TWILIO_TOKEN).update(bridgePublicUrl).digest("base64");
  const signed = new WebSocket(bridgePublicUrl, { ca: tlsCertificate, rejectUnauthorized: true, handshakeTimeout: 5_000, headers: { "X-Twilio-Signature": signature } });
  const signedResult = await new Promise((resolveResult) => {
    signed.once("open", () => { signed.close(); resolveResult(101); });
    signed.once("unexpected-response", (_request, response) => { response.resume(); resolveResult(response.statusCode); });
    signed.once("error", () => resolveResult(0));
  });
  assertStep(signedResult === 101, "signed bridge websocket accepted", "HTTP 101; no media sent");
  report.bridgeSmoke = true;
}

async function triggerManualStage(op) {
  const before = (await readPlacements()).length;
  const response = await appPost("/api/account", { op }, { authenticated: true });
  const payload = response.status === 200 ? await response.json() : null;
  if (payload?.ok !== true || payload.data !== "placed") throw new Error("manual_call_action_failed");
  const placements = await readPlacements();
  if (placements.length !== before + 1 || placements[before].To !== TEST_NUMBER) throw new Error("manual_call_destination_mismatch");
  report.placements += 1;
  return placements[before];
}

async function runCallNow() {
  await restartNext({ engine: "scripted", manualCalls: true });
  const placement = await triggerManualStage("testCallReport");
  await simulateTwilioCall(placement, "report");
  const savedReport = countQuery(`select count(*) from public.reports where farm_id = ${quoteSql(FARM_IDS[0])}`);
  const linkedRun = countQuery(`select count(*) from public.report_call_runs r join public.reports p on p.id = r.report_id
    where r.farm_id = ${quoteSql(FARM_IDS[0])} and r.provider_call_id = ${quoteSql(placement.sid)};`);
  assertStep(report.reportStayedUnsaved && report.reportSavedAfterYes && savedReport === 1, "call 1 saves report only after explicit yes", "one report created after confirmation");
  assertStep(linkedRun === 1, "call 1 report run linked", "provider run and saved report are linked");
}

async function runOwnerSummary() {
  await restartNext({ engine: "realtime", ownerCalls: true, manualCalls: true });
  const placement = await triggerManualStage("testCallOwnerSummary");
  const ownerCall = await simulateRealtimeOwnerCall(placement);
  report.verificationScheduledAt = ownerCall.scheduledAt;
  const ownerState = sql("", { input: `select owner_call_run->>'state' from public.farms where id = ${quoteSql(FARM_IDS[0])};` });
  const ownerRunLinked = countQuery(`select count(*) from public.farms f join public.reports r on r.farm_id = f.id
    where f.id = ${quoteSql(FARM_IDS[0])} and f.owner_call_run->>'state' = 'completed'
      and f.owner_call_run->>'reportId' = r.id::text;`);
  const tickets = countQuery(`select count(*) from public.task_tickets where farm_id = ${quoteSql(FARM_IDS[0])};`);
  const openTickets = countQuery(`select count(*) from public.task_tickets where farm_id = ${quoteSql(FARM_IDS[0])} and status = 'open';`);
  const dueAt = Date.parse(sql("", { input: `select scheduled_for::text from public.task_tickets where farm_id = ${quoteSql(FARM_IDS[0])} and status = 'open' limit 1;` }));
  assertStep(ownerState === "completed" && ownerRunLinked === 1 && tickets === 1 && openTickets === 1,
    "owner summary links the latest report and creates one task", "Realtime summary completed after explicit yes");
  assertStep(dueAt > Date.now(), "task verification remains scheduled in the future", "the owner gave a future time during the summary call");
}

async function runWorkerManual(op, kind, stepName) {
  await restartNext({ engine: "scripted", manualCalls: true });
  const dueAt = kind === "worker_verify"
    ? Date.parse(sql("", { input: `select scheduled_for::text from public.task_tickets where farm_id = ${quoteSql(FARM_IDS[0])} and status = 'open' limit 1;` }))
    : null;
  const pressedAt = Date.now();
  if (dueAt !== null && dueAt <= pressedAt) throw new Error("verification_schedule_not_future");
  const placement = await triggerManualStage(op);
  if (dueAt !== null) {
    assertStep(pressedAt < dueAt, "verification button places before the scheduled time", "one call placed immediately after owner confirmation");
  }
  await simulateTwilioCall(placement, kind);
  if (kind === "worker_instruction") {
    report.instructionDelivered = countQuery(`select count(*) from public.pending_worker_calls p join public.worker_call_attempts a on a.pending_call_id = p.id
      where p.farm_id = ${quoteSql(FARM_IDS[0])} and p.purpose = 'instruction' and p.state = 'delivered'
        and p.next_attempt_at is null and a.answered = true;`) === 1;
    assertStep(report.instructionDelivered, stepName, "the owner-confirmed instruction reached the worker");
  } else {
    const closed = countQuery(`select count(*) from public.task_tickets where farm_id = ${quoteSql(FARM_IDS[0])} and status = 'closed' and closed_via = 'worker_task_verification';`);
    assertStep(closed === 1, stepName, "the worker explicitly confirmed the open task");
  }
}

async function checkIsolationAndCap() {
  const afterPath = join(ROOT, "scripts/test-ranch/sql/isolation-after.sql");
  const afterOutput = sql(afterPath, { readOnly: true, variables: { test_farm_id: FARM_IDS[0], test_start: testStart } });
  const after = parseSnapshot(afterOutput);
  const unchanged = sameSnapshot(report.baselineSnapshot, after);
  const foreignChangeEvidence = parseForeignChangeEvidence(afterOutput);
  const foreignRateLimits = /rate_limit_buckets_for_other_farms\|\d+\|([0-9a-f]{32})/.exec(afterOutput)?.[1];
  const testRanchForeignRateLimits = /test_ranch_rate_limit_buckets_for_other_farms\|(\d+)\|([0-9a-f]{32})/.exec(afterOutput);
  const baseForeignRateLimits = /rate_limit_buckets_for_other_farms\|\d+\|([0-9a-f]{32})/.exec(sql(join(ROOT, "scripts/test-ranch/sql/isolation-baseline.sql"), { readOnly: true, variables: { test_farm_id: FARM_IDS[0], test_start: testStart } }))?.[1];
  const commitDetail = foreignChangeEvidence.commitTimestampStatus === "available" ? "no foreign row commits after baseline" : foreignChangeEvidence.commitTimestampStatus;
  assertStep(unchanged && foreignChangeEvidence.safe && Boolean(foreignRateLimits) && foreignRateLimits === baseForeignRateLimits &&
    testRanchForeignRateLimits?.[1] === "0",
    "foreign farm isolation SQL", `all foreign checksums unchanged; created/updated counts zero; ${commitDetail}`);
  report.foreignChecksums = unchanged && foreignChangeEvidence.safe && foreignRateLimits === baseForeignRateLimits && testRanchForeignRateLimits?.[1] === "0";

  const closedTickets = countQuery(`select count(*) from public.task_tickets where farm_id = ${quoteSql(FARM_IDS[0])} and status = 'closed';`);
  const openTickets = countQuery(`select count(*) from public.task_tickets where farm_id = ${quoteSql(FARM_IDS[0])} and status = 'open';`);
  const closedByVerification = countQuery(`select count(*) from public.task_tickets where farm_id = ${quoteSql(FARM_IDS[0])}
    and status = 'closed' and closed_at is not null and closed_via = 'worker_task_verification';`);
  assertStep(closedTickets === 1 && openTickets === 0 && closedByVerification === 1,
    "worker verification closes ticket", "one ticket closed by explicit worker confirmation");
  const capCount = countQuery(`select count from public.rate_limit_buckets where key = ${quoteSql(`test-ranch:${FARM_IDS[0]}:placements`)};`);
  assertStep(capCount === 4 && report.placements === 4, "four-call placement cap reached", "four mock placements recorded");

  writePrivate(join(tempDir, "approved-number.txt"), `${TEST_NUMBER}\n`);
  await restartNext({ engine: "scripted", manualCalls: true, demoCapTest: true });
  const fifthResponse = await appPost("/api/account", { op: "testCallReport" }, { authenticated: true });
  const fifthPayload = fifthResponse.status === 200 ? await fifthResponse.json() : null;
  const placements = await readPlacements();
  const updatedCap = countQuery(`select count from public.rate_limit_buckets where key = ${quoteSql(`test-ranch:${FARM_IDS[0]}:placements`)};`);
  const stoppedAtCap = fifthPayload?.ok === true && fifthPayload.data === "cap_reached";
  assertStep(stoppedAtCap && placements.length === 4 && updatedCap === 4, "fifth placement refused", "the provider received no fifth request and the durable count stayed at four");
  report.capPassed = true;
  report.testNumberOnly = placements.every((placement) => placement.To === TEST_NUMBER);
  assertStep(report.testNumberOnly, "all mock calls stayed on the test allowlist", "all four placements targeted the single test ranch number");
}

async function cleanup() {
  let failed = false;
  const attempt = async (operation) => {
    try { await operation(); } catch { failed = true; }
  };
  if (nextProcess) await attempt(() => stopProcess(nextProcess));
  await attempt(() => stopProcess(bridgeProcess));
  await attempt(() => stopProcess(proxyProcess));
  await attempt(() => stopProcess(stackProcess));
  if (tlsServer?.listening) await attempt(() => new Promise((resolveClose) => tlsServer.close(resolveClose)));
  if (mockSockets) {
    for (const socket of mockSockets.clients) socket.terminate();
    await attempt(() => new Promise((resolveClose) => mockSockets.close(resolveClose)));
  }
  if (mockServer?.wsServer) {
    for (const socket of mockServer.wsUpgrade?.clients ?? []) socket.terminate();
    await attempt(() => new Promise((resolveClose) => mockServer.wsUpgrade.close(resolveClose)));
    if (mockServer.wsServer.listening) await attempt(() => new Promise((resolveClose) => mockServer.wsServer.close(resolveClose)));
  }
  if (mockServer?.listening) await attempt(() => new Promise((resolveClose) => mockServer.close(resolveClose)));
  if (report.pgCtl && report.pgData) {
    await attempt(() => runCommand(report.pgCtl, ["-D", report.pgData, "-m", "immediate", "stop"], { cwd: ROOT, timeout: 20_000 }));
  }
  if (portsReservation) await attempt(() => portsReservation.close());
  try {
    if (nextWasMoved && existsSync(originalNext)) {
      const generated = join(ROOT, ".next");
      if (existsSync(generated)) {
        const rehearsalNext = join(tempDir, "rehearsal-next");
        renameSync(generated, rehearsalNext);
      }
      renameSync(originalNext, generated);
      nextWasMoved = false;
    } else if (!nextWasMoved && existsSync(join(ROOT, ".next")) && report.productionBuild) {
      const generated = join(ROOT, ".next");
      const rehearsalNext = join(tempDir, "rehearsal-next");
      renameSync(generated, rehearsalNext);
    }
  } catch { failed = true; }
  if (tempDir && !nextWasMoved) await attempt(() => rmSync(tempDir, { recursive: true, force: true }));
  report.cleanupFailed = failed;
  if (failed) throw new Error("cleanup_incomplete");
}

function evidenceMarkdown() {
  const rows = Array.isArray(report.steps) ? report.steps : [];
  const stepCount = countPassedSteps(rows);
  const status = rows.some((step) => step?.passed === false) || report.failed ? "FAIL" : "PASS";
  const steps = rows.map((step) => {
    const result = step?.passed ? "PASS" : "FAIL";
    const name = String(step?.name ?? "unknown_step");
    const detail = String(step?.detail ?? "").split("|").join("\\|");
    return "| " + result + " | " + name + " | " + detail + " |";
  }).join("\n");
  const startedAt = typeof report.startedAt === "string" ? report.startedAt : "unknown";
  const commit = typeof report.commit === "string" && report.commit ? report.commit : "unknown";
  const portRange = typeof report.portRange === "string" && report.portRange ? report.portRange : "55500–55599";
  const mockPlacements = Number.isInteger(report.placements) ? report.placements : 0;
  const isolation = report.foreignChecksums ? "foreign farm checksums matched" : "not proven";
  const cleanupState = report.cleanupPassed ? "all child processes stopped and temporary data removed" : "not confirmed";
  return [
    "# NAQAH local test-ranch rehearsal", "",
    "- Result: **" + status + "**",
    "- Steps: **" + stepCount.passed + "/" + stepCount.total + " passed**",
    "- Started: " + startedAt,
    "- Deployment: `127.0.0.1`; mode: `local`",
    "- Commit: `" + commit + "`",
    "- Local port range: " + portRange,
    "- Database: throwaway PostgreSQL; migrations applied through `20261113100000`, scheduler migration skipped",
    "- Provider boundary: Twilio REST and Realtime HTTP/WebSocket probes were redirected to local mocks; external provider fetches were blocked",
    "- Voice: report and worker calls used signed local Twilio webhooks; the owner summary used the realtime owner tools and signed bridge requests; no audio media was sent",
    "- Mock placements: " + mockPlacements + "; all four were checked against the single test-ranch destination without printing it",
    "- Isolation: " + isolation + "; read-only SQL ran under a local BYPASSRLS read-only role",
    "- Cleanup: " + cleanupState + "; original `.next` restored", "",
    "## Steps", "",
    "| Result | Step | Evidence |",
    "|---|---|---|",
    steps || "| FAIL | rehearsal | no steps completed |", "",
    "## Rerun", "",
    "`scripts/test-ranch/rehearse.sh`", "",
  ].join("\n");
}
async function runRehearsal() {
  await prepare();
  assertStep(report.ranchCount === 3 && report.userConfirmed === true, "local confirmed owner and three ranches seeded", "test ranch plus two other farms with due work");
  assertStep(report.productionBuild === true, "production build", "account mode enabled at build time");
  await prepareBaseline();
  assertStep(report.baselineReadOnly, "read-only isolation baseline", `${ISOLATION_TABLES.size} foreign table checksums captured`);
  await preflight();
  await bridgeSmoke();
  await runCallNow();
  await runOwnerSummary();
  await runWorkerManual("testCallWorkerInstruction", "worker_instruction", "manual worker instruction call");
  await runWorkerManual("testCallWorkerVerification", "worker_verify", "manual worker verification call");
  await checkIsolationAndCap();
}

async function writeEvidence() {
  let stage = "metadata";
  report.evidenceStage = stage;
  report.endedAt = new Date().toISOString();
  report.cleanupPassed = !report.cleanupFailed && processes.size === 0 && (!tempDir || !existsSync(tempDir)) && !nextWasMoved;
  if (report.cleanupPassed && !report.steps.some((step) => step.name === "cleanup")) record("cleanup", true, "processes stopped, temporary data removed, original build restored");
  else if (!report.cleanupPassed && !report.steps.some((step) => step.name === "cleanup")) record("cleanup", false, "cleanup incomplete");
  mkdirSync(EVIDENCE, { recursive: true, mode: 0o700 });
  const dateKey = report.startedAt.replaceAll(/[:.]/g, "-");
  stage = "render_markdown";
  report.evidenceStage = stage;
  const markdown = evidenceMarkdown();
  stage = "write_markdown";
  report.evidenceStage = stage;
  writePrivate(join(EVIDENCE, "REHEARSAL.md"), markdown);
  stage = "render_log";
  report.evidenceStage = stage;
  const log = report.steps.map((step) => `deployment=127.0.0.1 mode=local ${step.passed ? "PASS" : "FAIL"} ${step.name}${step.detail ? ` — ${step.detail}` : ""}`).join("\n") + "\n";
  stage = "write_log";
  report.evidenceStage = stage;
  writePrivate(join(EVIDENCE, `rehearsal-${dateKey}.log`), log);
  report.evidenceStage = "complete";
}

async function main() {
  try {
    await runRehearsal();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unclassified_error";
    report.failure = /^[a-z0-9_]+$/.test(message) ? message : "unclassified_error";
    if (!report.steps.some((step) => !step.passed)) record("stopped at " + currentStep, false, report.failure);
    report.failed = true;
    process.exitCode = 1;
  } finally {
    try { await cleanup(); } catch { report.failed = true; process.exitCode = 1; }
    try { await writeEvidence(); } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : "unknown";
      const name = error instanceof Error && /^[A-Za-z]+$/.test(error.name) ? error.name : "Unknown";
      process.stderr.write("evidence_write_failed " + (report.evidenceStage || "metadata") + " " + code + " " + name + "\n");
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
