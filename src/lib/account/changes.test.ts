import { describe, expect, it } from "vitest";
import { PREDEFINED_QUESTIONS } from "@/domain/catalog";
import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
import type { QuestionPlanEntry, Workspace } from "@/domain/types";
import { mergeEdits, ownerChanges, unsentDrafts, withServerIds } from "./changes";

const base = (): Workspace => {
  const ws = createDemoWorkspace("en", "ultimate");
  return { ...ws, settings: { ...ws.settings, owner: { name: "Salem", phone: "+966501112222" }, worker: { ...ws.settings.worker, phone: "+966503334444" } } };
};
const withOwner = (ws: Workspace, name: string, phone = ws.settings.owner.phone): Workspace => ({ ...ws, settings: { ...ws.settings, owner: { name, phone } } });

describe("owner changes", () => {
  it("finds nothing when nothing an owner writes changed", () => {
    const ws = base();
    expect(ownerChanges(ws, ws)).toEqual([]);
    expect(ownerChanges(ws, withOwner(ws, "Salem  "))).toEqual([]);
  });

  it("never sends what calls own, so a simulated report can't reach a real farm", () => {
    const ws = base();
    const faked: Workspace = {
      ...ws,
      lastUpdateAt: "2026-01-01T00:00:00.000Z",
      reports: [{ id: "rep_1", at: "2026-01-01T00:00:00.000Z", callId: "c", answers: [], findings: [] }],
      taskTickets: [{ id: "t", instruction: "i", createdAt: "2026-01-01T00:00:00.000Z", scheduledFor: null, status: "open", closedAt: null, closedVia: null }],
      settings: { ...ws.settings, plan: "basic" },
    };
    expect(ownerChanges(ws, faked)).toEqual([]);
  });

  it("holds a half-typed phone and sends the rest of the form", () => {
    const ws = base();
    expect(ownerChanges(ws, withOwner(ws, "Faisal", "+9665"))).toEqual([{ kind: "profile", input: { ownerName: "Faisal" } }]);
  });

  it("sends a finished local number in its stored form, and only when it differs", () => {
    const ws = base();
    expect(ownerChanges(ws, withOwner(ws, "Salem", "0501112222"))).toEqual([]);
    expect(ownerChanges(ws, withOwner(ws, "Salem", "0509998888"))).toEqual([{ kind: "profile", input: { ownerPhone: "+966509998888" } }]);
  });

  it("holds a window that ends before it starts", () => {
    const ws = base();
    const next = { ...ws, settings: { ...ws.settings, window: { day: 1 as const, start: "18:00", end: "17:00" } } };
    expect(ownerChanges(ws, next)).toEqual([]);
  });

  it("sends only the camel fields that changed, so a newer report isn't overwritten", () => {
    const ws = base();
    const camel = ws.camels[0];
    const next = { ...ws, camels: ws.camels.map((c) => (c.id === camel.id ? { ...c, name: "Renamed" } : c)) };
    expect(ownerChanges(ws, next)).toEqual([{ kind: "camel", action: "update", id: camel.id, input: { name: "Renamed" } }]);
  });

  it("adds, removes and keeps provenance on a new camel", () => {
    const ws = base();
    const added = { id: "cml_new", name: "Noura", tag: "", sex: "female" as const, ageYears: null, health: "healthy" as const, healthNote: null, certainty: "verified" as const, updatedAt: "2026-01-01T00:00:00.000Z" };
    const changes = ownerChanges(ws, { ...ws, camels: [...ws.camels.slice(1), added] });
    expect(changes[0]).toEqual({ kind: "camel", action: "delete", id: ws.camels[0].id });
    expect(changes[1]).toMatchObject({ kind: "camel", action: "add", localId: "cml_new", input: { name: "Noura", certainty: "verified" } });
  });

  it("removes before it adds, so swapping a question fits Basic's limit", () => {
    const ws = createEmptyWorkspace("basic");
    const from = { ...ws, settings: { ...ws.settings, customQuestions: [{ id: "a", text: "Old?", createdAt: ws.createdAt }] } };
    const to = { ...ws, settings: { ...ws.settings, customQuestions: [{ id: "b", text: "New?", createdAt: ws.createdAt }] } };
    expect(ownerChanges(from, to).map((c) => "action" in c && c.action)).toEqual(["delete", "add"]);
  });

  it("marks setup finished last", () => {
    const ws = createEmptyWorkspace("basic");
    const next = { ...withOwner(ws, "Salem"), setupComplete: true };
    expect(ownerChanges(ws, next)).toEqual([
      { kind: "profile", input: { ownerName: "Salem" } },
      { kind: "profile", input: { setupComplete: true } },
    ]);
  });

  it("swaps a screen id for the stored one", () => {
    const ws = base();
    const id = ws.camels[0].id;
    expect(withServerIds(ws, { [id]: "stored" }).camels[0].id).toBe("stored");
  });
});

