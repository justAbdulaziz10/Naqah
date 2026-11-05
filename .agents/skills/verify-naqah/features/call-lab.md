# Call Lab

`/{locale}/app/lab` simulates every call NAQAH handles, with a demo clock to skip time. Each call ends by saving
through the same pure domain actions a real voice agent would call.

## Sub-features
- `report`: worker calls in his update (gated by plan window / once per period).
- `owner-notify`: NAQAH calls the owner with findings; owner may leave an instruction (Ultimate: task or info).
- `worker-outbound`: NAQAH calls the worker to deliver/verify; 3 retries 20 min apart, then a No Answer ticket.
- `callback`: worker calls back while a No Answer ticket is open → message delivery, not a report.
- `owner-inquiry`: owner asks about stored data (Basic: one call per week).
- `emergency`: info only; worker calls the owner directly.
- `clock`: +20 min, +1 hour, next day 17:00, jump to Basic window.

## How to get to it (user POV)
- Sidebar / bottom tab "Call Lab" «مختبر المكالمات»; demo strip "Simulate a call" «محاكاة مكالمة»; tickets "Verify now".

## Driving it with Playwright
Preconditions: sample farm started (see README).
- Pick scenario card by name ("Ahmed calls in his update", "NAQAH calls Ahmed", "Owner calls NAQAH", "Emergency").
- "Start preview" «بدء التجربة» → quick replies are buttons in the phone footer; text/number/time questions show an
  input + "Send" «إرسال».
- After a saved report: "Continue to owner call" «متابعة اتصال المالك». After an owner instruction:
  "Continue to Ahmed's call" «متابعة اتصال أحمد». Missed attempt: "No answer" «ما رد» then "Skip 20 minutes" «تجاوز 20 دقيقة».
- Expected: `workspace.reports` +1; `taskTickets` +1 open; `pendingWorkerCalls[].state` → `no_answer_ticket`;
  `noAnswerTickets` +1; transcript contains "No Answer Ticket"; then "Ahmed calls in his update" again routes to the callback: ticket
  `closed`, `reports` unchanged. All asserted by `verify-naqah call-lab`.
- Owner inquiry, emergency, the clock and "Simulate a heat day" «محاكاة يوم حار» (worker report then opens with
  the water-and-shade question): asserted by `verify-naqah features`.

## Gotchas
- Emergency has no "Start preview": selecting the card shows the direct-call info at once.
- While a No Answer ticket is open, the worker card starts a callback, not a report.
- Replies render after a typing delay (~1.5 s); wait before reading buttons.
- Picking "Yes, another" forever loops through every camel — prefer "No, that's all".
- The sample's open task gets confirmed in the worker report, so count tickets right before the owner call.
- Names in Lab copy come from the workspace (`personalize.ts`); the sample names are left as-is per locale.
- The call in progress lives in memory: it survives a language switch but not a reload.
