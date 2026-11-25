import type { Locale } from "@/domain/types";
import { getMessages, type Messages } from "@/i18n/messages";
import { PhoneStage } from "./PhoneStage";
import "./call.css";

export type CallCopy = Messages["landing"]["night"]["call"];

/** «المكالمة، كما تصير فعلًا»: the call story as one flat phone beside four steps. */
export function CallDimension({ locale }: { locale: Locale }) {
  const copy = getMessages(locale).landing.night.call;
  return (
    <section id="call" aria-labelledby="call-title" className="relative scroll-mt-24 pb-16 pt-20 sm:pt-24 lg:pb-24 lg:pt-28">
      <div className="night-frame">
        <hr aria-hidden className="night-rule mb-12 lg:mb-16" />
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
          <p>{copy.readback.title}</p>
          <ul>
            {copy.facts.map((fact) => (
              <li key={fact.topic}>
                {fact.topic}: {fact.value} ({fact.certainty})
              </li>
            ))}
          </ul>
          <p>
            {copy.readback.ask} {copy.readback.yes}. {copy.readback.saved}. {copy.readback.note}
          </p>
          <p>
            {copy.owner.time}: {copy.owner.summary} {copy.owner.none}
          </p>
        </div>
      </div>

      <PhoneStage copy={copy} />
    </section>
  );
}
