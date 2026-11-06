import type { LocalizedText } from "@/domain/types";

export type LandingPhotoId = "hero" | "evening" | "heritage" | "herd" | "closing" | "welcome";

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
      en: "A line of camels walking across the sand at sunset under a peach sky",
      ar: "إبل تمشي في صف على الرمل وقت الغروب تحت سماء خوخية",
    },
    focus: "44% 62%",
    credit: {
      title: "Camels Trekking Through the Desert at Sunset",
      creator: "Mo Eid",
      license: "Pexels License",
      licenseUrl: "https://www.pexels.com/license/",
      sourceUrl: "https://www.pexels.com/photo/camels-trekking-through-the-desert-at-sunset-28844446/",
    },
  },
  evening: {
    src: "/images/landing/call-hisma-sunset.jpg",
    width: 2400,
    height: 1600,
    alt: {
      en: "The sun setting on the horizon of the Hisma Desert, with rock outcrops in silhouette",
      ar: "الشمس تغرب على أفق صحراء حسمى، والصخور ظلال داكنة",
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
    src: "/images/landing/plans-camel-dusk.jpg",
    width: 1800,
    height: 1093,
    alt: {
      en: "A single camel walking across rippled sand, rim-lit by the low sun",
      ar: "ناقة تمشي على رمل متموج وضوء الشمس المنخفض يحيط بها",
    },
    focus: "56% 50%",
    credit: {
      title: "Camel on Desert at Sunset",
      creator: "Mo Eid",
      license: "Pexels License",
      licenseUrl: "https://www.pexels.com/license/",
      sourceUrl: "https://www.pexels.com/photo/camel-on-desert-at-sunset-17887613/",
    },
  },
  closing: {
    src: "/images/landing/closing-mountains.jpg",
    width: 2400,
    height: 1600,
    alt: {
      en: "Layered desert mountains in blue shadow under an amber sky just after sunset",
      ar: "جبال صحراوية متتالية في ظل أزرق تحت سماء كهرمانية بعد الغروب",
    },
    focus: "40% 45%",
    credit: {
      title: "The sun is setting over the mountains in the desert",
      creator: "NEOM",
      license: "Unsplash License",
      licenseUrl: "https://unsplash.com/license",
      sourceUrl: "https://unsplash.com/photos/the-sun-is-setting-over-the-mountains-in-the-desert-El92hmAt91o",
    },
  },
  welcome: {
    src: "/images/landing/hero-herder.jpg",
    width: 2400,
    height: 1598,
    alt: {
      en: "A herder leads a camel across flat desert sand in a dusty haze",
      ar: "راعٍ يقود جمله عبر رمال صحراء مستوية في غبار خفيف",
    },
    focus: "50% 100%",
    credit: {
      title: "راع يقود جمله",
      creator: "Saudi Press Agency (SPA)",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:%D8%B1%D8%A7%D8%B9_%D9%8A%D9%82%D9%88%D8%AF_%D8%AC%D9%85%D9%84%D9%87.jpg",
    },
  },
};
