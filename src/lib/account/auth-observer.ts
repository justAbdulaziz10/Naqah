import type { SupabaseClient } from "@supabase/supabase-js";

type Auth = Pick<SupabaseClient["auth"], "getSession" | "onAuthStateChange">;
const CHECK_MS = 1_000;

/** Local UI identity hint only. Server getOwner()/RLS remain the authorization boundary. */
export async function browserOwnerId(auth: Auth): Promise<string | null> {
  const { data, error } = await auth.getSession();
  if (error) throw new Error("Session identity unavailable");
  return data.session?.user.id ?? null;
}

/** SDK broadcasts cover client sign-in/out. Cookie-only server callbacks also need a local
 * check on focus/visibility and a short polling fallback. Never await SDK work in its callback. */
export function observeAccountAuth(auth: Auth, changed: (ownerId: string | null) => void): () => void {
  let disposed = false;
  let checking = false;
  let version = 0;
  const check = () => {
    if (checking || disposed) return;
    checking = true;
    const attempt = version;
    void browserOwnerId(auth).then((ownerId) => {
      if (!disposed && attempt === version) changed(ownerId);
    }).catch(() => { /* An outage is not a sign-out. Requests fail closed separately. */ })
      .finally(() => { checking = false; });
  };
  const { data } = auth.onAuthStateChange((_event, session) => {
    if (disposed) return;
    version++;
    changed(session?.user.id ?? null);
  });
  const timer = setInterval(check, CHECK_MS);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
  check();
  return () => {
    disposed = true;
    clearInterval(timer);
    data.subscription.unsubscribe();
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", check);
  };
}
