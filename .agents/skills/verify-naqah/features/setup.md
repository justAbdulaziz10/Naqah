# Onboarding wizard and settings

`/{locale}/start` sets up a ranch in 4 steps: Ranch → Workers and herd → Report call → Ready. The step lives in the
URL (`?step=2`). `/{locale}/app/settings` edits the same sections later.

## Sub-features
- `ranch`: ranch name, owner name and mobile.
- `team`: workers (Basic up to 3, Ultimate up to 10; NAQAH calls the primary one), herd, what the ranch has.
- `call`: the worker's report day and time, the owner's own summary day and time, questions (Basic: max 5 custom).
- `ready`: review, then "Open dashboard" «افتح لوحة العزبة».
- `settings`: plan switch with validation, reset demo, load sample Basic/Ultimate.

## How to get to it (user POV)
- Directly at `/{locale}/start`, or from the landing and the dashboard gate; later from Settings.

## Driving it with Playwright
Preconditions: empty localStorage.
- `/{locale}/start` → fill "Ranch name", "Your name", "Your mobile" → "Continue" «متابعة» → worker "Name" and
  "Mobile" → "Continue" → "Day"/"Time" and "Your day"/"Your time", "Add a question" + "Add" → "Continue" →
  "Open dashboard".
- Expected: URL `/{locale}/app`, `workspace.setupComplete === true`, 4 step titles seen (`#current-step-title`),
  the owner's summary time kept after a reload. Asserted by `verify-naqah wizard`.
- Settings "Load sample Ultimate farm" → `settings.plan === "ultimate"`: asserted by `verify-naqah features`.

## Gotchas
- "Continue" is disabled until the step is valid; a disabled button means invalid data, not a slow page.
- Required to finish: ranch name, primary worker (name and mobile) and both call times.
- The per-step «تعبئة تجريبية» fill exists only in builds with `NEXT_PUBLIC_NAQAH_DEMO_AUTOFILL=1` (local runner).
