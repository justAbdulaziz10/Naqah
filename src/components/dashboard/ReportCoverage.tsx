import type { FarmReport, Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { unreportedTopics } from "./reportCoverageFacts";

export function ReportCoverage({ ws, report }: { ws: Workspace; report: FarmReport }) {
  const { m, t, locale } = useI18n();
  const topics = unreportedTopics(ws, report, {
    health: m.app.overview.reportHealthTopic,
    count: m.app.overview.reportCountTopic,
    other: m.app.overview.reportOtherTopic,
  });
  return topics.length ? <p className="pb-4 text-sm leading-relaxed text-muted">{m.app.overview.reportNotMentioned(topics.map(t).join(locale === "ar" ? "، " : ", "))}</p> : null;
}
