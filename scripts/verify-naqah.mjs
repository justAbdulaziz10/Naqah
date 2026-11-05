#!/usr/bin/env node
// NAQAH verification CLI. JSON on stdout; nonzero exit when a check fails.
// Usage: node scripts/verify-naqah.mjs <launch|doctor|screens|call-lab|wizard|features|stop> [--base URL] [--port N] [--locale ar|en]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i > 0 ? args[i + 1] : dflt; };
const PORT = Number(opt("port", process.env.VERIFY_PORT ?? 3210));
const BASE = opt("base", `http://localhost:${PORT}`);
const LOCALE = opt("locale", "en");
const STATE = ".verify-naqah.json";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const out = (obj) => { console.log(JSON.stringify(obj, null, 2)); process.exit(obj.ok ? 0 : 1); };
const fail = (reason, extra = {}) => out({ ok: false, cmd, reason, ...extra });

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  const p = dir && join(root, dir, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
  return p && existsSync(p) ? p : undefined;
}
async function browser() {
  const { chromium } = await import("@playwright/test");
  const executablePath = chromiumPath();
  return chromium.launch(executablePath ? { executablePath } : {});
}
async function answers(url) { try { const r = await fetch(url, { redirect: "manual" }); return r.status; } catch { return 0; } }
const evidenceDir = (feature) => { const d = `artifacts/verify/${feature}/${STAMP}`; mkdirSync(d, { recursive: true }); return d; };
const readWs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("naqah-workspace-v1") ?? "null")?.state?.workspace ?? null);

async function startDemo(page, locale, plan = "ultimate") {
  await page.goto(`${BASE}/${locale}/app`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: locale === "ar" ? "جرّب العرض الحي" : "Explore the live demo" }).first().click();
  await page.waitForFunction(() => !!localStorage.getItem("naqah-workspace-v1")?.includes('"setupComplete":true'), null, { timeout: 10_000 });
  if (plan !== "ultimate") throw new Error("only the ultimate sample is started by the gate button");
}

/** Answer a Lab call by clicking quick replies (preferring `pref`) or filling inputs, until no input is offered. */
async function driveCall(page, pref, transcript) {
  const area = page.locator("div.border-t").filter({ has: page.locator("button") }).last();
  const skip = /End call|Start preview|Close preview|Send|إنهاء|بدء التجربة|إغلاق|إرسال/i;
  let idle = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1600);
    const names = (await area.locator("button").allInnerTexts()).map((s) => s.trim()).filter((s) => s && !skip.test(s));
    if (names.length) {
      idle = 0;
      const pick = names.find((n) => pref?.test(n)) ?? names[0];
      transcript.push(pick);
      await area.locator("button").filter({ hasText: pick }).first().click();
      continue;
    }
    const input = area.locator("input");
    if (await input.count()) {
      const type = await input.getAttribute("type");
      const value = type === "number" ? "20" : type === "time" ? "16:00" : "Move Wadha to the shade";
      transcript.push(`[${type}] ${value}`);
      await input.fill(value);
      await area.getByRole("button", { name: /Send|إرسال/ }).click();
      continue;
    }
    // A reply can take longer than one poll; only stop after three quiet polls.
    if (++idle >= 3) return;
  }
  throw new Error("call did not finish within 60 polls");
}

