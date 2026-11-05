# Onboarding wizard and settings

`/{locale}/start` sets up a farm in 9 steps; `/{locale}/app/settings` edits the same sections later.

## Sub-features
- `plan`, `owner-farm`, `herd`, `resources`, `worker`, `criteria`, `questions` (Basic: max 5 custom), `schedule`
  (Basic: day + start + end required, end after start), `review`.
- `sample`: "Fill sample data" fills every step.
- `settings`: plan switch with validation, reset demo, load sample Basic/Ultimate.

## How to get to it (user POV)
- Landing "Set up your farm"; dashboard gate "Set up your farm"; settings gear.

## Driving it with Playwright
Preconditions: empty localStorage.
- `/{locale}/start` → button matching /sample/i («عينة») → "Continue" «متابعة» ×8 → "Confirm and open dashboard".
- Expected: URL `/{locale}/app`, `workspace.setupComplete === true`, 9 step titles seen (`#current-step-title`).
  Asserted by `verify-naqah wizard`.

## Gotchas
- On mobile the sample button is labelled "Sample"/«عينة», not "Fill sample data".
- "Continue" is disabled until the step is valid; a disabled button means invalid data, not a slow page.
- Basic without a window cannot finish (by design: the owner must choose it).
