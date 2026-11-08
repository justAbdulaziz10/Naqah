import { describe, expect, it } from "vitest";
import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import { ownerChanges, withServerIds } from "./changes";

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
