# Landing page

`/{locale}` public page for investors: hero with animated call transcript, how it works, plans (no prices), principles.

## Sub-features
- `hero-demo`: "Explore the demo" starts the sample farm and opens `/app`.
- `plan-demo`: "Try Basic" «جرّب الأساسية» / "Try Ultimate" «جرّب المتكاملة».
- `locale`: language switch keeps the path.

## How to get to it (user POV)
- `/` redirects to `/ar` or `/en` (cookie, then Accept-Language).

## Driving it with Playwright
Preconditions: none.
- Open `/en`, click "Explore the demo" → expect URL `/en/app` and the overview greeting.
- `verify-naqah screens` covers layout (home-*.png, tall full-page shots).
- "Try Basic" «جرّب الأساسية» → `/app` with `settings.plan === "basic"`, and the language link keeping the path:
  asserted by `verify-naqah features`.
- `/` → 307 to `/ar`, or `/en` with `Accept-Language: en`.
- OG image (also `/en/opengraph-image.png`): `GET /-/opengraph-image.png` → 200 image/png.

## Gotchas
- The Vercel team alias (`*-abdulazizs-projects-*.vercel.app`) is behind Vercel SSO; use https://naqah.vercel.app.
