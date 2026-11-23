import type { Locale } from "@/domain/types";
import { defineMessages } from "@/i18n/types";
import { Diorama, type Certainty, type DioramaItem, type FixtureId } from "./Diorama";

const copy = defineMessages({
  en: {
    title: "Your ranch, at a glance",
    line: "Every fact NAQAH shows carries its own label: reported, approximate, unknown or verified. Nothing old is ever shown as new.",
    sample: "Sample ranch, Thursday’s report",
    hint: "Tap or hover anything to read the latest about it.",
    model: "An isometric model of the sample ranch. Each element shows its latest fact when selected.",
    listTitle: "The same facts as text",
    certainty: { reported: "reported", approximate: "approximate", notReported: "not reported", verified: "verified" },
    fixtures: {
      water: { name: "Water trough", fact: "Fine" },
      feed: { name: "Feed store", fact: "About 3 days left" },
      shade: { name: "Shade", fact: "Not reported this week" },
      room: { name: "Ahmed’s room", fact: "Answered Thursday 5:40 PM, report saved 5:44 PM" },
      heat: { name: "Today’s weather", fact: "Heat day today" },
    },
    camels: {
      names: ["Wadha", "Shaala", "Mozna", "Hamra", "Ghaima", "Reem", "Haddaj", "Fatinah"],
      watched: "Not eating well, under watch",
      clear: "No concern raised in Thursday’s report",
    },
  },
  ar: {
    title: "عزبتك، في لمحة",
    line: "كل معلومة تعرضها ناقة تحمل وصفها: مُبلَّغة، أو تقريبية، أو غير معروفة، أو مؤكَّدة. وما تعرض لك معلومة قديمة كأنها جديدة.",
    sample: "عزبة تجريبية، تقرير الخميس",
    hint: "المس أي عنصر تقرأ آخر ما ورد عنه.",
    model: "نموذج مجسّم للعزبة التجريبية. كل عنصر يعرض آخر معلومة عنه عند اختياره.",
    listTitle: "المعلومات نفسها نصًا",
    certainty: { reported: "مُبلَّغ", approximate: "تقريبي", notReported: "غير مُبلَّغ", verified: "مؤكَّد" },
    fixtures: {
      water: { name: "حوض الماء", fact: "بخير" },
      feed: { name: "مخزن العلف", fact: "يكفي نحو 3 أيام" },
      shade: { name: "المظلة", fact: "ما ورد عنها شيء هذا الأسبوع" },
      room: { name: "غرفة أحمد", fact: "رد الخميس 5:40 م، وحُفظ التقرير 5:44 م" },
      heat: { name: "طقس اليوم", fact: "اليوم يوم حر" },
    },
    camels: {
      names: ["وضحى", "شعلاء", "مزنة", "حمرا", "غيمة", "ريم", "هدّاج", "فاتنة"],
      watched: "ما تأكل زين، تحت المراقبة",
      clear: "ما ذُكر عنها شيء في تقرير الخميس",
    },
  },
});

const FIXTURE_CERTAINTY: Record<FixtureId, Certainty> = {
  water: "reported",
  feed: "approximate",
  shade: "notReported",
  room: "verified",
  heat: "verified",
};
const FIXTURE_ORDER: FixtureId[] = ["water", "feed", "shade", "room", "heat"];

const TONE: Record<Certainty, string> = {
  reported: "var(--moon)",
  approximate: "var(--warn)",
  notReported: "var(--text-faint)",
  verified: "var(--ok)",
};

/** «عزبتك، في لمحة»: the sample ranch as a night model, every fact labelled with how sure it is. */
export function RanchDiorama({ locale }: { locale: Locale }) {
  const c = copy[locale];
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
  const legend: Certainty[] = ["reported", "approximate", "notReported", "verified"];

  return (
    <section id="ranch" aria-labelledby="ranch-title" className="relative scroll-mt-24 py-20 sm:py-24 lg:py-32">
      {/* A faint horizon glow under the model. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[60%] bg-[radial-gradient(ellipse_at_50%_100%,rgba(107,63,58,0.28),transparent_65%)]"
      />
      <div className="night-frame">
        <hr aria-hidden className="night-rule mb-14 lg:mb-20" />
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <p className="text-sm font-medium text-[var(--text-faint)]">{c.sample}</p>
            <h2 id="ranch-title" className="night-title mt-3 max-w-[14ch]">
              {c.title}
            </h2>
            <p className="mt-5 max-w-[30rem] text-lg leading-8 text-[var(--text-muted)]">{c.line}</p>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label={c.listTitle}>
              {legend.map((key) => (
                <li key={key} className="inline-flex items-center gap-2" style={{ color: TONE[key] }}>
                  <span aria-hidden className="size-1.5 rounded-full bg-current" />
                  <span className="text-[var(--text)]">{c.certainty[key]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-[var(--text-faint)] max-sm:hidden">{c.hint}</p>
            {/* The model's facts as plain text, for readers who skip the interactive model. */}
            <ul className="sr-only">
              {items.map((item) => (
                <li key={item.id}>
                  {item.name}: {item.fact} ({item.certaintyLabel})
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-7">
            <Diorama items={items} modelLabel={c.model} />
          </div>
        </div>
      </div>
    </section>
  );
}
