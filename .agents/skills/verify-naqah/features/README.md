# NAQAH feature map

Baseline: a production server from `verify-naqah launch` (or `--base https://naqah.vercel.app`), a fresh browser
context (empty localStorage). Start the sample farm through the real gate: `/{locale}/app` → button
"Explore the demo" / «استكشف العرض التجريبي» (Ultimate plan, worker Ahmed/أحمد, owner Abdullah/عبدالله).

Conventions: drive with Playwright via `scripts/verify-naqah.mjs`; prefer role + accessible name; read state back
from `localStorage["naqah-workspace-v1"].state.workspace` only to *check* results, never to set them up (exception:
renaming worker/owner to test name personalization). Arabic is the default locale and RTL.

Proof rules: every drive asserts an outcome (row added, ticket opened, text shown). Visual claims need a screenshot
you looked at, in both locales and at 375px and 1440px.

| Feature | File |
|---|---|
| Call Lab (all simulated calls) | [call-lab.md](call-lab.md) |
| Onboarding wizard + settings | [setup.md](setup.md) |
| Dashboard pages | [dashboard.md](dashboard.md) |
| Landing page | [landing.md](landing.md) |
| Phone line and Twilio webhooks | [phone.md](phone.md) |
