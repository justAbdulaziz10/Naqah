# Client JavaScript budget

`npm run budget` reads the prerendered HTML in `.next/server/app` and sums the gzip size of its referenced JavaScript
files in `.next/static`. It checks the Arabic landing page (`/ar`), dashboard overview (`/ar/app`), and signup page
(`/ar/signup`). Run it after `npm run build`; CI runs the same check after the production build.

The limits are 241 KiB, 275 KiB, and 309 KiB respectively: about 10% above the values measured on 2026-11-09 after the locale-catalog split (219, 250 and 281 KiB). The active-locale catalog (~18 KiB gzip) loads as a separate dynamic chunk and is not counted here.
To update a limit, first measure the routes on a production build, confirm the
change is intentional, then update the matching `maxGzipKiB` value in `scripts/bundle-budget.mjs` and record the new
baseline here. The checker fails when a route exceeds its limit or a referenced build artifact is missing.
