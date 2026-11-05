# WhatsApp links

## What it does

The Settings → Connections WhatsApp card stores a supplier name and Saudi mobile
number in the local workspace and provides a prefilled message link to the
worker. OrderSupplierLink creates a prefilled supplier message for selected
resources whose level is low or critical, including the farm name and reported
quantity.

Links use wa.me with a digits-only path and encoded text. WhatsApp opens the
message for the owner to review and send; NAQAH does not send messages.

## Where it appears

- Supplier name and mobile fields plus “Message the worker”: Settings →
  Connections.
- OrderSupplierLink: ready to mount under the farm resources on the dashboard.
- MessageWorkerLink: ready to mount in the dashboard emergency card.

## Environment variables

None. There is no WhatsApp API, account, or paid service.

## How to test

- Run npm test for Saudi phone normalization, invalid-number rejection,
  message text, and wa.me link generation.
- Run npm run lint, npm run typecheck, and npm run build.
- In Settings → Connections, enter a supplier name and a number such as
  05XXXXXXXX. Invalid or landline numbers show an error and do not produce a
  supplier WhatsApp action.
- Set feed or water to low or critical and mount OrderSupplierLink with
  kinds={["feed", "water"]} to see the prefilled order action.

## Limits

Only Saudi mobile formats are accepted: 05XXXXXXXX, +966 5X..., 9665..., and
Arabic-Indic digits. A deep link only opens WhatsApp with a draft; the owner
must review and send it. Messages are not tracked or confirmed in NAQAH.
