/**
 * Account mode behind the workspace store. A signed-in owner's farm lives in Supabase, so screens
 * keep calling `update(fn)` and this sends the difference through owner actions, then takes the
 * server's copy. Local storage stays the demo's: nothing here reads it or writes to it.
 */
import type { Workspace } from "@/domain/types";
import { isAccountWorkspace, type AccountWorkspace } from "@/lib/account/types";
import { create } from "zustand";
import { mergeEdits, ownerChanges, unsentDrafts, withServerIds, type OwnerChange } from "@/lib/account/changes";
import { normalizePhone } from "@/server/farm/input";
import { accountLink, useAccountState, useSaveStatus, useWorkspaceStore } from "./workspace";

const SAVE_DELAY_MS = 700;
const RETRY_DELAY_MS = 15_000;

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type SavedChanges = { workspace: AccountWorkspace; created: Record<string, string>; failed: string[] };

export interface AccountIdentity {
  /** Local session hint used to reject stale UI results, never server authorization. */
  getOwnerId: () => Promise<string | null>;
}

export interface AccountApi {
  open: () => Promise<Result<AccountWorkspace>>;
  load: () => Promise<Result<AccountWorkspace>>;
  /** Stable farm UUID these edits belong to; only a stale-edit precondition, never authorization. */
  save: (changes: OwnerChange[], farm: string) => Promise<Result<SavedChanges>>;
}

/** Fixing these takes the owner, so trying again on a timer would never end. */
const REFUSED = new Set(["invalid_input", "limit_reached"]);

/**
 * Edits on the screen that can't be sent yet (see `unsentDrafts`). Kept apart from the save status:
 * a section is only "saved" when nothing it shows is still waiting here.
 */
export const useUnsentDrafts = create<{ fields: string[] }>(() => ({ fields: [] }));
const setDrafts = (fields: string[]) => {
  const before = useUnsentDrafts.getState().fields;
  if (before.length !== fields.length || before.some((field, index) => field !== fields[index])) useUnsentDrafts.setState({ fields });
};

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
      otherWorkers: local.settings.otherWorkers, herdCount: local.settings.herdCount,
      window: local.settings.window, callSchedule: local.settings.callSchedule, integrations: local.settings.integrations,
      customQuestions: fresh.settings.customQuestions.map((question) => ({
        ...question, text: local.settings.customQuestions.find((item) => item.id === question.id)?.text ?? question.text,
      })),
    });
  } else {
    if (halfTyped(local.settings.owner.phone)) settings.owner = { ...settings.owner, phone: local.settings.owner.phone };
    if (!local.settings.farm.name.trim()) settings.farm = { ...settings.farm, name: local.settings.farm.name }; // Flagged on screen, not sent.
    if (halfTyped(local.settings.worker.phone)) settings.worker = { ...settings.worker, phone: local.settings.worker.phone };
    settings.otherWorkers = settings.otherWorkers?.map((worker) => {
      const mine = local.settings.otherWorkers?.find((item) => item.id === worker.id);
      return mine && halfTyped(mine.phone) ? { ...worker, phone: mine.phone } : worker;
    });
  }
  setWorkspace({ ...fresh, settings, weather });
}

