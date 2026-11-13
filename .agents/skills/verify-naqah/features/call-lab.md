# Call Lab

`/{locale}/app/lab` simulates every call NAQAH handles, with a demo clock to skip time. Each call ends by saving
through the same pure domain actions a real voice agent would call.

## Sub-features
- `report_call`: NAQAH calls the worker for the report at the scheduled time (once per period); he answers or it rings out.
- `owner-notify`: NAQAH calls the owner with the summary; on Ultimate the owner may give instructions (task or info).
- `worker_outbound`: NAQAH calls the worker to deliver/verify (Ultimate); 3 attempts 20 min apart, then calls stop.
  No No Answer ticket is opened; the task stays open.
- `worker_inbound`: the worker calls NAQAH: a missed message, a missed report call, or "we'll call you". Not a report.
- `owner_inquiry`: the scenario card still exists; on a real line an owner calling in hears a short closed line.
- `emergency`: info only; worker calls the owner directly.
- `clock`: +20 min and "Jump to the call time".

## How to get to it (user POV)
- Sidebar / bottom tab "Call Lab" «مختبر المكالمات»; demo strip "Simulate a call" «محاكاة مكالمة»; tickets "Verify now".

## Driving it with Playwright
Preconditions: sample farm started (see README).
- Pick scenario card by name ("NAQAH calls Ahmed for the report", "Ahmed calls NAQAH", "NAQAH calls Ahmed with a
  message", "Owner calls NAQAH", "Emergency"). `call-lab` starts with "Call Ahmed now · Simulation".
- "Start preview" «بدء التجربة» → quick replies are buttons in the phone footer; text/number/time questions show an
  input + "Send" «إرسال».
- After a saved report: "Continue to owner call" «متابعة اتصال المالك». After an owner instruction:
  "Continue to Ahmed's call" «متابعة اتصال أحمد». Missed attempt: "No answer" «ما رد» then "Skip 20 minutes" «تجاوز 20 دقيقة».
- Expected: `workspace.reports` +1; `taskTickets` +1 open; `pendingWorkerCalls[].state` → `no_answer_ticket` after
  exactly 3 attempts; no open `noAnswerTickets`; transcript says calls stopped; the task stays open. All asserted by
  `verify-naqah call-lab`.
- Emergency, the clock and "Simulate a heat day" «محاكاة يوم حار» (the report then asks the water-and-shade
  question): asserted by `verify-naqah features`.

## Gotchas
- Emergency has no "Start preview": selecting the card shows the direct-call info at once.
- Replies render after a typing delay (~1.5 s); wait before reading buttons.
- Picking "Yes, another" forever loops through every camel — prefer "No, that's all".
- The sample's open task gets confirmed in the worker report, so count tickets right before the owner call.
- Names in Lab copy come from the workspace (`personalize.ts`); the sample names are left as-is per locale.
- The call in progress lives in memory: it survives a language switch but not a reload.
