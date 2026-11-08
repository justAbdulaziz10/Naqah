"use client";

import { CalendarPlus } from "@phosphor-icons/react";
import type { TaskTicket } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { generateTaskIcs } from "@/lib/calendar/ics";
import { downloadIcs, googleEventUrl } from "@/lib/calendar/links";
import { scheduleForTask } from "@/lib/calendar/schedule";
import { useWorkspace } from "@/store/workspace";

const linkClass =
  "inline-flex min-h-11 items-center whitespace-nowrap px-1 font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown";

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

  // One short line on any width: the label once, then two compact choices that never break mid-name.
  const c = m.integrations.calendar;
  return (
    <div role="group" aria-label={c.addTask} className="mt-2 flex flex-wrap items-center gap-x-2 text-[0.9375rem]">
      <span className="inline-flex items-center gap-1.5 text-muted">
        <CalendarPlus size={16} aria-hidden />
        {c.addTask}
      </span>
      <button type="button" className={linkClass} aria-label={c.addTaskGoogle} onClick={openGoogleCalendar}>
        {c.addTaskGoogleShort}
      </button>
      <span aria-hidden className="text-stone">·</span>
      <button
        type="button"
        className={linkClass}
        onClick={() => downloadIcs("naqah-task.ics", generateTaskIcs(schedule))}
      >
        {c.addTaskOther}
      </button>
    </div>
  );
}
