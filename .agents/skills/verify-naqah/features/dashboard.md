# Dashboard

`/{locale}/app` (overview), `/app/herd`, `/app/tickets`, `/app/calls`.

## Sub-features
- `overview`: last update + caveats, findings, resource meters with certainty, herd summary, open items, emergency card.
- `herd`: list, filter, search, add/edit/remove camel.
- `tickets`: Ultimate task tickets (active/history), No Answer tickets, Basic relays.
- `calls`: call log grouped by day, expandable report answers, "never recorded" note.

## How to get to it (user POV)
- Sidebar (desktop) or bottom tabs (mobile); overview cards link to herd/tickets/calls.

## Driving it with Playwright
Preconditions: sample farm started.
- `verify-naqah screens` visits all of them in both locales and viewports; inspect
  `artifacts/verify/screens/<ts>/{ar,en}-{m,d}-app*.png`.
- Herd "Add camel" dialog (Name, Tag, Save) is asserted by `verify-naqah features`. Remove and settings "Reset demo"
  use `window.confirm`; accept the dialog in Playwright (`page.once("dialog", d => d.accept())`).
- After `call-lab`, `/app/tickets` shows the new task and the No Answer ticket; `/app/calls` shows the new calls.

## Gotchas
- A page stuck on the centred camel = store never hydrated (see AGENT.md §9 pitfalls).
- Answers render `answerText` in the UI language; English inside Arabic UI is a bug.
