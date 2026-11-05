# Calendar integration

## What it does

The Settings → Connections calendar card creates a snapshot of the farm's report
rhythm and currently open scheduled task tickets. Owners can subscribe in Apple
Calendar or Outlook, subscribe through Google Calendar, or download an .ics
file. TaskCalendarLink provides Google Calendar and .ics actions for one
scheduled open ticket.

Basic workspaces use the configured weekly Riyadh window. Ultimate workspaces
use a daily 17:00–17:30 Riyadh report slot. Task times are exported as UTC
instants with a 30-minute event duration. The feed includes a 15-minute
reminder for the report event.

## Where it appears

- CalendarCard: Settings → Connections.
- TaskCalendarLink: ready to mount in open scheduled task rows on Tickets.

## Environment variables

None.

## How to test

- Run npm test for schedule serialization, ICS output, URL helpers, and the
  route handler.
- Run npm run lint, npm run typecheck, and npm run build.
- In the demo, open Settings → Connections, then try the Apple/Outlook
  subscription, Google subscription, and calendar download actions.
- Request the /api/calendar endpoint with a valid s query parameter and confirm
  the response is text/calendar; malformed or missing s returns 400.

## Limits

The subscription URL contains a base64url-encoded snapshot of the schedule and
open scheduled tasks. Re-add it after changing either. The link is not encrypted
or access-controlled: anyone who has it can read the farm name, task text, and
scheduled times. Since the feed is stateless, its snapshot cannot be revoked by
NAQAH after it has been shared. The URL payload is capped at about 3 KB and 50
tasks.