const commands = {
  async launch() {
    if (await answers(`${BASE}/en`)) return fail(`port ${PORT} already answers; refusing to drive a server this run did not start`, { hint: "use doctor, or pass --port" });
    if (!args.includes("--no-build")) {
      const b = spawn("npm", ["run", "build"], { stdio: ["ignore", "pipe", "pipe"] });
      let log = ""; b.stdout.on("data", (d) => (log += d)); b.stderr.on("data", (d) => (log += d));
      const code = await new Promise((r) => b.on("close", r));
      if (code !== 0) return fail("npm run build failed", { tail: log.split("\n").slice(-25) });
    }
    const child = spawn("npx", ["next", "start", "-p", String(PORT)], { detached: true, stdio: "ignore" });
    child.unref();
    for (let i = 0; i < 60 && !(await answers(`${BASE}/en`)); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await answers(`${BASE}/en`))) return fail("server did not answer within 30s", { pid: child.pid });
    const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
    writeFileSync(STATE, JSON.stringify({ pid: child.pid, port: PORT, buildId }));
    out({ ok: true, cmd, pid: child.pid, base: BASE, buildId });
  },
  async doctor() {
    const status = await answers(`${BASE}/en`);
    const local = BASE.startsWith("http://localhost");
    const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null;
    const problems = [];
    if (status !== 200) problems.push(`GET /en returned ${status}`);
    if (local) {
      if (!state || state.port !== PORT) problems.push("no launch record for this port (not started by verify-naqah launch)");
      else {
        try { process.kill(state.pid, 0); } catch { problems.push(`launched pid ${state.pid} is not running`); }
        const now = existsSync(".next/BUILD_ID") ? readFileSync(".next/BUILD_ID", "utf8").trim() : null;
        if (now !== state.buildId) problems.push("build changed since launch; relaunch");
      }
    }
    if (!chromiumPath() && !process.env.CHROMIUM_PATH) problems.push("no cached Playwright Chromium found (set CHROMIUM_PATH or run npx playwright install chromium-headless-shell)");
    out({ ok: problems.length === 0, cmd, base: BASE, status, launch: state, problems });
  },
  async screens() {
    const dir = evidenceDir("screens");
    const env = { ...process.env, BASE, OUT: dir, CHROMIUM_PATH: chromiumPath() ?? "" };
    const c = spawn("node", ["scripts/qa-screens.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let log = ""; c.stdout.on("data", (d) => (log += d)); c.stderr.on("data", (d) => (log += d));
    const code = await new Promise((r) => c.on("close", r));
    const shots = readdirSync(dir).filter((f) => f.endsWith(".png")).length;
    const ok = code === 0 && /NO PROBLEMS/.test(log) && shots === 32;
    out({ ok, cmd, evidence: dir, shots, expectedShots: 32, reason: ok ? undefined : "overflow/console errors or missing screenshots", log: log.trim().split("\n").slice(-20) });
  },
  async "call-lab"() {
    const dir = evidenceDir("call-lab");
    const b = await browser();
    const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const checks = []; const transcript = [];
    const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
    try {
      await startDemo(page, LOCALE);
      const before = await readWs(page);
      await page.goto(`${BASE}/${LOCALE}/app/lab`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: LOCALE === "ar" ? "بدء التجربة" : "Start preview" }).click();
      await driveCall(page, /needs attention|تحتاج|^Sick$|^مريضة$|^No, that|^لا، بس|Running low|قارب/, transcript);
      let ws = await readWs(page);
      check("report saved", ws.reports.length === before.reports.length + 1, `${before.reports.length} → ${ws.reports.length}`);
      const newReport = ws.reports.length > before.reports.length ? ws.reports.at(-1) : null;
      check("new report has the sick-camel finding", newReport?.findings?.length > 0, newReport ? newReport.findings.length : "no new report");
      await page.screenshot({ path: `${dir}/1-worker-report.png`, fullPage: true });

      const tasksBeforeOwner = ws.taskTickets.length;
      await page.getByRole("button", { name: /Continue to owner call|متابعة اتصال المالك/ }).click();
      await driveCall(page, /^Answer$|^رد$|Yes, I do|نعم|A task|مهمة/, transcript);
      ws = await readWs(page);
      const newTask = ws.taskTickets.length === tasksBeforeOwner + 1 ? ws.taskTickets.find((t) => t.status === "open" && /Wadha|وضحة/.test(t.instruction ?? t.message ?? "")) : null;
      check("owner instruction opened a task ticket", newTask, `tickets ${tasksBeforeOwner} → ${ws.taskTickets.length}`);
      const pending = ws.pendingWorkerCalls.filter((c) => c.state === "pending");
      check("worker call queued", pending.length > 0, pending.length);
      await page.screenshot({ path: `${dir}/2-owner-call.png`, fullPage: true });

      await page.getByRole("button", { name: /Continue to .*call|متابعة اتصال/ }).click();
      await driveCall(page, /^No answer$|^ما رد$|^Skip 20 minutes$|^تجاوز 20 دقيقة$/, transcript);
      ws = await readWs(page);
      const tickets = ws.noAnswerTickets.filter((t) => t.status !== "closed").length;
      check("4 missed attempts open a No Answer ticket", tickets > 0, `open no-answer tickets ${tickets}`);
      check("call marked no_answer_ticket", ws.pendingWorkerCalls.some((c) => c.state === "no_answer_ticket"));
      const text = await page.locator("main").innerText();
      check("transcript states the ticket", /No Answer Ticket|تذكرة/.test(text));
      await page.screenshot({ path: `${dir}/3-no-answer.png`, fullPage: true });

      // Worker returns the missed call: delivers the message, closes the ticket, is not a farm update.
      const reportsBefore = ws.reports.length;
      await page.goto(`${BASE}/${LOCALE}/app/lab`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: LOCALE === "ar" ? "بدء التجربة" : "Start preview" }).click();
      await driveCall(page, /Yes|إيه|نعم|^Completed$|تم/, transcript);
      ws = await readWs(page);
      check("callback closes the No Answer ticket", ws.noAnswerTickets.every((t) => t.status === "closed"), ws.noAnswerTickets.map((t) => t.status));
      check("callback is not a farm update", ws.reports.length === reportsBefore, `${reportsBefore} → ${ws.reports.length}`);
      await page.screenshot({ path: `${dir}/4-callback.png`, fullPage: true });
    } catch (e) {
      check("drive completed", false, String(e.message ?? e).split("\n")[0]);
    }
    check("no page errors", errors.length === 0, errors);
    await b.close();
    writeFileSync(`${dir}/transcript.json`, JSON.stringify({ transcript, checks }, null, 2));
    const failed = checks.filter((c) => !c.pass);
    out({ ok: failed.length === 0, cmd, base: BASE, locale: LOCALE, evidence: dir, checks, reason: failed.length ? failed.map((c) => c.name).join("; ") : undefined });
  },
  async wizard() {
    const dir = evidenceDir("wizard");
    const b = await browser();
    const page = await b.newPage({ viewport: { width: 390, height: 844 } });
    const steps = []; let reason;
    try {
      await page.goto(`${BASE}/${LOCALE}/start`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: LOCALE === "ar" ? /عينة|نموذج/ : /sample/i }).first().click();
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(500);
        if (page.url().includes("/app")) break;
        steps.push(await page.locator("#current-step-title").innerText());
        const next = page.getByRole("button", { name: LOCALE === "ar" ? /^(متابعة|تأكيد)/ : /^(Continue|Confirm)/ }).last();
        if (!(await next.isEnabled())) { reason = `Continue disabled on "${steps.at(-1)}"`; break; }
        await next.click();
      }
      await page.waitForURL(/\/app$/, { timeout: 5000 });
      await page.screenshot({ path: `${dir}/dashboard.png`, fullPage: true });
    } catch (e) { reason ??= String(e.message ?? e).split("\n")[0]; }
    const ws = await readWs(page).catch(() => null);
    await b.close();
    const ok = !reason && ws?.setupComplete === true && steps.length === 9;
    out({ ok, cmd, evidence: dir, steps: steps.length, setupComplete: ws?.setupComplete ?? null, reason: ok ? undefined : reason ?? `expected 9 steps + setupComplete, got ${steps.length}` });
  },
  async features() {
    const dir = evidenceDir("features");
    const b = await browser();
    const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    const checks = []; const transcript = [];
    const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
    const ar = LOCALE === "ar";
    const step = async (name, fn) => {
      try { await fn(); } catch (e) { check(name, false, String(e.message ?? e).split("\n")[0]); }
      await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true }).catch(() => {});
    };
    const pickScenario = async (en, arName, startCall = true) => {
      await page.goto(`${BASE}/${LOCALE}/app/lab`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: ar ? arName : en }).first().click();
      if (!startCall) return;
      await page.getByRole("button", { name: ar ? "بدء التجربة" : "Start preview" }).click();
    };
    // Landing: plan CTA starts that plan's sample farm and opens /app.
    await step("landing-plan-cta", async () => {
      await page.goto(`${BASE}/${LOCALE}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: ar ? "جرّب الأساسية في العرض" : "Try Basic in the demo" }).first().click();
      await page.waitForURL(new RegExp(`/${LOCALE}/app$`), { timeout: 10000 });
      check("Try Basic opens /app on the Basic plan", (await readWs(page))?.settings?.plan === "basic");
    });
    // Locale switch keeps the path.
    await step("locale-switch", async () => {
      await page.goto(`${BASE}/${LOCALE}/app/herd`, { waitUntil: "networkidle" });
      const other = ar ? "en" : "ar";
      await page.locator(`a[href="/${other}/app/herd"]`).first().click();
      await page.waitForURL(new RegExp(`/${other}/app/herd$`), { timeout: 10000 });
      check("language switch keeps the path", true, page.url());
    });
    // Settings: load the Ultimate sample (the rest of this run needs it).
    await step("settings-load-ultimate", async () => {
      await page.goto(`${BASE}/${LOCALE}/app/settings`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: ar ? "تحميل مزرعة متكاملة تجريبية" : "Load sample Ultimate farm" }).click();
      await page.waitForTimeout(300);
      check("settings loads the Ultimate sample", (await readWs(page))?.settings?.plan === "ultimate");
    });
    // Herd: add a camel through the dialog.
    await step("herd-add", async () => {
      const before = (await readWs(page)).camels.length;
      await page.goto(`${BASE}/${LOCALE}/app/herd`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: ar ? "إضافة ناقة" : "Add camel" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(ar ? "الاسم" : "Name", { exact: false }).first().fill("Verify");
      await dialog.getByLabel(ar ? /الوسم/ : "Tag", { exact: false }).first().fill("VF-0001");
      await dialog.getByRole("button", { name: ar ? "حفظ" : "Save" }).click();
      await page.waitForTimeout(300);
      const ws = await readWs(page);
      check("herd add camel", ws.camels.length === before + 1 && ws.camels.some((c) => c.name === "Verify"), `${before} → ${ws.camels.length}`);
    });
    // Demo clock: +20 min moves clockOffsetMs.
    await step("lab-clock", async () => {
      await page.goto(`${BASE}/${LOCALE}/app/lab`, { waitUntil: "networkidle" });
      const before = (await readWs(page)).clockOffsetMs;
      await page.getByRole("button", { name: ar ? "+20 دقيقة" : "+20 min" }).click();
      await page.waitForTimeout(300);
      const after = (await readWs(page)).clockOffsetMs;
      check("clock +20 min", after - before === 20 * 60 * 1000, `${before} → ${after}`);
    });
    // Owner inquiry: a finished call is logged.
    await step("lab-owner-inquiry", async () => {
      const before = (await readWs(page)).calls.length;
      await pickScenario("Owner calls NAQAH", "المالك يتصل بناقة");
      await driveCall(page, /^No|^لا/, transcript);
      const after = (await readWs(page)).calls.length;
      check("owner inquiry logs a call", after === before + 1, `${before} → ${after}`);
    });
    // Emergency: info only, nothing saved.
    await step("lab-emergency", async () => {
      const before = JSON.stringify((await readWs(page)).calls);
      await pickScenario("Emergency", "حالة طارئة", false);
      await page.waitForTimeout(1600);
      const text = await page.locator("main").innerText();
      check("emergency says the worker calls the owner directly", /Emergency calls go directly to the owner|اتصالات الطوارئ تذهب للمالك مباشرة/.test(text));
      check("emergency saves nothing", JSON.stringify((await readWs(page)).calls) === before);
    });
    // Settings: Reset demo (window.confirm) clears the workspace. Last, because it wipes state.
    await step("settings-reset", async () => {
      await page.goto(`${BASE}/${LOCALE}/app/settings`, { waitUntil: "networkidle" });
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: ar ? "إعادة ضبط العرض" : "Reset demo" }).click();
      await page.waitForTimeout(500);
      check("settings Reset demo clears the workspace", (await readWs(page)) === null);
    });
    check("no page errors", errors.length === 0, errors);
    await b.close();
    writeFileSync(`${dir}/transcript.json`, JSON.stringify({ transcript, checks }, null, 2));
    const failed = checks.filter((c) => !c.pass);
    out({ ok: failed.length === 0, cmd, base: BASE, locale: LOCALE, evidence: dir, checks, reason: failed.length ? failed.map((c) => c.name).join("; ") : undefined });
  },
  async stop() {
    if (!existsSync(STATE)) return out({ ok: true, cmd, note: "nothing launched by verify-naqah" });
    const { pid } = JSON.parse(readFileSync(STATE, "utf8"));
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
    rmSync(STATE);
    out({ ok: true, cmd, stopped: pid });
  },
};

if (!commands[cmd] || args.includes("--help")) {
  console.log(`verify-naqah <command> [--port 3210] [--base URL] [--locale en|ar]
  launch [--no-build]  build, start next on --port, record pid (refuses if the port is busy)
  doctor               read-only: our server answers, same build, Chromium available
  screens              32 screenshots (ar/en × 375/1440 × 8 pages); fails on overflow or console errors
  call-lab             worker report → owner call → task → 4 missed calls → No Answer ticket → callback closes it (asserted)
  wizard               onboarding with sample data, 9 steps, lands on /app with setupComplete
  features             landing plan CTA, locale switch, settings sample load, herd add, clock, owner inquiry, emergency, reset
  stop                 stop only the server this tool launched`);
  process.exit(cmd ? 0 : 1);
}
commands[cmd]().catch((e) => fail(String(e?.message ?? e).split("\n")[0]));
