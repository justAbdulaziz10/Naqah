export type NavigationIdentity =
  | { status: 'unknown' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; ownerId: string };

/** A failed validation is not evidence that the owner signed out. */
export function navigationIdentity({ user, unavailable }: { user: { id: string } | null; unavailable: boolean }): NavigationIdentity {
  return unavailable ? { status: 'unknown' } : user ? { status: 'signedIn', ownerId: user.id } : { status: 'signedOut' };
}

/** One observer per mounted navigation group, shared by desktop/mobile consumers. Hints only
 * trigger validation; only its result can resolve an unknown identity. */
export function createNavigationObserver({ observe, validate, now = Date.now }: {
  observe: (changed: (ownerId: string | null) => void) => () => void;
  validate: () => Promise<NavigationIdentity>;
  now?: () => number;
}) {
  const listeners = new Set<(identity: NavigationIdentity) => void>();
  let identity: NavigationIdentity = { status: 'unknown' };
  let hint: string | null | undefined;
  let stop: (() => void) | undefined;
  let version = 0;
  let pending = false;
  let attemptedAt = -Infinity;
  const publish = (next: NavigationIdentity) => {
    identity = next;
    listeners.forEach((listener) => listener(next));
  };
  const changed = (nextHint: string | null) => {
    const different = hint !== nextHint;
    if (!different && (identity.status !== 'unknown' || pending || now() - attemptedAt < 5_000)) return;
    hint = nextHint;
    const attempt = ++version;
    pending = true;
    attemptedAt = now();
    publish({ status: 'unknown' });
    // Never start SDK/server work inside Supabase's synchronous Auth callback.
    queueMicrotask(() => {
      if (attempt !== version || !listeners.size) return;
      void validate().catch((): NavigationIdentity => ({ status: 'unknown' })).then((next) => {
        if (attempt !== version || !listeners.size) return;
        pending = false;
        publish(next);
      });
    });
  };
  return {
    subscribe(initial: NavigationIdentity, listener: (identity: NavigationIdentity) => void) {
      const first = listeners.size === 0;
      if (first) {
        identity = initial;
        hint = initial.status === 'unknown' ? undefined : initial.status === 'signedIn' ? initial.ownerId : null;
        pending = false;
        attemptedAt = -Infinity;
      }
      listeners.add(listener);
      listener(identity);
      if (first) stop = observe(changed);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          ++version;
          stop?.();
          stop = undefined;
        }
      };
    },
  };
}
