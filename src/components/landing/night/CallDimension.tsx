import type { Locale } from "@/domain/types";
import { defineMessages } from "@/i18n/types";
import { PhoneStage } from "./PhoneStage";
import "./call.css";

/** The call story's copy. Local to the section; one sample evening at Al Safra Ranch. */
export const callCopy = defineMessages({
  en: {
    title: "The call, as it really happens",
    line: "One sample evening at Al Safra Ranch, from Ahmed’s phone to yours.",
    sample: "Illustrative sample",
    stageLabel: "A phone showing NAQAH’s call with Ahmed, the facts it kept, then the call to the owner.",
    beats: [
      {
        time: "5:40 PM",
        title: "NAQAH calls Ahmed",
        body: "On his ordinary phone, no app. The agent says it is automated, then asks your questions one at a time.",
      },
      {
        time: "5:41 PM",
        title: "One question at a time",
        body: "Numbers and camel names are read back and confirmed. “I don’t know” is a fine answer, and the agent never diagnoses.",
      },
      {
        time: "5:44 PM",
        title: "The report puts itself together",
        body: "Each answer becomes a fact labelled with how sure it is. Nothing is recorded, only the facts, and nothing is kept until Ahmed hears the read-back and says yes.",
      },
      {
        time: "7:00 PM",
        title: "Then NAQAH calls you",
        body: "Only what matters, at the time you chose. If no verified report came in, it tells you so.",
      },
    ],
    incoming: { hint: "Automated call", caller: "NAQAH · Al Safra Ranch", status: "Incoming call", answer: "Answer", decline: "Decline" },
    transcript: [
      { who: "naqah", text: "Good evening, Ahmed. This is NAQAH, an automated call from Al Safra Ranch. How is the water today?" },
      { who: "ahmed", text: "Fine." },
      { who: "naqah", text: "How much feed is left?" },
      { who: "ahmed", text: "Not sure exactly. Roughly enough for three days." },
      { who: "naqah", text: "Three days, approximately. And Wadha, how does she look today?" },
      { who: "ahmed", text: "She isn’t eating well." },
      { who: "naqah", text: "Wadha, not eating well. Noted. I’ll read everything back before anything is kept." },
    ],
    readback: {
      title: "Before anything is kept",
      lines: ["Water: fine", "Feed: about three days", "Wadha: not eating well", "A heat day, from the weather"],
      ask: "Is that right?",
      yes: "Yes, that’s right",
      saved: "Kept at 5:44 PM",
    },
    facts: [
      { topic: "Water", value: "Fine", certainty: "reported" },
      { topic: "Feed", value: "About 3 days", certainty: "approximate" },
      { topic: "Wadha", value: "Not eating well", certainty: "reported" },
      { topic: "Heat day", value: "Yes", certainty: "verified from the weather" },
    ],
    kept: { title: "What NAQAH kept", note: "Facts only. No recording.", yes: "Ahmed’s yes to the read-back", savedAfter: "Kept after his yes, 5:44 PM" },
    owner: {
      hint: "NAQAH is calling you",
      time: "7:00 PM",
      summary: "Wadha isn’t eating well, and feed lasts about three days. The water is fine.",
      none: "If no verified report came in, NAQAH says so plainly.",
    },
  },
  ar: {
    title: "المكالمة، كما تصير فعلًا",
    line: "مساء واحد في عزبة الصفراء، من جوال أحمد إلى جوالك.",
    sample: "مثال توضيحي",
    stageLabel: "جوال يعرض مكالمة ناقة مع أحمد، والحقائق التي احتفظت بها، ثم المكالمة إلى المالك.",
    beats: [
      {
        time: "5:40 م",
        title: "ناقة تتصل على أحمد",
        body: "على جواله العادي، بدون تطبيق. يعرّف النظام عن نفسه إنه آلي، ثم يسأل أسئلتك واحدًا واحدًا.",
      },
      {
        time: "5:41 م",
        title: "سؤال واحد في كل مرة",
        body: "الأرقام وأسماء النوق تُعاد عليه ويؤكدها. «ما أدري» جواب مقبول، والنظام ما يشخّص أبدًا.",
      },
      {
        time: "5:44 م",
        title: "التقرير يتجمّع لحاله",
        body: "كل جواب يصير حقيقة مكتوبة مع درجة التأكد منها. ما يُسجَّل صوت، بس الحقائق. وما يُحفظ شيء إلا بعد ما يسمع أحمد الملخص ويقول نعم.",
      },
      {
        time: "7:00 م",
        title: "ثم ناقة تتصل عليك",
        body: "المهم فقط، في الوقت اللي اخترته. ولو ما وصل تقرير مؤكد، تقول لك ذلك بصراحة.",
      },
    ],
    incoming: { hint: "مكالمة آلية", caller: "ناقة · عزبة الصفراء", status: "مكالمة واردة", answer: "رد", decline: "رفض" },
    transcript: [
      { who: "naqah", text: "مساء الخير يا أحمد، معك ناقة، مكالمة آلية من عزبة الصفراء. كيف الماء اليوم؟" },
      { who: "ahmed", text: "تمام." },
      { who: "naqah", text: "كم باقي عندكم من العلف؟" },
      { who: "ahmed", text: "ما أدري بالضبط، تقريبًا يكفي ثلاث أيام." },
      { who: "naqah", text: "ثلاث أيام تقريبًا. ووضحة، كيف شكلها اليوم؟" },
      { who: "ahmed", text: "ما تأكل زين." },
      { who: "naqah", text: "وضحة ما تأكل زين. سجّلتها، وبأعيد عليك كل شيء قبل ما يُحفظ." },
    ],
    readback: {
      title: "قبل ما يُحفظ شيء",
      lines: ["الماء: تمام", "العلف: يكفي ثلاث أيام تقريبًا", "وضحة: ما تأكل زين", "يوم حار، حسب الطقس"],
      ask: "صحيح؟",
      yes: "نعم، صحيح",
      saved: "حُفظ 5:44 م",
    },
    facts: [
      { topic: "الماء", value: "تمام", certainty: "مُبلَّغ" },
      { topic: "العلف", value: "حوالي 3 أيام", certainty: "تقريبي" },
      { topic: "وضحة", value: "ما تأكل زين", certainty: "مُبلَّغ" },
      { topic: "يوم حار", value: "نعم", certainty: "مؤكد من الطقس" },
    ],
    kept: { title: "ما احتفظت به ناقة", note: "حقائق فقط. بدون تسجيل.", yes: "نعم أحمد على الملخص", savedAfter: "حُفظ بعد نعم أحمد، 5:44 م" },
    owner: {
      hint: "ناقة تتصل عليك",
      time: "7:00 م",
      summary: "وضحة ما تأكل زين، والعلف يكفي ثلاث أيام تقريبًا. الماء بخير.",
      none: "ولو ما وصل تقرير مؤكد، ناقة تقول لك ذلك بصراحة.",
    },
  },
});

