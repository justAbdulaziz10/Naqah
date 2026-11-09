# Client JavaScript budget

`npm run budget` reads the prerendered HTML in `.next/server/app` and sums the gzip size of its referenced JavaScript
files in `.next/static`. It checks the Arabic landing page (`/ar`), dashboard overview (`/ar/app`), and signup page
(`/ar/signup`). Run it after `npm run build`; CI runs the same check after the production build.

The initial limits are 277 KiB, 314 KiB, and 224 KiB respectively. These are about 10% above the audited baseline
of 251.3 KiB, 285.4 KiB, and 203.4 KiB. To update a limit, first measure the routes on a production build, confirm the
change is intentional, then update the matching `maxGzipKiB` value in `scripts/bundle-budget.mjs` and record the new
baseline here. The checker fails when a route exceeds its limit or a referenced build artifact is missing.
