import type { Locale } from "@/domain/types";
import { getMessages } from "@/i18n/messages";
import { Diorama, type Certainty, type DioramaItem, type FixtureId } from "./Diorama";

const FIXTURE_CERTAINTY: Record<FixtureId, Certainty> = {
  water: "reported",
  feed: "approximate",
  shade: "notReported",
  room: "verified",
  heat: "verified",
};
const FIXTURE_ORDER: FixtureId[] = ["water", "feed", "shade", "room", "heat"];

/** «عزبتك، في لمحة»: the sample ranch as an isometric model, every fact labelled with how sure it is. */
export function RanchDiorama({ locale }: { locale: Locale }) {
  const c = getMessages(locale).landing.night.ranch;
  const items: DioramaItem[] = [
    ...c.camels.names.map((name, index) => ({
      id: `camel-${index}` as const,
      name,
      fact: index === 0 ? c.camels.watched : c.camels.clear,
      certainty: "reported" as Certainty,
      certaintyLabel: c.certainty.reported,
    })),
    ...FIXTURE_ORDER.map((id) => ({
      id,
      name: c.fixtures[id].name,
      fact: c.fixtures[id].fact,
      certainty: FIXTURE_CERTAINTY[id],
      certaintyLabel: c.certainty[FIXTURE_CERTAINTY[id]],
    })),
  ];

  return (
    <section id="ranch" aria-labelledby="ranch-title" className="relative scroll-mt-24 py-20 sm:py-24 lg:py-28">
      <div className="night-frame">
        <hr aria-hidden className="night-rule mb-14 lg:mb-20" />
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-4">
            <p className="text-sm font-medium text-[var(--text-faint)]">{c.sample}</p>
            <h2 id="ranch-title" className="night-title mt-3 max-w-[14ch]">
              {c.title}
            </h2>
            <p className="mt-5 max-w-[28rem] text-lg leading-8 text-[var(--text-muted)]">{c.line}</p>
          </div>
          <div className="lg:col-span-8">
      {/* Screen readers get each fact once, from the model's own buttons (name, fact and certainty). */}
            <Diorama items={items} modelLabel={c.model} modes={c.modes} />
          </div>
        </div>
      </div>
    </section>
  );
}
