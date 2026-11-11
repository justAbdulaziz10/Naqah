import { PLAN_LIMITS, PREDEFINED_QUESTIONS } from "@/domain/catalog";
import { uid } from "@/domain/id";
import type { CallSchedule, Locale, QuestionPlanEntry, Weekday, Workspace } from "@/domain/types";
import { withWorkerIds } from "@/domain/workers";
import { weather } from "@/i18n/messages/integrations/weather";
import { SAUDI_REGIONS } from "@/lib/geo/regions";
import { formatSaudiMobile } from "@/components/setup/phone";

/**
 * LOCAL DEMO ONLY: the sample ranch behind the «تعبئة تجريبية» buttons, close to the presentation ranch
 * (scripts/demo/presentation-ranch.ts). Each function fills one onboarding step and nothing else: no plan
 * change in an account, no camels (setup has no camel list), no history. The numbers are clearly samples
 * (+966 50 000 030X), outside every local test allowlist, and are never approved for calls.
 */
const SAMPLE = {
  ar: { ranch: "عزبة الوسم", owner: "فهد العتيبي", worker: "محمد", question: "فيه شي ثاني تبي تبلغ عنه؟" },
  en: { ranch: "Al Wasm Ranch", owner: "Fahad Al-Otaibi", worker: "Mohammed", question: "Anything else you want to report?" },
} satisfies Record<Locale, Record<string, string>>;

export const SAMPLE_OWNER_PHONE = formatSaudiMobile("+966500000301");
export const SAMPLE_WORKER_PHONE = formatSaudiMobile("+966500000302");
const SAMPLE_REGION = SAUDI_REGIONS.find((region) => region.id === "easternProvince")!;
const SAMPLE_HERD = 20;
/** Daily 17:00 for the worker and 19:00 for the owner; Basic takes both on Thursday. */
const WORKER_TIME = "17:00";
const OWNER_TIME = "19:00";
const BASIC_DAY: Weekday = 4;
/** The presentation's short call: herd, feed, water, fences, then the owner's «anything else». */
const ASKED = ["herd_health", "feed_level", "water_level", "fences_condition"];

export type SampleStep = "ranch" | "team" | "call" | "ready";

/** The plan is picked here only in the demo; an account's plan is set by the NAQAH team. */
function fillRanch(ws: Workspace, locale: Locale, choosePlan: boolean): Workspace {
  const s = SAMPLE[locale];
  return {
    ...ws,
    settings: {
      ...ws.settings,
      plan: choosePlan ? "ultimate" : ws.settings.plan,
      farm: {
        ...ws.settings.farm,
        name: s.ranch,
        location: weather[locale].regions[SAMPLE_REGION.id],
        coords: { lat: SAMPLE_REGION.lat, lon: SAMPLE_REGION.lon },
      },
      owner: { ...ws.settings.owner, name: s.owner, phone: SAMPLE_OWNER_PHONE },
    },
  };
}

/** The primary worker keeps its id and language; other workers stay as they are. */
function fillTeam(ws: Workspace, locale: Locale): Workspace {
  const settings = withWorkerIds({
    ...ws.settings,
    worker: { ...ws.settings.worker, name: SAMPLE[locale].worker, phone: SAMPLE_WORKER_PHONE },
    herdCount: SAMPLE_HERD,
  });
  return { ...ws, settings, resources: ws.resources.map((resource) => ({ ...resource, present: true })) };
}

function fillCall(ws: Workspace, locale: Locale): Workspace {
  const { plan } = ws.settings;
  const schedule = (time: string): CallSchedule => ({ day: plan === "basic" ? BASIC_DAY : null, time });
  const text = SAMPLE[locale].question;
  // The same question is reused, so pressing twice adds nothing; a Basic ranch at its limit gets none.
  let customQuestions = ws.settings.customQuestions;
  let own = customQuestions.find((question) => question.text.trim() === text);
  if (!own && customQuestions.length < PLAN_LIMITS[plan].customQuestions) {
    own = { id: uid("cq"), text, createdAt: new Date().toISOString() };
    customQuestions = [...customQuestions, own];
  }
  const on = (id: string): QuestionPlanEntry => ({ id, enabled: true, required: true });
  const off = (id: string): QuestionPlanEntry => ({ id, enabled: false, required: true });
  const asked = [...ASKED, ...(own ? [own.id] : [])];
  // Everything else stays listed, switched off: NAQAH's other questions and any earlier own questions.
  const rest = [
    ...(ws.settings.questionPlan ?? []).map((entry) => entry.id),
    ...PREDEFINED_QUESTIONS.map((question) => question.id),
    ...customQuestions.map((question) => question.id),
  ].filter((id, index, list) => !asked.includes(id) && list.indexOf(id) === index);
  return {
    ...ws,
    settings: {
      ...ws.settings,
      callSchedule: schedule(WORKER_TIME),
      ownerCallSchedule: schedule(OWNER_TIME),
      reportMode: "guided",
      customQuestions,
      questionPlan: [...asked.map(on), ...rest.map(off)],
    },
  };
}

/** Fills one step with the sample ranch. "ready" has no fields of its own, so it fills every step. */
export function fillSampleStep(step: SampleStep, ws: Workspace, { locale, choosePlan }: { locale: Locale; choosePlan: boolean }): Workspace {
  if (step === "ranch") return fillRanch(ws, locale, choosePlan);
  if (step === "team") return fillTeam(ws, locale);
  if (step === "call") return fillCall(ws, locale);
  return fillCall(fillTeam(fillRanch(ws, locale, choosePlan), locale), locale);
}
