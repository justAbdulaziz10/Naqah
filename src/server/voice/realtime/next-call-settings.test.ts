/**
 * What the owner saves on the website takes effect on the very next call, with no restart:
 * the worker number "Call now" dials, and the topics a natural call asks and accepts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { start } from "@/domain/conversation/engine";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import type { Workspace } from "@/domain/types";
import { toDbId } from "@/server/db/ids";
import { recordingCaller } from "@/server/calls/twilio";
import { demoHistory, demoSettings } from "../../../../scripts/demo/presentation-ranch";
import { NOW } from "./saudi-cases";
import { buildNaturalInstructions, naturalTools, replayAnswers } from "./natural";

vi.mock("server-only", () => ({}));

/** One farm held in memory; runFarmAction applies the pure action to it like the database would. */
const store = vi.hoisted(() => ({ ws: null as unknown as Workspace }));
vi.mock("@/server/db/service-repository", () => ({
  listScheduledFarmIds: async () => [],
  runFarmAction: async (_client: unknown, _farm: string, action: (ws: Workspace) => { ws: Workspace; result: unknown }) => {
    const { ws, result } = action(structuredClone(store.ws));
    store.ws = { ...ws, reportCalls: ws.reportCalls?.map((run) => ({ ...run, id: toDbId(FARM, run.id) })) };
    return { status: "saved", result };
  },
}));
const FARM = "11111111-1111-4111-8111-111111111111";
const { requestReportCallNow } = await import("@/server/calls/scheduler");

const OLD = "+966501234567";
const NEW = "+966500000071";

/** The ranch as the owner left it, with no report call yet. */
function ranch(): Workspace {
  return { ...demoSettings(NOW, { workerPhone: OLD }), reportCalls: [] };
}

/** What a Settings save stores: the number as typed, spaces included. */
function savePhone(ws: Workspace, phone: string): Workspace {
  return { ...ws, settings: { ...ws.settings, worker: { ...ws.settings.worker, phone } } };
}

describe("worker phone saved in Settings", () => {
  beforeEach(() => {
    vi.stubEnv("NAQAH_VOICE_SECRET", "unit-test-voice-secret-at-least-32-bytes");
    store.ws = ranch();
  });

  it("dials exactly the new number on the next call, never the old one", async () => {
    store.ws = savePhone(store.ws, "+966 50 000 0071");
    const { caller, requests } = recordingCaller();
    const result = await requestReportCallNow({} as never, caller, FARM, { baseUrl: "https://naqah.test", now: NOW, allowlist: [OLD, NEW] });
    expect(result).toEqual({ status: "placed" });
    expect(requests.map((request) => request.to)).toEqual([NEW]);
    expect(requests.some((request) => request.to === OLD)).toBe(false);
  });

  it("blocks the new number when it is not on the allowlist, and places no call", async () => {
    store.ws = savePhone(store.ws, "+966 50 000 0071");
    const { caller, requests } = recordingCaller();
    const result = await requestReportCallNow({} as never, caller, FARM, { baseUrl: "https://naqah.test", now: NOW, allowlist: [OLD] });
    expect(result).toEqual({ status: "blocked", reason: "not_allowed" });
    expect(requests).toHaveLength(0);
    expect(store.ws.reportCalls).toEqual([]);
  });
});

/** The session the engine opens for an answered report call on this workspace. */
function opened(ranchWs: Workspace) {
  const call = startReportCall(ranchWs, NOW, "manual");
  const ws = resolveReportCallAttempt(placeReportCallAttempt(call.ws, NOW, call.run!.id).ws, NOW, call.run!.id, true).ws;
  return { ws, session: start(ws, NOW, "report_call", { reportCallId: call.run!.id }).session };
}

const history = () => demoHistory(demoSettings(NOW), NOW, { endYesterday: true });
const queueIds = (session: ReturnType<typeof opened>["session"]) => (session.data.queue ?? []).map((item) => item.id);
const enumOf = (session: ReturnType<typeof opened>["session"], ws: Workspace) => {
  const submit = naturalTools(session, ws).find((entry) => entry.name === "submit_report") as unknown as {
    parameters: { properties: { answers: { items: { properties: { question_id: { enum: string[] } } } } } };
  };
  return submit.parameters.properties.answers.items.properties.question_id.enum;
};
const setEnabled = (ws: Workspace, id: string, enabled: boolean): Workspace => ({
  ...ws,
  settings: { ...ws.settings, questionPlan: ws.settings.questionPlan.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)) },
});

