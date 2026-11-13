#!/usr/bin/env node
// LOCAL ONLY. Imitates the Supabase API gateway for browser and server tests: /rest/v1/* proxies to a
// local PostgREST, /auth/v1/* is a small in-memory stand-in for the Auth server. Sessions and passwords
// live in memory, so a restart signs everyone out. Started by run-stack.sh. Never point this at a real project.
//
//   node mock-gateway.mjs            serve (needs the env below)
//   node mock-gateway.mjs mint anon  print a long-lived JWT for a role (anon or service_role)
//
// Env: NAQAH_TEST_JWT_SECRET, NAQAH_TEST_GATEWAY_PORT, NAQAH_TEST_POSTGREST, NAQAH_TEST_DB and the PG* variables.
import { execFile } from "node:child_process";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";

const SECRET = process.env.NAQAH_TEST_JWT_SECRET ?? "";
if (!SECRET.startsWith("local-only-") || SECRET.length < 32) {
  console.error('Refusing to start: NAQAH_TEST_JWT_SECRET must start with "local-only-" and have 32+ characters.');
  process.exit(2);
}

const TOKEN_TTL_SECONDS = Number(process.env.NAQAH_TEST_TOKEN_TTL ?? 3600);
const REFRESH_REUSE_MS = 10_000; // Supabase's default refresh-token reuse interval.
const LOOPBACK = /^(localhost|127(\.\d+){3}|\[::1\]|::1)$/;

const base64url = (value) => Buffer.from(value).toString("base64url");
const hmac = (input) => createHmac("sha256", SECRET).update(input).digest();

function signJwt(claims) {
  const input = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  return `${input}.${hmac(input).toString("base64url")}`;
}

function verifyJwt(token) {
  const [header, payload, signature, extra] = String(token).split(".");
  if (!header || !payload || !signature || extra !== undefined) return null;
  try {
    if (JSON.parse(Buffer.from(header, "base64url")).alg !== "HS256") return null;
    const expected = hmac(`${header}.${payload}`);
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    return typeof claims.exp === "number" && claims.exp > Date.now() / 1000 ? claims : null;
  } catch { return null; }
}

if (process.argv[2] === "mint") {
  const role = process.argv[3];
  if (role !== "anon" && role !== "service_role") { console.error("Usage: mint anon|service_role"); process.exit(2); }
  // Fixed dates keep the keys identical across runs, so a `next build` that inlined them stays valid.
  console.log(signJwt({ iss: "supabase", ref: "local", role, iat: 1_700_000_000, exp: 2_000_000_000 }));
  process.exit(0);
}

const PORT = Number(process.env.NAQAH_TEST_GATEWAY_PORT);
const REST = new URL(process.env.NAQAH_TEST_POSTGREST ?? "http://invalid");
const DB = process.env.NAQAH_TEST_DB ?? "";
const PGHOST = process.env.PGHOST || "127.0.0.1";
if (!Number.isInteger(PORT) || PORT <= 0) { console.error("Refusing to start: set NAQAH_TEST_GATEWAY_PORT."); process.exit(2); }
if (!LOOPBACK.test(REST.hostname)) { console.error("Refusing to start: NAQAH_TEST_POSTGREST must be a loopback URL."); process.exit(2); }
if (!LOOPBACK.test(PGHOST)) { console.error(`Refusing non-loopback PostgreSQL host: ${PGHOST}`); process.exit(2); }
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(DB)) { console.error("Refusing to start: set NAQAH_TEST_DB."); process.exit(2); }

const usersById = new Map(); // id -> { user, password }
const usersByEmail = new Map(); // email -> id
const sessions = new Map(); // session id -> user id
const refreshTokens = new Map(); // token -> { sessionId, usedAt }

const issueRefreshToken = (sessionId) => {
  const token = randomBytes(16).toString("hex");
  refreshTokens.set(token, { sessionId, usedAt: null });
  return token;
};

function sessionResponse(user, sessionId, refreshToken) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TOKEN_TTL_SECONDS;
  const access_token = signJwt({
    iss: `http://127.0.0.1:${PORT}/auth/v1`, sub: user.id, aud: "authenticated", role: "authenticated",
    email: user.email, phone: "", app_metadata: user.app_metadata, user_metadata: user.user_metadata,
    aal: "aal1", amr: [{ method: "password", timestamp: now }], session_id: sessionId, is_anonymous: false,
    iat: now, exp: expiresAt,
  });
  return { access_token, token_type: "bearer", expires_in: TOKEN_TTL_SECONDS, expires_at: expiresAt, refresh_token: refreshToken, user };
}

/** The signed-in user behind the bearer token, or null. The session must still exist, as on real Auth. */
function authenticate(req) {
  const match = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "");
  const claims = match ? verifyJwt(match[1]) : null;
  if (!claims || claims.role !== "authenticated") return { error: "bad_jwt", message: "invalid JWT" };
  const entry = usersById.get(claims.sub);
  if (!entry) return { error: "user_not_found", message: "User from sub claim in JWT does not exist" };
  if (sessions.get(claims.session_id) !== claims.sub) return { error: "session_not_found", message: "Session from session_id claim in JWT does not exist" };
  return { user: entry.user, sessionId: claims.session_id };
}

function corsHeaders(req) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
    "access-control-expose-headers": "*",
    "access-control-max-age": "3600",
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" });
  res.end(JSON.stringify(body));
}

