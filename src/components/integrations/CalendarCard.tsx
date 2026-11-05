"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { generateIcs } from "@/lib/calendar/ics";
import { downloadIcs, googleSubscribeUrl, webcalUrl } from "@/lib/calendar/links";
import { encodeSchedule, scheduleFromWorkspace } from "@/lib/calendar/schedule";
import { useWorkspace } from "@/store/workspace";

/** Settings → Connections → calendar. Owned by the calendar integration slice. */
export function CalendarCard() {
  const { locale, m } = useI18n();
  const ws = useWorkspace();
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [scheduleTooLarge, setScheduleTooLarge] = useState(false);

  const makeFeed = () => {
    if (!ws) return null;
    try {
      const schedule = scheduleFromWorkspace(ws, locale);
      const encoded = encodeSchedule(schedule);
      setScheduleTooLarge(false);
      return { schedule, encoded };
    } catch {
      setScheduleTooLarge(true);
      return null;
    }
  };

  const openAppleCalendar = () => {
    const feed = makeFeed();
    if (!feed || typeof window === "undefined") return;
    const location = window.location;
    if (!location?.origin || typeof location.assign !== "function") return;
    location.assign(webcalUrl(location.origin, feed.encoded));
  };
  const openGoogleCalendar = () => {
    const feed = makeFeed();
    if (!feed || typeof window === "undefined") return;
    const location = window.location;
    if (!location?.origin) return;
    const googleUrl = googleSubscribeUrl(webcalUrl(location.origin, feed.encoded));
    if (typeof window.open === "function") {
      window.open(googleUrl, "_blank", "noopener,noreferrer");
    } else if (typeof location.assign === "function") {
      location.assign(googleUrl);
    }
  };

  return (
    <Card>
      <CardHeader title={m.integrations.calendar.title} />
      <CardBody className="pt-3">
        {ws ? (
          <>
            <div className="flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:gap-x-5">
              <button
                type="button"
                onClick={openAppleCalendar}
                className="inline-flex min-h-11 items-center text-brown underline decoration-stone underline-offset-4 hover:decoration-brown focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown"
              >
                {m.integrations.calendar.subscribeApple}
              </button>
              <button
                type="button"
                onClick={openGoogleCalendar}
                className="inline-flex min-h-11 items-center text-brown underline decoration-stone underline-offset-4 hover:decoration-brown focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown"
              >
                {m.integrations.calendar.subscribeGoogle}
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-brown underline decoration-stone underline-offset-4 hover:decoration-brown focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown"
                onClick={() => {
                  const feed = makeFeed();
                  if (feed) setDownloadFailed(!downloadIcs("naqah.ics", generateIcs(feed.schedule)));
                }}
              >
                {m.integrations.calendar.download}
              </button>
            </div>
            <p className="mt-2 text-sm text-muted">{m.integrations.calendar.note}</p>
            {downloadFailed ? <p className="mt-2 text-sm text-danger" role="alert">{m.integrations.calendar.downloadUnavailable}</p> : null}
            {scheduleTooLarge ? <p className="mt-2 text-sm text-danger" role="alert">{m.integrations.calendar.oversized}</p> : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
