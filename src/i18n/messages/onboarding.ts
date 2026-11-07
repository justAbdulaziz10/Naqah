import { defineMessages } from "../types";

/** Strings shared by the setup field groups (resources, what matters, emergencies, phone hint). Keep en and ar keys identical. */
export const onboarding = defineMessages({
  en: {
    sectionTitles: {
      resources: "Farm resources",
      whatMatters: "What matters to you",
    },
    hasResource: "We have this on the farm",
    presentOnFarm: "On the farm",
    absentFromFarm: "Not on the farm",
    absentResourcesSkipped: "Questions about resources you do not have are skipped.",
    criteriaTitle: "Information you want to hear about",
    customCriterion: "Custom keyword or phrase",
    removeCustomCriterion: (name: string) => `Remove ${name}`,
    emergenciesTitle: "Emergency categories",
    emergencyNote: "In an emergency, the worker calls you directly, not through NAQAH.",
    wizard: {
      phoneHint: "Saudi mobile, for example",
      phoneExample: "+966 5X XXX XXXX",
      phoneCheck: "Check the number. A Saudi mobile looks like",
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
      phoneHint: "رقم جوال سعودي، مثل",
      phoneExample: "+966 5X XXX XXXX",
      phoneCheck: "تأكد من الرقم. الجوال السعودي يكون مثل",
    },
  },
});
