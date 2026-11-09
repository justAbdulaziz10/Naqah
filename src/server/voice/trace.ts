import { appendFileSync, closeSync, constants, fchmodSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallSession } from "@/domain/conversation/engine";

const cleaned = new Set<string>();
const under = (directory: string, root: string) => directory.startsWith(root + path.sep);

export function traceDirectory(): string | null {
  try {
    if (!process.env.NAQAH_CALL_TRACE_DIR || process.env.VERCEL !== undefined) return null;
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (!["http:", "https:"].includes(url.protocol) || !/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(url.hostname)) return null;
    const root = realpathSync(os.tmpdir());
    const requested = path.resolve(process.env.NAQAH_CALL_TRACE_DIR);
    let ancestor = requested;
    const suffix: string[] = [];
    while (true) {
      try { realpathSync(ancestor); break; } catch {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) return null;
        suffix.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
    const resolved = path.join(realpathSync(ancestor), ...suffix);
    return under(resolved, root) ? resolved : null;
  } catch {
    return null;
  }
}

export function traceCall(callSid: string, input: { session: CallSession; tool: string; args: unknown; workerUtterance: string; resultStatus: string; spokenText: string }): void {
  try {
    const directory = traceDirectory();
    if (!directory || !/^CA[0-9a-f]{32}$/i.test(callSid)) return;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (realpathSync(directory) !== directory) return;
    if (!cleaned.has(directory)) {
      for (const name of readdirSync(directory)) {
        if (!/^CA[0-9a-f]{32}\.jsonl$/i.test(name)) continue;
        const file = path.join(directory, name);
        const stat = lstatSync(file);
        if (stat.isFile() && stat.mtimeMs < Date.now() - 24 * 60 * 60 * 1000) unlinkSync(file);
      }
      cleaned.add(directory);
    }
    const questionId = input.session.data.queue?.[input.session.data.reportIndex ?? 0]?.id ?? input.session.data.currentQuestionId ?? null;
    const record = { time: new Date().toISOString(), step: input.session.step, questionId, tool: input.tool, args: input.args, workerUtterance: input.workerUtterance, resultStatus: input.resultStatus, spokenText: input.spokenText };
    const descriptor = openSync(path.join(directory, callSid + ".jsonl"), constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    try {
      fchmodSync(descriptor, 0o600);
      appendFileSync(descriptor, JSON.stringify(record) + "\n", "utf8");
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return;
  }
}
