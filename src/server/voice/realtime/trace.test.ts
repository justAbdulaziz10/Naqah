import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallSession } from "@/domain/conversation/engine";
import { traceCall, traceDirectory } from "../trace";

const CALL = "CA" + "a".repeat(32);
const OLD_CALL = "CA" + "b".repeat(32);
const session = { step: "report_question", data: { reportIndex: 0, queue: [{ id: "feed_level" }] } } as CallSession;
const entry = { session, tool: "answer_question", args: { text: "12", topic: "feed" }, workerUtterance: "twelve bags of feed", resultStatus: "ok", spokenText: "Is that twelve bags?" };
let root: string;
let directory: string;

beforeEach(() => {
  root = mkdtempSync(path.join(process.cwd(), "src/server/voice/realtime/.trace-test-"));
  directory = path.join(root, "transcripts");
  vi.spyOn(os, "tmpdir").mockReturnValue(root);
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("NAQAH_CALL_TRACE_DIR", directory);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54399");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("local transcript trace gates", () => {
  it.each([undefined, ""])("does nothing unless explicitly enabled (%s)", (value) => {
    vi.stubEnv("NAQAH_CALL_TRACE_DIR", value);
    traceCall(CALL, entry);
    expect(traceDirectory()).toBeNull();
    expect(existsSync(directory)).toBe(false);
  });

  it.each(["1", "", "0"])("never writes when VERCEL is set, even to %j", (value) => {
    vi.stubEnv("VERCEL", value);
    traceCall(CALL, entry);
    expect(traceDirectory()).toBeNull();
    expect(existsSync(directory)).toBe(false);
  });

  it.each([undefined, "", "not a url", "https://example.supabase.co", "http://127.0.0.1.example.com", "ftp://localhost"])("requires a loopback service Supabase URL (%s)", (url) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    traceCall(CALL, entry);
    expect(traceDirectory()).toBeNull();
    expect(existsSync(directory)).toBe(false);
  });

  it.each(["http://localhost:54399", "http://127.0.0.1:54399", "http://127.0.0.2:54399", "http://[::1]:54399"])("allows only the local trace for %s", (url) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NODE_ENV", "production");
    expect(traceDirectory()).toBe(directory);
    traceCall(CALL, entry);
    expect(existsSync(path.join(directory, CALL + ".jsonl"))).toBe(true);
  });

  it.each(["root", "sibling", "traversal", "symlink"])("rejects a directory that does not resolve below tmpdir: %s", (kind) => {
    const outside = process.cwd();
    if (kind === "symlink") symlinkSync(outside, path.join(root, "escape"));
    const candidate = kind === "root" ? root : kind === "sibling" ? root + "-sibling" : kind === "traversal" ? path.join(root, "..", "escape") : path.join(root, "escape", "transcripts");
    vi.stubEnv("NAQAH_CALL_TRACE_DIR", candidate);
    expect(traceDirectory()).toBeNull();
    expect(() => traceCall(CALL, entry)).not.toThrow();
  });

  it("writes per-call JSONL privately and deletes only expired trace files on the first write", () => {
    mkdirSync(directory);
    const old = path.join(directory, OLD_CALL + ".jsonl");
    const other = path.join(directory, "keep.txt");
    writeFileSync(old, "old");
    writeFileSync(other, "keep");
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(old, yesterday, yesterday);
    traceCall(CALL, entry);
    traceCall(CALL, { ...entry, resultStatus: "invalid" });
    const file = path.join(directory, CALL + ".jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ time: expect.any(String), step: "report_question", questionId: "feed_level", tool: entry.tool, args: entry.args, workerUtterance: entry.workerUtterance, resultStatus: "ok", spokenText: entry.spokenText });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(old)).toBe(false);
    expect(readFileSync(other, "utf8")).toBe("keep");
  });

  it("does not follow transcript-file symlinks or throw failures into the call", () => {
    mkdirSync(directory);
    const protectedFile = path.join(root, "protected.txt");
    writeFileSync(protectedFile, "keep");
    symlinkSync(protectedFile, path.join(directory, CALL + ".jsonl"));
    expect(() => traceCall(CALL, entry)).not.toThrow();
    expect(readFileSync(protectedFile, "utf8")).toBe("keep");
    expect(() => traceCall("../escape", entry)).not.toThrow();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => traceCall(OLD_CALL, { ...entry, args: circular })).not.toThrow();
  });
});