describe("owner flow changes", () => {
  it("adds a new worker before making it the primary, and removals come first", async () => {
    const { newWorker } = await import("@/domain/workers");
    const ws = base();
    const old = { ...newWorker("ar"), name: "Salem", phone: "+966507654321" };
    const before: Workspace = { ...ws, settings: { ...ws.settings, otherWorkers: [old] } };
    const added = { ...newWorker("en"), name: "Ahmed", phone: "0501234567" };
    const after: Workspace = { ...before, settings: { ...before.settings, worker: added, otherWorkers: [before.settings.worker] } };
    const changes = ownerChanges(before, after);
    expect(changes.map((c) => ("action" in c ? `${c.kind}:${c.action}` : c.kind))).toEqual(["worker:delete", "worker:add", "primaryWorker"]);
    expect(changes[1]).toMatchObject({ input: { name: "Ahmed", phone: "+966501234567", language: "en" } });
    expect(changes[2]).toEqual({ kind: "primaryWorker", id: added.id });
  });

  it("sends the call time and herd count, but not a half-typed time", () => {
    const ws = base();
    const next = (time: string): Workspace => ({ ...ws, settings: { ...ws.settings, callSchedule: { day: 4, time }, herdCount: 50 } });
    expect(ownerChanges(ws, next("17:30"))).toEqual([{ kind: "profile", input: { callSchedule: { day: 4, time: "17:30" }, herdCount: 50 } }]);
    expect(ownerChanges(ws, next("17:"))).toEqual([{ kind: "profile", input: { herdCount: 50 } }]);
  });

  it("does not send a blank new worker row until it has a name or number", async () => {
    const { newWorker } = await import("@/domain/workers");
    const ws = base();
    const blank: Workspace = { ...ws, settings: { ...ws.settings, otherWorkers: [...(ws.settings.otherWorkers ?? []), newWorker()] } };
    expect(ownerChanges(ws, blank)).toEqual([]);
  });

  it("keeps a half-typed phone as an unsent draft beside a sendable name change", () => {
    const ws = base();
    const next = { ...withOwner(ws, "Salem", "123"), settings: { ...withOwner(ws, "Salem", "123").settings, farm: { ...ws.settings.farm, name: "Al Nakheel" } } };
    expect(ownerChanges(ws, next)).toEqual([{ kind: "profile", input: { name: "Al Nakheel" } }]);
    expect(unsentDrafts(ws, next)).toEqual(["ownerPhone"]);
  });

  it("never sends a cleared ranch name and reports it as a draft", () => {
    const ws = base();
    const cleared: Workspace = { ...ws, settings: { ...ws.settings, farm: { ...ws.settings.farm, name: "  " } } };
    expect(ownerChanges(ws, cleared)).toEqual([]);
    expect(unsentDrafts(ws, cleared)).toEqual(["farmName"]);
  });

  it("reports a half-typed worker number, call time and herd count, and nothing once they are whole", () => {
    const ws = base();
    const typing: Workspace = {
      ...ws,
      settings: { ...ws.settings, worker: { ...ws.settings.worker, phone: "0501" }, callSchedule: { day: 4, time: "17:" }, herdCount: 4.5 },
    };
    expect(unsentDrafts(ws, typing)).toEqual([`worker:${ws.settings.worker.id}`, "callSchedule", "herdCount"]);
    const done: Workspace = { ...ws, settings: { ...ws.settings, worker: { ...ws.settings.worker, phone: "0501234567" }, callSchedule: { day: 4, time: "17:40" }, herdCount: 45 } };
    expect(unsentDrafts(ws, done)).toEqual([]);
  });

  describe("report mode and question plan", () => {
    const entry = (id: string, enabled = true, required = true) => ({ id, enabled, required });
    const silent = PREDEFINED_QUESTIONS.map((question) => entry(question.id, false));
    const noTasks = (): Workspace => {
      const ws = base();
      return { ...ws, taskTickets: [], settings: { ...ws.settings, customQuestions: [] } };
    };
    const planned = (ws: Workspace, questionPlan: QuestionPlanEntry[], reportMode = ws.settings.reportMode): Workspace => ({ ...ws, settings: { ...ws.settings, questionPlan, reportMode } });

    it("sends the mode and the plan as one change, after the questions it depends on", () => {
      const ws = noTasks();
      const next = planned({ ...ws, settings: { ...ws.settings, customQuestions: [{ id: "cq_new", text: "Vet?", createdAt: ws.createdAt }] } }, [entry("cq_new"), entry("herd_health", true, false)], "open");
      const changes = ownerChanges(ws, next);
      expect(changes.map((change) => change.kind)).toEqual(["question", "profile"]);
      expect(changes[1]).toEqual({ kind: "profile", input: { reportMode: "open", questionPlan: next.settings.questionPlan } });
    });
    it("keeps a plan with nothing to ask on the screen, flagged, and sends the rest", () => {
      const ws = noTasks();
      const next = planned(ws, silent, "open");
      expect(ownerChanges(ws, next)).toEqual([{ kind: "profile", input: { reportMode: "open" } }]);
      expect(unsentDrafts(ws, next)).toEqual(["questionPlan"]);
    });
    it("flags a question removal that empties the call, but not a farm already saved that way", () => {
      const ws = planned(noTasks(), [...silent, entry("cq_only")]);
      const withQuestion = { ...ws, settings: { ...ws.settings, customQuestions: [{ id: "cq_only", text: "Vet?", createdAt: ws.createdAt }] } };
      expect(unsentDrafts(withQuestion, ws)).toEqual(["questionPlan"]);
      expect(unsentDrafts(ws, ws)).toEqual([]);
    });
    it("swaps a screen id in the plan for the stored id", () => {
      const ws = planned(noTasks(), [entry("cq_new")]);
      expect(withServerIds(ws, { cq_new: "stored" }).settings.questionPlan).toEqual([entry("stored")]);
    });
    it("keeps edits still on their way when newer server data arrives, and takes the server's otherwise", () => {
      const ws = noTasks();
      const fresh = planned(ws, [entry("water_level")], "worker_choice");
      expect(mergeEdits(ws, ws, fresh).settings).toMatchObject({ reportMode: "worker_choice", questionPlan: [entry("water_level")] });
      const local = planned(ws, [entry("herd_health", false)], "open");
      expect(mergeEdits(ws, local, fresh).settings).toMatchObject({ reportMode: "open", questionPlan: [entry("herd_health", false)] });
    });
  });
});
