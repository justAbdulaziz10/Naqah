import { ArrowsClockwise, ChatCenteredText, ClipboardText, PhoneCall } from "@phosphor-icons/react/dist/ssr";
import type { Locale } from "@/domain/types";
import { REPORT_CALL_RETRIES, RETRY_DELAY_MS } from "@/domain/clock";
import { defineMessages } from "@/i18n/types";
import { RetryOrbit } from "./RetryOrbit";

const copy = defineMessages({
  en: {
    title: "What NAQAH holds to",
    line: "Three habits that keep your peace of mind, whatever the evening brings.",
    principles: {
      retries: {
        title: (attempts: number) => `${attempts} attempts, then it tells you`,
        body: (attempts: number, minutes: number) =>
          `If your worker does not answer, NAQAH tries again ${minutes} minutes later, ${attempts} attempts in all, then stops and shows the missed call on your dashboard. A saved report stops the retries.`,
      },
      facts: {
        title: "Facts, never recordings",
        body: "Only what was said becomes a fact, labelled with how sure it is. The audio is not kept.",
      },
      steward: {
        title: "A steward, not a doctor",
        body: "NAQAH says it is automated, asks one question at a time, confirms numbers and camel names, accepts “I don’t know”, never diagnoses, and never says saved before the system has confirmed it.",
      },
    },
    emergency: "In an emergency, your worker calls you directly, never through NAQAH.",
    orbit: {
      figure: (attempts: number, minutes: number) =>
        `A missed report call on the sample evening: ${attempts} attempts, ${minutes} minutes apart, then it is shown as missed on your dashboard.`,
      attempt: (n: number) => `Attempt ${n}`,
      firstCall: "The call",
      missed: "Missed, shown on your dashboard",
      caption: "A missed report call on the sample evening",
    },
  },
  ar: {
    title: "ما تلتزم به ناقة",
    line: "ثلاث عادات تحفظ اطمئنانك، كيفما كانت الليلة.",
    principles: {
      retries: {
        title: (attempts: number) => `${attempts} محاولات، ثم تخبرك`,
        body: (attempts: number, minutes: number) =>
          `إذا ما رد العامل، تعيد ناقة الاتصال بعد ${minutes} دقيقة، ${attempts} محاولات بالكل، ثم تتوقف وتعرض لك المكالمة الفائتة في اللوحة. وأي تقرير محفوظ يوقف المحاولات.`,
      },
      facts: {
        title: "معلومات، لا تسجيلات",
        body: "ما قاله العامل فقط يتحول إلى معلومة تحمل وصفها. والصوت لا يُحفظ.",
      },
      steward: {
        title: "وكيل أمين، لا طبيب",
        body: "ناقة تقول إنها آلية، وتسأل سؤالًا واحدًا كل مرة، وتتأكد من الأرقام وأسماء الإبل، وتقبل «ما أدري»، ولا تشخّص، ولا تقول «حُفظ» قبل أن يؤكد النظام.",
      },
    },
    emergency: "في الطوارئ، يتصل العامل بك مباشرة، لا عبر ناقة.",
    orbit: {
      figure: (attempts: number, minutes: number) =>
        `مكالمة تقرير ما تمت في المساء التجريبي: ${attempts} محاولات بينها ${minutes} دقيقة، ثم تظهر لك في اللوحة على أنها فائتة.`,
      attempt: (n: number) => `المحاولة ${n}`,
      firstCall: "المكالمة",
      missed: "ما تمت، وتظهر لك في اللوحة",
      caption: "مكالمة تقرير ما تمت في المساء التجريبي",
    },
  },
});

/** «ما تلتزم به ناقة»: the retry orbit beside three principles, with the emergency line underneath. */
export function Reliability({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const attempts = REPORT_CALL_RETRIES + 1;
  const minutes = RETRY_DELAY_MS / 60_000;
  const principles = [
    { key: "retries", Icon: ArrowsClockwise, title: c.principles.retries.title(attempts), body: c.principles.retries.body(attempts, minutes) },
    { key: "facts", Icon: ClipboardText, title: c.principles.facts.title, body: c.principles.facts.body },
    { key: "steward", Icon: ChatCenteredText, title: c.principles.steward.title, body: c.principles.steward.body },
  ];

  return (
    <section id="reliability" aria-labelledby="reliability-title" className="scroll-mt-24 py-20 sm:py-24 lg:py-32">
      <div className="night-frame">
        <hr aria-hidden className="night-rule mb-14 lg:mb-20" />
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-6">
            <h2 id="reliability-title" className="night-title max-w-[14ch]">
              {c.title}
            </h2>
            <p className="mt-5 max-w-[30rem] text-lg leading-8 text-[var(--text-muted)]">{c.line}</p>
            <ol className="mt-10 space-y-8">
              {principles.map(({ key, Icon, title, body }) => (
                <li key={key} className="grid grid-cols-[auto_1fr] gap-x-4">
                  <Icon aria-hidden size={24} weight="light" className="mt-1 text-[var(--gold-bright)]" />
                  <div>
                    <h3 className="text-xl font-semibold leading-snug text-[var(--text)]">
                      <span className="ltr-nums">{title}</span>
                    </h3>
                    <p className="mt-2 max-w-[34rem] text-pretty leading-7 text-[var(--text-muted)]">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="lg:col-span-6 lg:pt-16">
            <RetryOrbit locale={locale} copy={c.orbit} />
          </div>
        </div>
        <p className="mt-14 flex items-center gap-3 border-t border-[var(--line)] pt-6 text-[var(--text-muted)] lg:mt-20">
          <PhoneCall aria-hidden size={20} weight="light" className="shrink-0 text-[var(--ember)]" />
          <span>{c.emergency}</span>
        </p>
      </div>
    </section>
  );
}
