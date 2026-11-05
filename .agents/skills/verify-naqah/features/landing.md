# Landing page

`/{locale}` public page for investors: hero with animated call transcript, how it works, plans (no prices), principles.

## Sub-features
- `hero-demo`: "Explore the live demo" starts the sample farm and opens `/app`.
- `plan-demo`: "Try Basic in the demo" / "Try Ultimate in the demo".
- `locale`: language switch keeps the path.

## How to get to it (user POV)
- `/` redirects to `/ar` or `/en` (cookie, then Accept-Language).

## Driving it with Playwright
Preconditions: none.
- Open `/en`, click "Explore the live demo" → expect URL `/en/app` and the overview greeting.
- `verify-naqah screens` covers layout (home-*.png, tall full-page shots).
- OG image: `GET /-/opengraph-image.png` → 200 image/png.

## Gotchas
- The Vercel team alias (`*-abdulazizs-projects-*.vercel.app`) is behind Vercel SSO; use https://naqah.vercel.app.
