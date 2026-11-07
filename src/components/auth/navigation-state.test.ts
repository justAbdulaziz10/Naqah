import { describe, expect, it, vi } from 'vitest';
import { createNavigationObserver, navigationIdentity, type NavigationIdentity } from './navigation-state';

const unknown: NavigationIdentity = { status: 'unknown' };
const signedOut: NavigationIdentity = { status: 'signedOut' };
const signedIn: NavigationIdentity = { status: 'signedIn', ownerId: 'a' };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function setup() {
  let changed!: (id: string | null) => void;
  let time = 0;
  const stop = vi.fn();
  const observe = vi.fn((callback: typeof changed) => { changed = callback; return stop; });
  const validate = vi.fn(async (): Promise<NavigationIdentity> => signedOut);
  const store = createNavigationObserver({ observe, validate, now: () => time });
  return { store, observe, stop, validate, changed: (id: string | null) => changed(id), advance: () => { time += 5_000; } };
}
describe('shared navigation observation (mocked validation)', () => {
  it('preserves unavailable even if a stale user is present', () => {
    expect(navigationIdentity({ user: { id: 'stale' }, unavailable: true })).toEqual(unknown);
  });
  it('shares one SDK observer, polling source and validation across desktop/mobile and cleans up the last consumer', async () => {
    const s = setup(); const desktop = vi.fn(); const mobile = vi.fn();
    const leaveDesktop = s.store.subscribe(signedIn, desktop);
    const leaveMobile = s.store.subscribe(signedIn, mobile);
    expect(s.observe).toHaveBeenCalledOnce();
    s.changed('a'); await tick();
    expect(s.validate).not.toHaveBeenCalled(); // Server-validated initial identity is reused.
    s.changed(null);
    expect(desktop).toHaveBeenLastCalledWith(unknown);
    expect(mobile).toHaveBeenLastCalledWith(unknown);
    expect(s.validate).not.toHaveBeenCalled(); // Outside the synchronous SDK callback.
    await tick();
    expect(s.validate).toHaveBeenCalledOnce();
    expect(desktop).toHaveBeenLastCalledWith(signedOut);
    expect(mobile).toHaveBeenLastCalledWith(signedOut);
    leaveDesktop(); expect(s.stop).not.toHaveBeenCalled();
    leaveMobile(); expect(s.stop).toHaveBeenCalledOnce();
  });
  it('does not convert unknown to signed out from a local null hint when server validation fails', async () => {
    const s = setup(); const listener = vi.fn(); s.validate.mockResolvedValue(unknown);
    s.store.subscribe(unknown, listener);
    s.changed(null); await tick();
    expect(listener.mock.calls.every(([value]) => value.status === 'unknown')).toBe(true);
    s.changed(null); await tick(); expect(s.validate).toHaveBeenCalledOnce();
    s.advance(); s.validate.mockResolvedValue(signedOut); s.changed(null); await tick();
    expect(s.validate).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(signedOut);
  });
  it('keeps exceptions unknown, then resolves a validated cross-tab sign-in', async () => {
    const s = setup(); const listener = vi.fn();
    s.validate.mockRejectedValueOnce(new Error('unavailable'));
    s.store.subscribe(signedOut, listener); s.changed('a'); await tick();
    expect(listener).toHaveBeenLastCalledWith(unknown);
    s.advance(); s.validate.mockResolvedValue(signedIn); s.changed('a'); await tick();
    expect(listener).toHaveBeenLastCalledWith(signedIn);
  });
  it('discards late validation results after a newer identity hint', async () => {
    const s = setup(); const listener = vi.fn();
    let finish!: (identity: NavigationIdentity) => void;
    s.validate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    s.store.subscribe(signedOut, listener); s.changed('a'); await tick();
    s.changed(null); await tick();
    expect(listener).toHaveBeenLastCalledWith(signedOut);
    finish(signedIn); await tick();
    expect(listener).toHaveBeenLastCalledWith(signedOut);
  });
  it('invalidates pending validation when all controls unmount and a new server snapshot mounts', async () => {
    const s = setup(); const oldListener = vi.fn(); const newListener = vi.fn();
    let finish!: (identity: NavigationIdentity) => void;
    s.validate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const leave = s.store.subscribe(signedIn, oldListener); s.changed(null); await tick(); leave();
    s.store.subscribe(signedOut, newListener); finish(signedIn); await tick();
    expect(newListener).toHaveBeenLastCalledWith(signedOut);
    expect(s.observe).toHaveBeenCalledTimes(2);
  });
});
