import { defineMessages } from "../../types";

/** Strings for the "Calendar" integration. Keep both locales in lockstep. */
export const calendar = defineMessages({
  en: {
    title: "Calendar",
    subscribeApple: "Add to Apple or Outlook",
    subscribeGoogle: "Add to Google Calendar",
    download: "Download calendar file",
    note: "Re-add after you change the schedule.",
    oversized: "This calendar has too much scheduled detail. Shorten task names or reduce scheduled tasks.",
    downloadUnavailable: "This browser could not download the calendar file.",
    addTaskGoogle: "Add to Google Calendar",
    downloadTask: "Download .ics",
    reportTitle: "Farm update",
    reportReminder: "Reminder: Farm update",
    farmDetails: (farm: string) => "Farm: " + farm,
    taskDetails: (farm: string) => "Farm task for " + farm,
  },
  ar: {
    title: "التقويم",
    subscribeApple: "أضف إلى Apple أو Outlook",
    subscribeGoogle: "أضف إلى Google Calendar",
    download: "نزّل ملف التقويم",
    note: "بعد تغيير الجدول، أعد إضافته.",
    oversized: "تفاصيل التقويم كثيرة. اختصر نص المهام أو قلّل عدد المهام المجدولة.",
    downloadUnavailable: "ما قدرنا ننزّل ملف التقويم من هذا المتصفح.",
    addTaskGoogle: "أضف إلى Google Calendar",
    downloadTask: "نزّل ملف .ics",
    reportTitle: "تحديث المزرعة",
    reportReminder: "تذكير: تحديث المزرعة",
    farmDetails: (farm: string) => "المزرعة: " + farm,
    taskDetails: (farm: string) => "مهمة للمزرعة: " + farm,
  },
});
