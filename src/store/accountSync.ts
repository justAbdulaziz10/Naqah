/**
 * Account mode behind the workspace store. A signed-in owner's farm lives in Supabase, so screens
 * keep calling `update(fn)` and this sends the difference through owner actions, then takes the
 * server's copy. Local storage stays the demo's: nothing here reads it or writes to it.
 */
import type { Workspace } from "@/domain/types";
import { mergeEdits, ownerChanges, withServerIds, type OwnerChange } from "@/lib/account/changes";
import { normalizePhone } from "@/server/farm/input";
import { accountLink, useAccountState, useSaveStatus, useWorkspaceStore } from "./workspace";

const SAVE_DELAY_MS = 700;
const RETRY_DELAY_MS = 15_000;

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type SavedChanges = { workspace: Workspace; created: Record<string, string>; failed: string[] };

export interface AccountApi {
  open: () => Promise<Result<Workspace>>;
  load: () => Promise<Result<Workspace>>;
  /** `farm` is the farm these edits were made on: a session can change under an open tab. */
  save: (changes: OwnerChange[], farm: string) => Promise<Result<SavedChanges>>;
}

/** Fixing these takes the owner, so trying again on a timer would never end. */
const REFUSED = new Set(["invalid_input", "limit_reached"]);

const current = () => useWorkspaceStore.getState().workspace;
const setWorkspace = (workspace: Workspace | null) => useWorkspaceStore.setState({ workspace });
const setSave = (status: "idle" | "saved" | "failed") => useSaveStatus.setState({ status });

