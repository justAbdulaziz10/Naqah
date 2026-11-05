"use client";

import type { TaskTicket } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { generateTaskIcs } from "@/lib/calendar/ics";
import { downloadIcs, googleEventUrl } from "@/lib/calendar/links";
import { scheduleForTask } from "@/lib/calendar/schedule";
import { useWorkspace } from "@/store/workspace";

const linkClass =
  "inline-flex min-h-11 items-center text-brown underline decoration-stone underline-offset-4 hover:decoration-brown focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown";

export function TaskCalendarLink({ ticket }: { ticket: TaskTicket }) {
  const ws = useWorkspace();
  const { locale, m } = useI18n();
  if (!ws || ticket.status !== "open" || !ticket.scheduledFor) return null;

  const schedule = scheduleForTask(ws, ticket, locale);
  if (!schedule) return null;
  const openGoogleCalendar = () => {
    if (typeof window === "undefined") return;
    const start = new Date(ticket.scheduledFor!);
    if (!Number.isFinite(start.getTime())) return;
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const googleUrl = googleEventUrl({
      title: ticket.instruction,
      start,
      end,
      details: m.integrations.calendar.taskDetails(ws.settings.farm.name),
    });
    if (typeof window.open === "function") {
      window.open(googleUrl, "_blank", "noopener,noreferrer");
    } else if (typeof window.location.assign === "function") {
      window.location.assign(googleUrl);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <button type="button" className={linkClass} onClick={openGoogleCalendar}>
        {m.integrations.calendar.addTaskGoogle}
      </button>
      <button
        type="button"
        className={linkClass}
        onClick={() => downloadIcs("naqah-task.ics", generateTaskIcs(schedule))}
      >
        {m.integrations.calendar.downloadTask}
      </button>
    </div>
  );
}
