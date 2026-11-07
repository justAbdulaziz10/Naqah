import { after } from "next/server";

/**
 * Run follow-up work (a paid notification) after the response is sent, so the caller never
 * waits on it. Outside a Next request scope (tests, direct calls) it runs now, capped at 4 s.
 */
export async function afterResponse(task: () => Promise<unknown>): Promise<void> {
  try {
    after(task);
    return;
  } catch {
    // Direct Route Handler calls and non-Next hosts have no Next request scope.
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task().catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 4_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
