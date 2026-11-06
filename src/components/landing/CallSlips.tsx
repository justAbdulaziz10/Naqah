import type { ReactNode } from "react";
import type { Locale } from "@/domain/types";
import { getMessages } from "@/i18n/messages";
import { AnswerCall } from "./LandingActions";

/** A slip of the evening's paperwork. Its lower end runs off the section on desktop, like a receipt. */
function Slip({
  time,
  title,
  tone = "paper",
  delay,
  className,
  children,
}: {
  time: string;
  title: string;
  tone?: "paper" | "night";
  delay: number;
  className: string;
  children: ReactNode;
}) {
  return (
    <li
      data-reveal=""
      data-reveal-kind="slip"
      data-reveal-delay={delay}
      className={`naqah-slip p-6 pb-8 sm:p-8 lg:-mb-10 lg:pb-28 ${tone === "night" ? "bg-espresso text-cream" : "bg-cream text-espresso"} ${className}`}
    >
      <p className={`text-[2.75rem] font-light leading-none tabular-nums ${tone === "night" ? "text-sand" : "text-brown"}`}>
        <span className="ltr-nums">{time}</span>
      </p>
      <h3 className="mt-4 text-2xl font-medium leading-snug">{title}</h3>
      {children}
    </li>
  );
}

/** The call as its own output: what was said, what was kept, and the phone that rings. */
export function CallSlips({ locale }: { locale: Locale }) {
  const { call, example } = getMessages(locale).landing;

  return (
    <ol data-ui className="grid items-end gap-3 lg:grid-cols-12">
      <Slip time="17:42" title={call.workerTitle} delay={0} className="lg:col-span-4 [--tilt:-1deg]">
        <ul className="mt-5 grid gap-3">
          {call.lines.map((line) => (
            <li key={line.text} className="text-[1.0625rem] leading-relaxed">
              <span className="me-2 font-semibold text-brown">{line.who === "naqah" ? call.naqah : call.worker}</span>
              {line.text}
            </li>
          ))}
        </ul>
      </Slip>

      <Slip time="17:44" title={call.savedTitle} delay={110} className="lg:col-span-3 [--tilt:0deg]">
        <dl className="mt-5 grid gap-4">
          {call.facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-[0.9375rem] font-semibold text-brown">{fact.label}</dt>
              <dd className="text-[1.0625rem] leading-relaxed">
                {fact.value} <span className="text-[0.9375rem] text-muted">{fact.certainty}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Slip>

      <Slip time="17:45" title={call.ownerTitle} tone="night" delay={220} className="lg:col-span-5 [--tilt:0.8deg]">
        <AnswerCall />
        <p className="mt-5 text-[0.9375rem] text-cream/75">
          {call.label}. {example}
        </p>
      </Slip>
    </ol>
  );
}
