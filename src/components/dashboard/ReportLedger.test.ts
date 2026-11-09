import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { completeWorkerReport } from "@/domain/actions";
import { createDemoWorkspace } from "@/domain/seed";
import type { Locale, LocalizedText } from "@/domain/types";
import { getMessages } from "@/i18n/messages";
import { ReportLedger } from "./ReportLedger";

const language = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("@/i18n/client", () => ({
  useI18n: () => ({
    locale: language.locale,
    m: getMessages(language.locale),
    t: (text: LocalizedText) => text[language.locale],
    fmt: { time: () => "17:00", dateTime: () => "9 Nov 2026" },
    href: (path: string) => `/${language.locale}${path}`,
  }),
}));

describe("latest-report ledger", () => {
  it.each(["ar", "en"] as const)("shows omissions once and never presents older supplies in %s", (locale) => {
    language.locale = locale;
    const ws = createDemoWorkspace(locale, "ultimate");
    ws.resources.find((resource) => resource.kind === "feed")!.quantity = "42 older feed bags";
    const saved = completeWorkerReport(ws, new Date("2026-11-09T14:00:00.000Z"), {
      answers: [], camelUpdates: [], resourceUpdates: [], taskConfirmations: [], herdAccountedFor: null, mode: "open",
      coverage: [{ questionId: "feed_level", status: "not_reported" }, { questionId: "water_level", status: "not_reported" }],
    });
    const html = renderToStaticMarkup(createElement(ReportLedger, { ws: saved.ws, report: saved.report, worker: "Salem" }));
    const copy = locale === "ar" ? "ما ذُكر في هذا التحديث: العلف، الماء" : "Not mentioned in this update: Feed, Water";
    expect(html.split(copy)).toHaveLength(2);
    expect(html).not.toContain("42 older feed bags");
    expect(html).not.toContain(locale === "ar" ? "قارب على النفاد" : "Running low");
  });

  it("does not add an omissions line to a legacy report", () => {
    language.locale = "en";
    const ws = createDemoWorkspace("en", "ultimate");
    const html = renderToStaticMarkup(createElement(ReportLedger, { ws, report: ws.reports.at(-1)!, worker: "Salem" }));
    expect(html).not.toContain("Not mentioned in this update");
  });
});
