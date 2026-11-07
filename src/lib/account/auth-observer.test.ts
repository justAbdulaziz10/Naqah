import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserOwnerId, observeAccountAuth } from "./auth-observer";

type Auth = Parameters<typeof observeAccountAuth>[0];
const session = (id: string | null) => id ? { user: { id } } : null;
function setup() {
  let owner: string | null = "owner-a";
  let notify!: (event: string, value: ReturnType<typeof session>) => void;
  const unsubscribe = vi.fn();
  const getSession = vi.fn(async () => ({ data: { session: session(owner) }, error: null }));
  const auth = {
    getSession,
    onAuthStateChange(callback: typeof notify) { notify = callback; return { data: { subscription: { unsubscribe } } }; },
  } as unknown as Auth;
  const changed = vi.fn();
  const stop = observeAccountAuth(auth, changed);
  return { auth, changed, stop, getSession, unsubscribe, setOwner: (id: string | null) => { owner = id; }, notify: (id: string | null) => notify("SIGNED_IN", session(id)) };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", new EventTarget());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("account Auth observation (mock SDK, no providers)", () => {
  it("handles cross-tab auth events synchronously without calling the SDK inside its callback", async () => {
    const state = setup();
    await vi.advanceTimersByTimeAsync(0);
    state.getSession.mockClear();
    state.notify("owner-b");
    expect(state.changed).toHaveBeenLastCalledWith("owner-b");
    expect(state.getSession).not.toHaveBeenCalled();
    state.notify(null);
    expect(state.changed).toHaveBeenLastCalledWith(null);
    state.stop();
  });
  it("detects cookie-only server callbacks in another tab within the polling interval", async () => {
    const state = setup();
    await vi.advanceTimersByTimeAsync(0);
    state.setOwner("owner-b");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.changed).toHaveBeenLastCalledWith("owner-b");
    state.stop();
  });
  it.each(["focus", "visibilitychange"])("checks immediately on %s", async (event) => {
    const state = setup();
    await vi.advanceTimersByTimeAsync(0);
    state.setOwner("owner-b");
    (event === "focus" ? window : document).dispatchEvent(new Event(event));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.changed).toHaveBeenLastCalledWith("owner-b");
    state.stop();
  });
  it("does not let an old session probe overwrite a newer SDK event", async () => {
    const state = setup();
    await vi.advanceTimersByTimeAsync(0);
    let finish!: (reply: Awaited<ReturnType<typeof state.getSession>>) => void;
    state.getSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    window.dispatchEvent(new Event("focus"));
    state.notify("owner-b");
    finish({ data: { session: session("owner-a") }, error: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.changed).toHaveBeenLastCalledWith("owner-b");
    state.stop();
  });
  it("unsubscribes, cancels polling, and ignores a late session probe after unmount", async () => {
    const state = setup();
    state.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    state.notify("owner-b");
    window.dispatchEvent(new Event("focus"));
    expect(state.changed).not.toHaveBeenCalled();
    expect(state.getSession).toHaveBeenCalledTimes(1);
    expect(state.unsubscribe).toHaveBeenCalledTimes(1);
  });
  it("does not interpret a session-read failure as signed out", async () => {
    const state = setup();
    await vi.advanceTimersByTimeAsync(0);
    state.changed.mockClear();
    state.getSession.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.changed).not.toHaveBeenCalled();
    await expect(browserOwnerId({ ...state.auth, getSession: async () => ({ error: new Error("private detail"), data: { session: null } }) } as Auth)).rejects.toThrow("Session identity unavailable");
    state.stop();
  });
});
