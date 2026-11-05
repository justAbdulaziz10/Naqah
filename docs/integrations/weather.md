# Weather and farm location

## What it does

Stores optional farm coordinates, fetches a one-day Open-Meteo forecast for Riyadh time, and uses a current hot forecast to ask the worker whether the camels have enough water and shade. A "Not enough" answer is saved as a report finding. Forecast failures leave the last saved snapshot in place.

The automatic fetch is limited to once per three hours. The Settings refresh button is an explicit manual request and can refresh sooner.

## Where it appears

- **Setup and farm settings:** use the device location or choose one of 13 Saudi region presets. The selected region stores its approximate centre coordinates.
- **Settings → Connections:** the Weather and location card shows the saved location, coordinate status, latest forecast and refresh action.
- **Dashboard:** `WeatherLine` renders the current Riyadh-day forecast below the greeting. Add its mount to `src/app/[locale]/app/page.tsx` as described below.
- **Call Lab:** `withDemoHeat` is available for a deterministic hot-day demonstration. Add its clock-row button as described below.
- **Worker details:** browsers that expose `navigator.contacts.select` show a contact picker for the worker name and phone.

## Environment variables

None. Open-Meteo is called directly from the browser and does not require a key.

## How to test

Run `npm test` for the Riyadh-date and heat thresholds, Saudi region presets, Open-Meteo parsing/error/timeout handling, and worker report behavior. In the app, choose a region or use device location, then open Settings → Connections to see the latest forecast. On a supported Android browser, choose a worker from contacts.

After wiring the two requested mounts, use the dashboard line to see today's forecast and the Lab button to add a 46° snapshot. Start a worker report in the Lab: the water-and-shade question should be first, and answering "Not enough" should add a finding when the report is saved.

## Limits

- Preset coordinates are approximate city-centre points, not farm boundaries.
- Device location requires browser support, a secure context and user permission. A denied request or timeout leaves the saved location unchanged.
- Contact Picker availability depends on the browser; the button is hidden unless `navigator.contacts.select` exists. The picker is user-triggered and browser-owned.
- Forecast requests time out after six seconds. The dashboard line is hidden when the stored forecast is for a different Riyadh date.
- The weather question records the worker's report only. It does not create a task, send a notification, or diagnose heat stress.

## Required mounts

In `src/app/[locale]/app/page.tsx`, import the component:

```tsx
import { WeatherLine } from "@/components/dashboard/WeatherLine";
```

Place it immediately below the dashboard greeting heading:

```tsx
<h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-espresso sm:text-[2.25rem]">{greeting(ownerName)}</h1>
<WeatherLine />
```

In `src/components/lab/LabPage.tsx`, add the helper import:

```tsx
import { withDemoHeat } from "@/domain/weather";
```

Add this button to the existing clock-row button group:

```tsx
<Button variant="secondary" size="sm" className="min-h-11" onClick={() => update((ws) => withDemoHeat(ws, now))}>
  {m.integrations.weather.simulateHeatDay}
</Button>
```
