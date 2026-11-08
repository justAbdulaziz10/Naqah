import type { LocalizedText } from "@/domain/types";

export type LandingPhotoId = "hero" | "herder" | "evening" | "heritage" | "herd" | "closing";

export interface LandingPhoto {
  /** Path under /public, e.g. "/images/landing/hero.jpg". */
  src: string;
  width: number;
  height: number;
  /** Neutral description of what is shown. Never presented as a NAQAH estate. */
  alt: LocalizedText;
  /** Where the visual interest sits, used as object-position, e.g. "50% 60%". */
  focus: string;
  credit: { title: string; creator: string; license: string; licenseUrl: string; sourceUrl: string };
}

/**
 * Landing photographs, pending owner approval (see docs/design/asset-ledger.md). A slot without an
 * entry renders the designed fallback plate in EstatePhoto, so the page stays complete without images.
 */
export const LANDING_PHOTOS: Partial<Record<LandingPhotoId, LandingPhoto>> = {
  hero: {
    src: "/images/landing/hero-herd-dusk.jpg",
    width: 2560,
    height: 1706,
    alt: {
      en: "A line of camels walking across the dunes at sunset",
      ar: "قطيع من الإبل يمشي على الكثبان وقت الغروب",
    },
    focus: "50% 8%",
    credit: {
      title: "Camels trekking through the desert at sunset",
      creator: "Mo Eid",
      license: "Pexels License",
      licenseUrl: "https://www.pexels.com/license/",
      sourceUrl: "https://www.pexels.com/photo/camels-trekking-through-the-desert-at-sunset-28844446/",
    },
  },
  herder: {
    src: "/images/landing/hero-herder.jpg",
    width: 2400,
    height: 1598,
    alt: {
      en: "A herder leads a camel across flat desert sand in a dusty haze",
      ar: "راعٍ يقود جمله عبر رمال صحراء مستوية في غبار خفيف",
    },
    focus: "50% 55%",
    credit: {
      title: "راع يقود جمله",
      creator: "Saudi Press Agency (SPA)",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:%D8%B1%D8%A7%D8%B9_%D9%8A%D9%82%D9%88%D8%AF_%D8%AC%D9%85%D9%84%D9%87.jpg",
    },
  },
  evening: {
    src: "/images/landing/evening.jpg",
    width: 1600,
    height: 1066,
    alt: {
      en: "A dromedary and her newborn calf in low, warm light",
      ar: "ناقة ومعها حوارها المولود حديثًا في ضوء دافئ منخفض",
    },
    focus: "50% 55%",
    credit: {
      title: "Arabian Camel in Kuwait",
      creator: "Manojkiri photography",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Arabian_Camel_in_Kuwait.jpg",
    },
  },
  heritage: {
    src: "/images/landing/heritage.jpg",
    width: 1600,
    height: 1000,
    alt: {
      en: "Hand-woven Sadu textile with deep red, black and cream bands",
      ar: "نسيج سدو يدوي بخطوط حمراء داكنة وسوداء وبيضاء مائلة إلى الكريمي",
    },
    focus: "40% 45%",
    credit: {
      title: "السدو 2",
      creator: "Di7ane",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:%D8%A7%D9%84%D8%B3%D8%AF%D9%88_2.jpg",
    },
  },
  herd: {
    src: "/images/landing/herd-profile.jpg",
    width: 1600,
    height: 1066,
    alt: {
      en: "Side profile of a dromedary's head and neck against blurred sand",
      ar: "رأس ورقبة ناقة من الجانب أمام رمال غير واضحة المعالم",
    },
    focus: "4% 45%",
    credit: {
      title: "Dromedary Wahiba Sands 2019 (08)",
      creator: "Ekrem Canli",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Dromedary_Wahiba_Sands_2019_(08).jpg",
    },
  },
  closing: {
    src: "/images/landing/call-hisma-sunset.jpg",
    width: 2400,
    height: 1600,
    alt: {
      en: "The sun setting over the Hisma desert",
      ar: "الشمس تغرب على صحراء حسمى",
    },
    focus: "62% 58%",
    credit: {
      title: "The sun is setting over a desert landscape",
      creator: "NEOM",
      license: "Unsplash License",
      licenseUrl: "https://unsplash.com/license",
      sourceUrl: "https://unsplash.com/photos/the-sun-is-setting-over-a-desert-landscape-WpOMM4uE-F8",
    },
  },
};