const sendAuthError = (res, status, code, msg) => sendJson(res, status, { code, error_code: code, msg });

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function insertAuthUser(id) {
  return new Promise((resolve, reject) => {
    // The id comes from randomUUID, never from the request. PG* variables pick the server.
    execFile("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", `insert into auth.users (id) values ('${id}')`],
      { env: { ...process.env, PGHOST } }, (error, _stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve()));
  });
}

async function handleTestUsers(req, res) {
  // Requiring JSON forces a CORS preflight, and this route has none, so web pages cannot reach it.
  if (req.method !== "POST" || !req.headers["content-type"]?.startsWith("application/json")) return sendJson(res, 405, { msg: "POST JSON only" });
  const { email, password } = await readJson(req);
  if (typeof email !== "string" || !email.includes("@") || typeof password !== "string" || !password) {
    return sendAuthError(res, 422, "validation_failed", "email and password are required");
  }
  const key = email.trim().toLowerCase();
  if (usersByEmail.has(key)) return sendAuthError(res, 422, "email_exists", "A user with this email address has already been registered");
  const id = randomUUID();
  await insertAuthUser(id);
  const now = new Date().toISOString();
  const user = {
    id, aud: "authenticated", role: "authenticated", email: key, email_confirmed_at: now, phone: "",
    confirmed_at: now, last_sign_in_at: now, app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {}, identities: [], created_at: now, updated_at: now, is_anonymous: false,
  };
  usersById.set(id, { user, password });
  usersByEmail.set(key, id);
  sendJson(res, 201, user);
}

async function handleToken(req, res, grantType) {
  if (req.method !== "POST") return sendJson(res, 405, { msg: "POST only" });
  const body = await readJson(req);
  if (grantType === "password") {
    const entry = usersById.get(usersByEmail.get(String(body.email ?? "").trim().toLowerCase()));
    if (!entry || entry.password !== body.password) return sendAuthError(res, 400, "invalid_credentials", "Invalid login credentials");
    const sessionId = randomUUID();
    sessions.set(sessionId, entry.user.id);
    return sendJson(res, 200, sessionResponse(entry.user, sessionId, issueRefreshToken(sessionId)));
  }
  if (grantType === "refresh_token") {
    const record = refreshTokens.get(body.refresh_token);
    const userId = record && sessions.get(record.sessionId);
    const entry = userId && usersById.get(userId);
    if (!entry) return sendAuthError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
    if (record.usedAt && Date.now() - record.usedAt > REFRESH_REUSE_MS) {
      return sendAuthError(res, 400, "refresh_token_already_used", "Invalid Refresh Token: Already Used");
    }
    record.usedAt ??= Date.now();
    return sendJson(res, 200, sessionResponse(entry.user, record.sessionId, issueRefreshToken(record.sessionId)));
  }
  sendAuthError(res, 400, "unsupported_grant_type", `Unsupported grant_type: ${grantType}`);
}

function handleLogout(req, res, scope) {
  if (req.method !== "POST") return sendJson(res, 405, { msg: "POST only" });
  const current = authenticate(req);
  if (!current.user) return sendAuthError(res, 401, current.error, current.message);
  for (const [sessionId, userId] of sessions) {
    if (userId !== current.user.id) continue;
    const isCurrent = sessionId === current.sessionId;
    if (scope === "global" || (scope === "local" && isCurrent) || (scope === "others" && !isCurrent)) sessions.delete(sessionId);
  }
  res.writeHead(204).end();
}

async function handleAuth(req, res, url) {
  const path = url.pathname.slice("/auth/v1".length);
  if (path === "/.well-known/jwks.json") return sendJson(res, 200, { keys: [] });
  if (path === "/token") return handleToken(req, res, url.searchParams.get("grant_type"));
  if (path === "/logout") return handleLogout(req, res, url.searchParams.get("scope") ?? "global");
  if (path === "/user" && req.method === "GET") {
    const current = authenticate(req);
    return current.user ? sendJson(res, 200, current.user) : sendAuthError(res, 401, current.error, current.message);
  }
  sendAuthError(res, 404, "not_implemented", `The local gateway does not implement ${req.method} ${url.pathname}`);
}

function proxyToRest(req, res, url) {
  const headers = { ...req.headers, host: REST.host };
  delete headers.connection;
  const upstream = http.request({
    hostname: REST.hostname, port: REST.port, method: req.method, headers,
    path: `${url.pathname.slice("/rest/v1".length) || "/"}${url.search}`,
  }, (response) => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on("error", (error) => {
    if (res.headersSent) return res.destroy();
    sendJson(res, 502, { message: `PostgREST is unreachable: ${error.message}` });
  });
  req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://gateway.local");
  const isRest = url.pathname === "/rest/v1" || url.pathname.startsWith("/rest/v1/");
  const isAuth = url.pathname.startsWith("/auth/v1/");
  try {
    if (url.pathname === "/__test/users") return await handleTestUsers(req, res);
    if (!isRest && !isAuth) return sendJson(res, 404, { msg: "Not found" });
    for (const [name, value] of Object.entries(corsHeaders(req))) res.setHeader(name, value);
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (isRest) return proxyToRest(req, res, url);
    await handleAuth(req, res, url);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    sendJson(res, error instanceof SyntaxError ? 400 : 500, { msg: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`NAQAH mock gateway on http://127.0.0.1:${PORT}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
