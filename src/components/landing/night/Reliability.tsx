import { ArrowsClockwise, ChatCenteredText, ClipboardText, PhoneCall } from "@phosphor-icons/react/dist/ssr";
import type { Locale } from "@/domain/types";
import { REPORT_CALL_RETRIES } from "@/domain/clock";
import { getMessages } from "@/i18n/messages";
import { RetryTimeline } from "./RetryTimeline";

/** «ما تلتزم به ناقة»: what happens when a call goes unanswered, beside three principles, with the emergency line underneath. */
export function Reliability({ locale }: { locale: Locale }) {
  const c = getMessages(locale).landing.night.reliability;
  const attempts = REPORT_CALL_RETRIES + 1;
  const principles = [
    { key: "retries", Icon: ArrowsClockwise, title: c.principles.retries.title(attempts), body: c.principles.retries.body },
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
          <div className="lg:col-span-6 lg:pt-4">
            <RetryTimeline locale={locale} copy={c.retry} />
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
