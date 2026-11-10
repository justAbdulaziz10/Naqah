/**
 * Reference data prepared by the NAQAH team.
 *
 * DRAFT: final question categories and wording are NOT approved yet
 * (owner-onboarding diagram). Change wording here only; ids are stable and
 * referenced by stored reports.
 */
import type {
  CriterionKind,
  EmergencyKind,
  Level,
  LocalizedText,
  PredefinedQuestion,
  ResourceKind,
  WorkerLanguage,
  HealthStatus,
  Certainty,
} from "./types";

export const RESOURCE_KINDS: ResourceKind[] = ["feed", "water", "fences", "shelter", "medicine"];

export const RESOURCE_LABELS: Record<ResourceKind, LocalizedText> = {
  feed: { ar: "العلف", en: "Feed" },
  water: { ar: "الماء", en: "Water" },
  fences: { ar: "الشبك والسياج", en: "Fences" },
  shelter: { ar: "المظلات", en: "Shade & shelter" },
  medicine: { ar: "المستلزمات البيطرية", en: "Vet supplies" },
};

/** Level wording depends on the resource: fences/shelter describe condition, others describe stock. */
export function levelLabel(kind: ResourceKind, level: Level): LocalizedText {
  const condition = kind === "fences" || kind === "shelter";
  const map: Record<Level, LocalizedText> = condition
    ? {
        good: { ar: "سليم", en: "Intact" },
        medium: { ar: "خراب بسيط", en: "Minor damage" },
        low: { ar: "يحتاج إصلاح", en: "Needs repair" },
        critical: { ar: "خراب كبير", en: "Badly damaged" },
        unknown: { ar: "غير معروف", en: "Unknown" },
      }
    : {
        good: { ar: "كافٍ", en: "Plenty" },
        medium: { ar: "متوسط", en: "About half" },
        low: { ar: "قارب على النفاد", en: "Running low" },
        critical: { ar: "نفد تقريباً", en: "Almost out" },
        unknown: { ar: "غير معروف", en: "Unknown" },
      };
  return map[level];
}

export const HEALTH_LABELS: Record<HealthStatus, LocalizedText> = {
  healthy: { ar: "بصحة جيدة", en: "Healthy" },
  watch: { ar: "تحت الملاحظة", en: "Under watch" },
  sick: { ar: "مريضة", en: "Sick" },
  unknown: { ar: "غير معروف", en: "Unknown" },
};

export const CERTAINTY_LABELS: Record<Certainty, LocalizedText> = {
  reported: { ar: "حسب إفادة العامل", en: "Reported by worker" },
  approximate: { ar: "تقديري", en: "Approximate" },
  unknown: { ar: "لم يُعرف", en: "Unknown" },
  verified: { ar: "مؤكَّد", en: "Verified" },
};

export const PREDEFINED_QUESTIONS: PredefinedQuestion[] = [
  {
    id: "herd_health",
    category: "health",
    requires: null,
    answerKind: "herd-health",
    text: {
      ar: "كيف الحلال اليوم؟",
      en: "How are the camels today?",
    },
  },
  {
    id: "herd_count",
    category: "health",
    requires: null,
    answerKind: "yesno",
    text: {
      ar: "كم عدد الحلال كله اليوم؟",
      en: "How many camels are there in total today?",
    },
  },
  {
    id: "feed_level",
    category: "feed",
    requires: "feed",
    answerKind: "level",
    text: {
      ar: "كيف العلف؟",
      en: "How is the feed?",
    },
  },
  {
    id: "water_level",
    category: "water",
    requires: "water",
    answerKind: "level",
    text: {
      ar: "كيف الماء؟",
      en: "How is the water?",
    },
  },
  {
    id: "fences_condition",
    category: "fences",
    requires: "fences",
    answerKind: "level",
    text: {
      ar: "الشبك سليم؟",
      en: "Are the fences intact?",
    },
  },
  {
    id: "shelter_condition",
    category: "shelter",
    requires: "shelter",
    answerKind: "level",
    text: {
      ar: "المظلات سليمة؟",
      en: "Is the shade and shelter in good condition?",
    },
  },
  {
    id: "medicine_stock",
    category: "medicine",
    requires: "medicine",
    answerKind: "level",
    text: {
      ar: "الأدوية كافية؟",
      en: "Are the vet supplies enough?",
    },
  },
];

export const QUESTION_CATEGORY_LABELS: Record<PredefinedQuestion["category"], LocalizedText> = {
  health: { ar: "صحة الحلال", en: "Camel health" },
  feed: { ar: "العلف", en: "Feed" },
  water: { ar: "الماء", en: "Water" },
  fences: { ar: "السياج", en: "Fences" },
  shelter: { ar: "المظلات", en: "Shelter" },
  medicine: { ar: "المستلزمات البيطرية", en: "Vet supplies" },
  general: { ar: "عام", en: "General" },
};

export const CRITERION_LABELS: Record<Exclude<CriterionKind, "custom">, LocalizedText> = {
  sick_camel: { ar: "ناقة مريضة أو مصابة", en: "A sick or injured camel" },
  missing_camel: { ar: "نقص في عدد الحلال", en: "A camel is missing" },
  low_feed: { ar: "العلف قارب على النفاد", en: "Feed running low" },
  low_water: { ar: "الماء قارب على النفاد", en: "Water running low" },
  fence_damage: { ar: "خراب في السياج", en: "Fence damage" },
  medicine_low: { ar: "نقص المستلزمات البيطرية", en: "Vet supplies running low" },
};

export const EMERGENCY_LABELS: Record<Exclude<EmergencyKind, "custom">, LocalizedText> = {
  injury: { ar: "إصابة بالغة", en: "Serious injury" },
  missing_camel: { ar: "فقدان ناقة", en: "Missing camel" },
  fire: { ar: "حريق", en: "Fire" },
  predator: { ar: "هجوم حيوان مفترس", en: "Predator attack" },
  theft: { ar: "سرقة", en: "Theft" },
  death: { ar: "نفوق", en: "Death of a camel" },
};

export const WORKER_LANGUAGES: { id: WorkerLanguage; label: LocalizedText; native: string; speech: string }[] = [
  { id: "ar", label: { ar: "العربية", en: "Arabic" }, native: "العربية", speech: "ar-SA" },
  { id: "en", label: { ar: "الإنجليزية", en: "English" }, native: "English", speech: "en-US" },
  { id: "ur", label: { ar: "الأردية", en: "Urdu" }, native: "اردو", speech: "ur-PK" },
  { id: "hi", label: { ar: "الهندية", en: "Hindi" }, native: "हिन्दी", speech: "hi-IN" },
  { id: "bn", label: { ar: "البنغالية", en: "Bengali" }, native: "বাংলা", speech: "bn-BD" },
  { id: "fil", label: { ar: "الفلبينية", en: "Filipino" }, native: "Filipino", speech: "fil-PH" },
];

export const WEEKDAY_LABELS: LocalizedText[] = [
  { ar: "الأحد", en: "Sunday" },
  { ar: "الاثنين", en: "Monday" },
  { ar: "الثلاثاء", en: "Tuesday" },
  { ar: "الأربعاء", en: "Wednesday" },
  { ar: "الخميس", en: "Thursday" },
  { ar: "الجمعة", en: "Friday" },
  { ar: "السبت", en: "Saturday" },
];

export const PLAN_LIMITS = {
  basic: { customQuestions: 5, workers: 3, reports: "weekly", taskTickets: false },
  ultimate: { customQuestions: Infinity, workers: 10, reports: "daily", taskTickets: true },
} as const;
