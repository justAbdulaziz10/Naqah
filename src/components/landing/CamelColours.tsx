import type { Locale } from "@/domain/types";
import { WovenSignature } from "@/components/heritage/Woven";
import { getMessages } from "@/i18n/messages";
import { EstatePhoto } from "./EstatePhoto";
import type { CamelColourId } from "./photos";

/**
 * Approximate coat swatches for the designed plates shown when no verified, licensed photograph
 * of a colour exists yet. Data for the gallery only, not brand tokens.
 * Real photographs are still needed for all six colours: see "Still needed: real photographs for
 * the camel-colour gallery" in docs/design/asset-ledger.md. Adding one to LANDING_PHOTOS replaces its plate.
 */
const COATS: Record<CamelColourId, { swatch: string; tone: "light" | "dark" }> = {
  wadh: { swatch: "#f1ece2", tone: "light" },
  shul: { swatch: "#c9965a", tone: "light" },
  sufr: { swatch: "#c2a26b", tone: "light" },
  shaqh: { swatch: "#cfc2a8", tone: "light" },
  humr: { swatch: "#9a5b3a", tone: "dark" },
  majaheem: { swatch: "#2e2622", tone: "dark" },
};

/** Six Saudi camel colours, set as an editorial gallery on a dark chapter. */
export function CamelColours({ locale }: { locale: Locale }) {
  const { colours } = getMessages(locale).landing;
  return (
    <section id="colours" aria-labelledby="colours-title" className="scroll-mt-20 bg-brown-deep text-cream">
      <div data-weave="">
        <WovenSignature tone="dark" />
      </div>
      <div className="mx-auto w-full max-w-[1360px] px-5 py-20 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
        <div className="max-w-[40rem]">
          <h2
            id="colours-title"
            data-reveal=""
            className="text-[clamp(2.25rem,4vw,4rem)] font-semibold leading-[1.08] tracking-[-0.025em] [html[lang=ar]_&]:leading-[1.25] [html[lang=ar]_&]:tracking-normal"
          >
            {colours.title}
          </h2>
          <p data-reveal="" data-reveal-delay="90" className="mt-6 text-xl leading-9 text-cream/90">
            {colours.lead}
          </p>
        </div>

        <ul className="mt-14 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 sm:gap-y-14 lg:mt-20 lg:grid-cols-3 lg:gap-x-8">
          {colours.items.map((item, index) => {
            const coat = COATS[item.id as CamelColourId];
            return (
              <li
                key={item.id}
                data-reveal=""
                data-reveal-delay={(index % 3) * 90}
              >
                <figure>
                  <EstatePhoto
                    id={item.id as CamelColourId}
                    locale={locale}
                    sizes="(min-width: 1024px) 28vw, 45vw"
                    groundColor={coat.swatch}
                    fallbackTone={coat.tone}
                    className="aspect-[4/5] w-full lg:aspect-[4/3]"
                  />
                  <figcaption className="mt-4 sm:mt-5">
                    <p className="text-xl font-semibold sm:text-2xl">{item.name}</p>
                    {item.native ? (
                      <p lang="ar" className="mt-0.5 font-arabic text-base text-cream/75">
                        {item.native}
                      </p>
                    ) : null}
                    <p className="mt-2 max-w-[34ch] text-[0.9375rem] leading-6 text-cream/85 sm:text-base sm:leading-7">{item.description}</p>
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