function typing(): boolean {
  if (typeof document === "undefined") return false;
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

/** Session cookies are readable, so an offline visitor who never signed in still gets the demo. */
function hasSession(): boolean {
  return typeof document !== "undefined" && /(^|;\s*)sb-[^=]*-auth-token/.test(document.cookie);
}

const halfTyped = (phone: string) => Boolean(phone.trim()) && !normalizePhone(phone);

/**
 * Takes the server's copy without disturbing the screen. The server trims and normalizes, which
 * must not rewrite a field mid-word, and a number still being typed has not been saved at all.
 */
function adopt(fresh: Workspace) {
  const local = current();
  const weather = local?.weather ?? fresh.weather; // Fetched by the browser, not stored.
  if (!local) return setWorkspace(fresh);
  const settings = { ...fresh.settings };
  if (typing()) {
    Object.assign(settings, {
      owner: local.settings.owner, farm: local.settings.farm, worker: local.settings.worker,
      window: local.settings.window, integrations: local.settings.integrations,
      customQuestions: fresh.settings.customQuestions.map((question) => ({
        ...question, text: local.settings.customQuestions.find((item) => item.id === question.id)?.text ?? question.text,
      })),
    });
  } else {
    if (halfTyped(local.settings.owner.phone)) settings.owner = { ...settings.owner, phone: local.settings.owner.phone };
    if (halfTyped(local.settings.worker.phone)) settings.worker = { ...settings.worker, phone: local.settings.worker.phone };
  }
  setWorkspace({ ...fresh, settings, weather });
}

export function createAccountSync(api: AccountApi) {
  let base: Workspace | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let opening = 0;
  let generation = 0;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = (delay: number) => {
    clearTimer();
    timer = setTimeout(() => void flush(), delay);
  };

  function close(status: "demo" | "signedOut" = "demo") {
    generation++;
    opening++;
    const wasActive = accountLink.active;
    if (wasActive) setWorkspace(null); // Still in account mode here, so this can't blank the demo's copy.
    accountLink.active = false;
    base = null;
    clearTimer();
    useAccountState.setState({ active: false, status, notice: null });
    if (wasActive) {
      setSave("idle");
      void useWorkspaceStore.persist.rehydrate();
    }
  }

  /** Takes a server copy. Another farm means another owner signed in: nothing here applies to it. */
  function receive(fresh: Workspace) {
    const before = base;
    const local = current();
    base = fresh;
    if (before && before.createdAt !== fresh.createdAt) {
      generation++;
      clearTimer();
      setSave("idle");
      useAccountState.setState({ notice: null });
      return setWorkspace(fresh);
    }
    if (before && local && ownerChanges(before, local).length) setWorkspace(mergeEdits(before, local, fresh));
    else adopt(fresh);
  }

  async function send() {
    const epoch = generation;
    const sent = current();
    if (!base || !sent) return;
    const before = base;
    const changes = ownerChanges(base, sent);
    if (!changes.length) {
      if (useSaveStatus.getState().status === "failed") setSave("saved");
      if (useAccountState.getState().notice === "refused") useAccountState.setState({ notice: null });
      return;
    }
    const result = await api.save(changes, base.createdAt).catch(() => ({ ok: false, error: "unavailable" }) as const);
    if (!accountLink.active || epoch !== generation) return;
    if (!result.ok) {
      if (result.error === "unauthenticated") return close("signedOut");
      if (result.error === "conflict") {
        // These edits belong to a previous farm. Never flush them while discovering the
        // current owner, and invalidate any queued flush/refresh from that generation.
        base = null;
        clearTimer();
        setWorkspace(null);
        setSave("idle");
        useAccountState.setState({ notice: null });
        return void reopen();
      }
      setSave("failed");
      return schedule(RETRY_DELAY_MS);
    }

    const { workspace: fresh, created, failed } = result.data;
    const latest = current();
    const untouched = latest === sent;
    if (latest && Object.keys(created).length) setWorkspace(withServerIds(latest, created));
    base = withServerIds(before, created);
    receive(fresh);
    const refused = failed.some((code) => REFUSED.has(code));
    useAccountState.setState({ notice: refused ? "refused" : null });
    if (failed.length) {
      setSave("failed");
      if (!refused) schedule(RETRY_DELAY_MS);
    } else if (untouched) {
      setSave("saved");
    } else {
      setSave("idle");
      schedule(SAVE_DELAY_MS);
    }
  }

  async function flush(): Promise<void> {
    const epoch = generation;
    clearTimer();
    while (saving) await saving;
    if (!accountLink.active || epoch !== generation) return;
    saving = send().finally(() => { saving = null; });
    return saving;
  }

  /** Plan is set by billing or the service, never from a screen, so a plan change is undone here. */
  function edited() {
    const local = current();
    if (base && local && local.settings.plan !== base.settings.plan) {
      setWorkspace({ ...local, settings: { ...local.settings, plan: base.settings.plan, window: base.settings.window } });
      useAccountState.setState({ notice: "plan" });
    }
    setSave("idle");
    schedule(SAVE_DELAY_MS);
  }
  accountLink.edited = edited;

  /** Runs on every entry, so a session that ended or changed never shows the last owner's farm. */
  async function reopen() {
    const attempt = ++opening;
    const epoch = ++generation;
    clearTimer();
    useAccountState.setState({ status: "checking" });
    // Discover whose farm this is BEFORE saving. A session can change in another tab.
    // Existing in-flight saves may finish, but their old-generation results are ignored.
    const result = await api.open().catch(() => ({ ok: false, error: "unavailable" }) as const);
    if (attempt !== opening || epoch !== generation) return;
    if (!result.ok) {
      if (result.error === "unauthenticated" || !hasSession()) return close();
      return useAccountState.setState({ status: "error" });
    }
    const sameFarm = accountLink.active && base?.createdAt === result.data.createdAt;
    if (sameFarm) {
      receive(result.data);
      // Keep normal setup/navigation saves, but only after confirming the same farm.
      await flush();
      if (attempt !== opening || epoch !== generation) return;
    } else {
      accountLink.active = true;
      base = result.data;
      setWorkspace(result.data);
      setSave("idle");
      useAccountState.setState({ notice: null });
    }
    useAccountState.setState({ active: true, status: "ready" });
  }

  return {
    flush,
    close,
    open: reopen,
    hasUnsaved() {
      const local = current();
      return Boolean(accountLink.active && (saving || (base && local && ownerChanges(base, local).length)));
    },

    /** Calls change the farm while the page is open, so screens pick that up here. */
    async refresh() {
      if (!accountLink.active || saving || timer || useAccountState.getState().status !== "ready") return;
      const epoch = generation;
      const before = current();
      const result = await api.load().catch(() => null);
      if (!result || !accountLink.active || epoch !== generation) return;
      if (!result.ok) {
        if (result.error === "unauthenticated") close("signedOut");
        return;
      }
      if (saving || timer || current() !== before) return;
      receive(result.data);
    },
  };
}