export function createAccountSync(api: AccountApi, identity: AccountIdentity) {
  let base: AccountWorkspace | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let opening = 0;
  let generation = 0;
  let ownerId: string | null | undefined;
  let authVersion = 0;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const trackDrafts = () => {
    const local = current();
    setDrafts(accountLink.active && base && local ? unsentDrafts(base, local) : []);
  };
  const schedule = (delay: number) => {
    clearTimer();
    timer = setTimeout(() => void flush(), delay);
  };

  function discard() {
    generation++;
    clearTimer();
    base = null;
    saving = null; // The old request may finish, but must not block or mark the new owner's saves.
    // Keep persistence blocked until the new owner's result or a confirmed sign-out.
    if (accountLink.active) setWorkspace(null);
    setSave("idle");
    setDrafts([]);
    useAccountState.setState({ status: "checking", notice: null });
  }

  function changeIdentity(next: string | null, reopenAfterChange: boolean) {
    if (ownerId === next) return;
    const initial = ownerId === undefined;
    ownerId = next;
    const version = ++authVersion;
    if (initial) {
      if (reopenAfterChange) queueMicrotask(() => { if (version === authVersion) void reopen(); });
      return;
    }
    discard();
    if (next === null) return close("signedOut");
    if (reopenAfterChange) queueMicrotask(() => {
      if (version === authVersion) void reopen();
    });
  }

  async function identityNow(reopenAfterChange: boolean) {
    const version = authVersion;
    try {
      const currentOwner = await identity.getOwnerId();
      if (version !== authVersion) return null; // A newer auth event wins over an old probe.
      changeIdentity(currentOwner, reopenAfterChange);
      return { ownerId: currentOwner, authVersion };
    } catch { return null; } // Cannot establish a current identity: adopt nothing.
  }

  async function accepts(request: { generation: number; ownerId: string | null; authVersion: number }, fresh?: AccountWorkspace) {
    if (!isCurrent(request)) return false;
    const currentIdentity = await identityNow(true);
    if (!currentIdentity || request.generation !== generation || request.authVersion !== authVersion || request.ownerId !== currentIdentity.ownerId) return false;
    if (fresh && (!isAccountWorkspace(fresh) || fresh.ownerId !== request.ownerId)) {
      discard();
      useAccountState.setState({ status: "error" });
      return false;
    }
    return true;
  }

  function isCurrent(request: { generation: number; ownerId: string | null; authVersion: number }) {
    return request.generation === generation && request.authVersion === authVersion && request.ownerId === ownerId;
  }

  function close(status: "demo" | "signedOut" = "demo") {
    generation++;
    opening++;
    const wasActive = accountLink.active;
    if (wasActive) setWorkspace(null); // Still in account mode here, so this can't blank the demo's copy.
    accountLink.active = false;
    base = null;
    saving = null;
    clearTimer();
    setDrafts([]);
    useAccountState.setState({ active: false, status, notice: null });
    if (wasActive) {
      setSave("idle");
      void useWorkspaceStore.persist.rehydrate();
    }
  }

  /** Takes a server copy. Another farm means another owner signed in: nothing here applies to it. */
  function receive(fresh: AccountWorkspace) {
    const before = base;
    const local = current();
    base = fresh;
    if (before && (before.farmId !== fresh.farmId || before.ownerId !== fresh.ownerId)) {
      generation++;
      clearTimer();
      setSave("idle");
      useAccountState.setState({ notice: null });
      return setWorkspace(fresh);
    }
    if (before && local && ownerChanges(before, local).length) setWorkspace(mergeEdits(before, local, fresh));
    else adopt(fresh);
    trackDrafts();
  }

  async function send() {
    const epoch = generation;
    const initiatingIdentity = await identityNow(true);
    if (!initiatingIdentity || epoch !== generation) {
      if (!initiatingIdentity && epoch === generation && accountLink.active) { setSave("failed"); schedule(RETRY_DELAY_MS); }
      return;
    }
    const request = { ...initiatingIdentity, generation: epoch };
    const sent = current();
    if (!base || !sent) return;
    if (base.ownerId !== initiatingIdentity.ownerId || !isAccountWorkspace(sent) || sent.farmId !== base.farmId || sent.ownerId !== base.ownerId) return;
    const before = base;
    const changes = ownerChanges(base, sent);
    trackDrafts();
    if (!changes.length) {
      if (useSaveStatus.getState().status === "failed") setSave("saved");
      if (useAccountState.getState().notice === "refused") useAccountState.setState({ notice: null });
      return;
    }
    const result = await api.save(changes, base.farmId).catch(() => ({ ok: false, error: "unavailable" }) as const);
    const accepted = await accepts(request, result.ok ? result.data.workspace : undefined);
    // An auth event can run between an awaited check resolving and this continuation.
    if (!accountLink.active || !accepted || !isCurrent(request)) {
      if (accountLink.active && epoch === generation && request.authVersion === authVersion) { setSave("failed"); schedule(RETRY_DELAY_MS); }
      return;
    }
    if (!result.ok) {
      if (result.error === "unauthenticated") return close("signedOut");
      if (result.error === "conflict") {
        // These edits belong to a previous farm. Never flush them while discovering the
        // current owner, and invalidate any queued flush/refresh from that generation.
        discard();
        return void reopen();
      }
      setSave("failed");
      return schedule(RETRY_DELAY_MS);
    }

    const { workspace: fresh, created, failed } = result.data;
    if (fresh.farmId !== before.farmId) { discard(); return void reopen(); }
    const latest = current();
    const untouched = latest === sent;
    if (latest && Object.keys(created).length) setWorkspace(withServerIds(latest, created));
    base = { ...withServerIds(before, created), farmId: before.farmId, ownerId: before.ownerId };
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
    while (saving) {
      await saving;
      if (epoch !== generation) return;
    }
    if (!accountLink.active || epoch !== generation) return;
    const pending = send().finally(() => { if (saving === pending) saving = null; });
    saving = pending;
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
    trackDrafts();
    schedule(SAVE_DELAY_MS);
  }
  accountLink.edited = edited;

  /** Runs on every entry, so a session that ended or changed never shows the last owner's farm. */
  async function reopen() {
    const attempt = ++opening;
    // Entering another account screen with this owner's farm already showing: check again in the
    // background instead of blanking it. Another owner can't slip in meanwhile: an auth change
    // discards the farm synchronously (changeIdentity), and a different farm below replaces it.
    const showing = accountLink.active && base !== null && useAccountState.getState().status === "ready";
    if (!showing) useAccountState.setState({ status: "checking" });
    const initiatingIdentity = await identityNow(false);
    if (attempt !== opening) return;
    if (!initiatingIdentity) return useAccountState.setState({ status: "error" });
    if (initiatingIdentity.authVersion !== authVersion || initiatingIdentity.ownerId !== ownerId) return;
    const epoch = ++generation;
    const request = { ...initiatingIdentity, generation: epoch };
    clearTimer();
    // Discover whose farm this is BEFORE saving. A session can change in another tab.
    // Existing in-flight saves may finish, but their old-generation results are ignored.
    const result = await api.open().catch(() => ({ ok: false, error: "unavailable" }) as const);
    const accepted = await accepts(request, result.ok ? result.data : undefined);
    if (attempt !== opening || !accepted || !isCurrent(request)) return;
    if (!result.ok) {
      if (result.error === "unauthenticated" || !hasSession()) return close();
      return useAccountState.setState({ status: "error" });
    }
    const sameFarm = accountLink.active && base?.farmId === result.data.farmId && base.ownerId === result.data.ownerId;
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
    /** Synchronous so cross-tab SDK events hide the previous farm before any request can finish. */
    authChanged(nextOwnerId: string | null) { changeIdentity(nextOwnerId, true); },
    hasUnsaved() {
      const local = current();
      return Boolean(accountLink.active && (saving || timer || (base && local && (ownerChanges(base, local).length || unsentDrafts(base, local).length))));
    },
    /** Edits on the screen that can't be sent until the owner fixes them. */
    unsentDrafts() {
      const local = current();
      return accountLink.active && base && local ? unsentDrafts(base, local) : [];
    },

    /** Calls change the farm while the page is open, so screens pick that up here. */
    async refresh() {
      if (!accountLink.active || saving || timer || useAccountState.getState().status !== "ready") return;
      const epoch = generation;
      const initiatingIdentity = await identityNow(true);
      if (!initiatingIdentity || epoch !== generation) return;
      const request = { ...initiatingIdentity, generation: epoch };
      const before = current();
      const result = await api.load().catch(() => null);
      if (!result) return;
      const accepted = await accepts(request, result.ok ? result.data : undefined);
      if (!accountLink.active || !accepted || !isCurrent(request)) return;
      if (!result.ok) {
        if (result.error === "unauthenticated") close("signedOut");
        return;
      }
      if (saving || timer || current() !== before) return;
      receive(result.data);
    },
  };
}