describe("topics saved in Settings", () => {
  it("asks only the enabled questions, plus open tasks, in the saved order", () => {
    const base = history();
    const { ws, session } = opened(base);
    const enabled = base.settings.questionPlan.filter((entry) => entry.enabled).map((entry) => entry.id);
    const questions = queueIds(session).filter((id) => !id.startsWith("task_") && !id.startsWith("open_note_"));
    expect(questions).toEqual(enabled);
    expect(enumOf(session, ws).filter((id) => !id.startsWith("task_"))).toEqual(enabled);

    const text = buildNaturalInstructions(session, ws, "ar");
    const positions = enabled.map((id) => text.indexOf(`[${id}]`));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("leaves disabled questions out of the instructions and the submit_report enum", () => {
    const base = history();
    const { ws, session } = opened(base);
    const disabledCustom = base.settings.customQuestions[0];
    const disabled = ["herd_count", "shelter_condition", "medicine_stock", disabledCustom.id];
    for (const id of disabled) expect(base.settings.questionPlan.find((entry) => entry.id === id)?.enabled).toBe(false);
    const text = buildNaturalInstructions(session, ws, "ar");
    const ids = enumOf(session, ws);
    for (const id of disabled) {
      expect(text).not.toContain(`[${id}]`);
      expect(ids).not.toContain(id);
    }
    expect(text).not.toContain(disabledCustom.text);
  });

  it("drops a question switched off since the last call, and brings back one switched on", () => {
    const before = history();
    expect(enumOf(opened(before).session, opened(before).ws)).toContain("water_level");

    const off = setEnabled(setEnabled(before, "water_level", false), "medicine_stock", true);
    const { ws, session } = opened(off);
    const text = buildNaturalInstructions(session, ws, "ar");
    expect(text).not.toContain("[water_level]");
    expect(enumOf(session, ws)).not.toContain("water_level");
    expect(text).toContain("[medicine_stock]");
    expect(enumOf(session, ws)).toContain("medicine_stock");

    const back = opened(setEnabled(off, "water_level", true));
    expect(buildNaturalInstructions(back.session, back.ws, "ar")).toContain("[water_level]");
    expect(enumOf(back.session, back.ws)).toContain("water_level");
  });

  it("follows a reordered plan on the next call", () => {
    const base = history();
    const plan = [...base.settings.questionPlan];
    const feed = plan.findIndex((entry) => entry.id === "feed_level");
    const water = plan.findIndex((entry) => entry.id === "water_level");
    [plan[feed], plan[water]] = [plan[water], plan[feed]];
    const { ws, session } = opened({ ...base, settings: { ...base.settings, questionPlan: plan } });
    const ids = queueIds(session);
    expect(ids.indexOf("water_level")).toBeLessThan(ids.indexOf("feed_level"));
    const text = buildNaturalInstructions(session, ws, "ar");
    expect(text.indexOf("[water_level]")).toBeLessThan(text.indexOf("[feed_level]"));
  });
});

describe("answers for a disabled question", () => {
  it("are never recorded, even when the model sends them", () => {
    const base = history();
    const { ws, session } = opened(base);
    const disabledCustom = base.settings.customQuestions[0];
    const given = queueIds(session).map((id) => {
      if (id === "herd_health") return { question_id: id, value: "yes" };
      if (id === "feed_level" || id === "water_level" || id === "fences_condition") return { question_id: id, value: "good" };
      if (id.startsWith("task_")) return { question_id: id, value: "yes" };
      return { question_id: id, text: "ما فيه شي" };
    });
    const replayed = replayAnswers(session, ws, NOW, {
      answers: [...given, { question_id: "medicine_stock", value: "critical" }, { question_id: "herd_count", number: 3 }, { question_id: disabledCustom.id, text: "عشرين لتر" }],
    });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    const recorded = replayed.session.draft.answers.map((entry) => entry.questionId);
    for (const id of ["medicine_stock", "herd_count", disabledCustom.id]) expect(recorded).not.toContain(id);
    expect(JSON.stringify(replayed.session.draft)).not.toContain("عشرين لتر");
    expect(replayed.session.draft.herdCount ?? null).toBeNull();
  });
});

describe("the owner's order for their own questions", () => {
  it("keeps an owner question where it was saved; only open tasks move, before trailing owner questions", async () => {
    const { buildNaturalInstructions } = await import("./natural");
    const { start } = await import("@/domain/conversation/engine");
    const { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } = await import("@/domain/reportCalls");
    const { demoHistory, demoSettings } = await import("../../../../scripts/demo/presentation-ranch");
    const { NOW } = await import("./saudi-cases");
    const ws = demoHistory(demoSettings(NOW), NOW, { endYesterday: true });
    const [milk, , other] = ws.settings.customQuestions;
    ws.settings.questionPlan = [
      { id: milk.id, enabled: true, required: true },
      { id: "herd_health", enabled: true, required: true },
      { id: "feed_level", enabled: true, required: true },
      { id: other.id, enabled: true, required: true },
      // Settings saves every question; the rest are off.
      ...["herd_count", "water_level", "fences_condition", "shelter_condition", "medicine_stock"].map((id) => ({ id, enabled: false, required: true })),
      { id: ws.settings.customQuestions[1].id, enabled: false, required: true },
    ];
    const opened = startReportCall(ws, NOW, "manual");
    const live = resolveReportCallAttempt(placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws, NOW, opened.run!.id, true).ws;
    const text = buildNaturalInstructions(start(live, NOW, "report_call", { reportCallId: opened.run!.id }).session, live, "ar");
    const order = [...text.matchAll(/^\d+\. \[([^\]]+)\]/gm)].map((match) => match[1]);
    const at = (id: string) => order.findIndex((entry) => entry.startsWith(id));
    expect(at(milk.id)).toBe(0);
    expect(at("herd_health")).toBe(1);
    expect(at("task_")).toBeLessThan(at(other.id));
    expect(at("feed_level")).toBeLessThan(at("task_"));
  });
});
