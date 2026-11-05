"use client";

import { useI18n } from "@/i18n/client";

/**
 * The worker's call, set as a timestamped ledger: what was said, what was saved, and the owner
 * call that follows. Still by design (handoff §08: no endless animation); every row is readable.
 */
export function LiveTranscript() {
  const { m } = useI18n();
  const call = m.landing.call;
  const row = "grid grid-cols-[3rem_1fr] gap-x-4 border-b border-stone sm:grid-cols-[3rem_4.5rem_1fr]"; // taste-skill-ignore: ledger rows inside the product fragment (data-ui)

  return (
    <figure className="border-t-2 border-espresso">
      <figcaption className="flex items-baseline justify-between gap-4 py-4 text-sm">
        <span>
          <span className="font-semibold">{call.label}</span>
          <span className="mt-0.5 block text-muted">{m.landing.example}</span>
        </span>
        <span className="ltr-nums shrink-0 tabular-nums text-muted">17:42</span>
      </figcaption>

      <ol className={"border-t border-stone" /* taste-skill-ignore: ledger rule inside the product fragment */}>
        {call.lines.map((line, index) => {
          const naqah = line.who === "naqah";
          return (
            <li key={index} data-reveal="" data-reveal-delay={index * 70} className={`${row} py-3.5`}>
              <span className="ltr-nums pt-0.5 text-[0.8125rem] tabular-nums text-muted">{line.time}</span>
              <span className={`text-sm font-semibold ${naqah ? "text-brown" : "text-espresso"} max-sm:hidden`}>
                {naqah ? call.naqah : call.worker}
              </span>
              <p className={`text-base leading-relaxed ${naqah ? "text-muted" : "text-espresso"}`}>
                <span className={`me-2 font-semibold sm:hidden ${naqah ? "text-brown" : ""}`}>
                  {naqah ? call.naqah : call.worker}
                </span>
                {line.text}
              </p>
            </li>
          );
        })}

        <li data-reveal="" data-reveal-delay={call.lines.length * 70 + 100} className={`${row} py-4`}>
          <span className="ltr-nums pt-0.5 text-[0.8125rem] tabular-nums text-muted">17:44</span>
          <span className="text-sm font-semibold text-ok max-sm:hidden">{call.saved}</span>
          <div className="grid gap-2">
            <span className="text-sm font-semibold text-ok sm:hidden">{call.saved}</span>
            <dl className="grid gap-2">
              {call.facts.map((fact) => (
                <div key={fact.label} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="font-semibold">{fact.label}</dt>
                  <dd className="flex flex-wrap items-baseline gap-x-2">
                    <span>{fact.value}</span>
                    <span className="text-sm text-muted">{fact.certainty}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </li>

        <li data-reveal="" data-reveal-delay={call.lines.length * 70 + 260} className={`${row} border-b-0 py-4`}>
          <span className="ltr-nums pt-0.5 text-[0.8125rem] tabular-nums text-muted">17:44</span>
          <span className="max-sm:hidden" aria-hidden="true" />
          <p className="flex items-center gap-2.5 font-semibold text-brown">
            <span className="naqah-ring relative size-2 rounded-full bg-brown" aria-hidden="true" />
            {call.next}
          </p>
        </li>
      </ol>
    </figure>
  );
}
