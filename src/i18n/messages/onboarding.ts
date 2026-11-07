import { defineMessages } from "../types";

/** Strings shared by the setup field groups (resources, what matters, emergencies, phone field). Keep en and ar keys identical. */
export const onboarding = defineMessages({
  en: {
    sectionTitles: {
      resources: "Ranch resources",
      whatMatters: "What matters to you",
    },
    hasResource: "We have this on the ranch",
    presentOnFarm: "On the ranch",
    absentFromFarm: "Not on the ranch",
    absentResourcesSkipped: "Questions about resources you do not have are skipped.",
    criteriaTitle: "Information you want to hear about",
    customCriterion: "Custom keyword or phrase",
    removeCustomCriterion: (name: string) => `Remove ${name}`,
    emergenciesTitle: "Emergency categories",
    emergencyNote: "In an emergency, the worker calls you directly, not through NAQAH.",
    wizard: {
      phonePlaceholder: "5X XXX XXXX",
      phoneCountry: "Saudi Arabia, +966",
      phoneCheck: "Enter a Saudi mobile: 9 digits starting with 5.",
    },
  },
  ar: {
    sectionTitles: {
      resources: "موارد المزرعة",
      whatMatters: "ما يهمك",
    },
    hasResource: "متوفر في المزرعة",
    presentOnFarm: "متوفر في المزرعة",
    absentFromFarm: "غير موجود في المزرعة",
    absentResourcesSkipped: "نتجاوز الأسئلة عن الموارد غير الموجودة في مزرعتك.",
    criteriaTitle: "المعلومات التي تهمك",
    customCriterion: "كلمة أو عبارة مخصصة",
    removeCustomCriterion: (name: string) => `حذف ${name}`,
    emergenciesTitle: "حالات الطوارئ",
    emergencyNote: "في الطوارئ، العامل يتصل فيك مباشرة، مو عن طريق ناقة.",
    wizard: {
      phonePlaceholder: "5X XXX XXXX",
      phoneCountry: "السعودية، ‎+966",
      phoneCheck: "اكتب جوال سعودي من 9 أرقام يبدأ بـ 5.",
    },
  },
});