export type CallCopy = (typeof callCopy)["en"];

/** «المكالمة، كما تصير فعلًا»: the call story as a scroll-driven 3D stage beside four beats. */
export function CallDimension({ locale }: { locale: Locale }) {
  const copy = callCopy[locale];
  return (
    <section id="call" aria-labelledby="call-title" className="relative scroll-mt-24 pb-10 pt-20 sm:pt-24 lg:pb-16 lg:pt-32">
      <div className="night-frame">
        <hr aria-hidden className="night-rule mb-14 lg:mb-20" />
        <p className="text-sm font-semibold text-[var(--text-faint)]">{copy.sample}</p>
        <h2 id="call-title" className="night-title mt-3 max-w-[18ch] text-[var(--text)]">
          {copy.title}
        </h2>
        <p className="mt-5 max-w-[32rem] text-lg leading-8 text-[var(--text-muted)] lg:text-xl lg:leading-9">{copy.line}</p>

        {/* Text equivalent of the stage: what the phone shows, in reading order. */}
        <div className="sr-only">
          <p>{copy.stageLabel}</p>
          <ol>
            {copy.transcript.map((turn, index) => (
              <li key={index}>{turn.text}</li>
            ))}
          </ol>
          <p>{copy.kept.title}</p>
          <ul>
            {copy.facts.map((fact) => (
              <li key={fact.topic}>
                {fact.topic}: {fact.value} ({fact.certainty})
              </li>
            ))}
          </ul>
          <p>{copy.owner.summary}</p>
        </div>
      </div>

      <PhoneStage locale={locale} copy={copy} />
    </section>
  );
}
