import { describe, expect, it } from "vitest";
import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
import type { Camel, FarmReport, Workspace } from "@/domain/types";
import { estateMatters, isHerdFinding, mentions } from "./matters";

const camel = (id: string, name: string, health: Camel["health"]): Camel => ({
  id, name, tag: "", sex: "female", ageYears: null, health, healthNote: null, certainty: "reported", updatedAt: null,
});
const finding = (id: string, en: string) => ({ id, criterionId: "c", text: { ar: en, en } });
const report = (findings: FarmReport["findings"]): FarmReport => ({ id: "r", at: "2026-11-05T14:00:00.000Z", callId: "c", answers: [], findings });
const task = (id: string, instruction: string): Workspace["taskTickets"][number] => ({
  id, instruction, createdAt: "2026-11-05T15:00:00.000Z", scheduledFor: null, status: "open", closedAt: null, closedVia: null,
});

describe("mentions", () => {
  it("matches whole names only", () => {
    expect(mentions("نقل ريم إلى الظل", "ريم")).toBe(true);
    expect(mentions("كريم نقلها", "ريم")).toBe(false);
    expect(mentions("Move Wadha — today", "wadha")).toBe(true);
  });
  it("never matches an empty name", () => expect(mentions("anything", "  ")).toBe(false));
});

describe("herd findings", () => {
  it("leads only herd criteria to the herd", () => {
    const ws = createDemoWorkspace("en", "ultimate");
    const of = (kind: string) => ws.settings.criteria.find((criterion) => criterion.kind === kind)!.id;
    expect(isHerdFinding(ws, { ...finding("a", "x"), criterionId: of("sick_camel") })).toBe(true);
    expect(isHerdFinding(ws, { ...finding("b", "x"), criterionId: of("missing_camel") })).toBe(true);
    expect(isHerdFinding(ws, { ...finding("c", "x"), criterionId: of("low_feed") })).toBe(false);
    expect(isHerdFinding(ws, finding("d", "x"))).toBe(false);
  });
});

describe("estate matters", () => {
  it("joins one camel's finding and task into one matter", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.camels = [camel("a", "Wadha", "watch"), camel("b", "Shula", "healthy")];
    ws.taskTickets = [task("t", "Move Wadha to the shade")];
    const matters = estateMatters(ws, report([finding("f", "Wadha is eating less")]));
    expect(matters).toHaveLength(1);
    expect(matters[0]).toMatchObject({ camel: { name: "Wadha" }, findings: [{ id: "f" }], instructions: [{ kind: "task", id: "t" }] });
  });
  it("keeps unnamed items as their own rows and loses nothing", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.taskTickets = [task("t", "Fix the east gate")];
    const matters = estateMatters(ws, report([finding("f", "Feed is low")]));
    expect(matters.map((m) => m.id)).toEqual(["f", "t"]);
  });
  it("puts a sick camel before one under watch", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.camels = [camel("a", "Wadha", "watch"), camel("b", "Shula", "sick")];
    expect(estateMatters(ws, null).map((m) => m.camel?.name)).toEqual(["Shula", "Wadha"]);
  });
  it("shows no task tickets on Basic", () => {
    const ws = createEmptyWorkspace("basic");
    ws.taskTickets = [task("t", "Fix the gate")];
    expect(estateMatters(ws, null)).toEqual([]);
  });
  it("shows no instructions on Basic, even from old rows", () => {
    const ws = createEmptyWorkspace("basic");
    ws.relays = [{ id: "r1", at: "2026-11-05T15:00:00.000Z", message: "Guests arrive Friday", delivered: false }];
    expect(estateMatters(ws, null)).toEqual([]);
  });
  it("includes undelivered instructions on Ultimate", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.relays = [{ id: "r1", at: "2026-11-05T15:00:00.000Z", message: "Guests arrive Friday", delivered: false }];
    expect(estateMatters(ws, null)[0].instructions[0]).toMatchObject({ kind: "relay", id: "r1" });
  });
  it("is empty on a calm day", () => expect(estateMatters(createEmptyWorkspace("ultimate"), null)).toEqual([]));
  it("groups the sample estate's Wadha story", () => {
    const ws = createDemoWorkspace("en", "ultimate");
    const matters = estateMatters(ws, ws.reports.at(-1) ?? null);
    expect(matters[0].findings.length).toBeGreaterThan(0);
    expect(matters[0].instructions.length).toBeGreaterThan(0);
  });
});
