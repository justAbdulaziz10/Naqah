# Landing page

`/{locale}` public page: one photographic story (hero, the scroll-led call story, principles, plans, closing invitation).

## Sub-features
- `hero-demo`: "Explore the demo" «استكشف العرض التجريبي» starts the Ultimate sample ranch and opens `/app`.
- `locale`: language switch keeps the path.

## How to get to it (user POV)
- `/` redirects to `/ar` or `/en` (cookie, then Accept-Language).

## Driving it with Playwright
Preconditions: none.
- Open `/en`, click "Explore the demo" → expect URL `/en/app` and the overview greeting.
- `verify-naqah screens` covers layout (home-*.png, tall full-page shots).
- "Explore the demo" → `/app` with `settings.plan === "ultimate"`, and the language link keeping the path:
  asserted by `verify-naqah features`.
- `/` → 307 to `/ar`, or `/en` with `Accept-Language: en`.
- OG image (also `/en/opengraph-image.png`): `GET /-/opengraph-image.png` → 200 image/png.

## Gotchas
- The Vercel team alias (`*-abdulazizs-projects-*.vercel.app`) is behind Vercel SSO; use https://naqah.vercel.app.
