# Owner phone authentication

Branch: `feature/owner-auth`. Approved base: `c2db6d536ab97ae257d733f1ff3bf1e880933869`.

## Routes and behavior

- `/ar/login`, `/en/login`: owner phone → SMS code.
- `/ar/signup`, `/en/signup`: the same supported Supabase phone OTP flow, with sign-up wording.
- Both call the `sendOwnerOtp` Server Action, which validates the number, applies the app's limits, then calls `signInWithOtp({ phone, options: { shouldCreateUser: true, channel: 'sms', captchaToken } })`. New owners can be created by Supabase; existing owners sign in. Neither flow reports whether an account exists. No profile or farm data is collected or written.
- `verifyOtp({ phone, token, type: 'sms' })` writes the session through the SSR browser cookie adapter. The browser then fully navigates to `/{locale}/login/success`.
- The success route calls `getOwner()` → `auth.getUser()` on the server. It shows a signed-in confirmation and logout by default. With a validated `next`, it redirects there only after server validation. Unauthenticated requests return to localized login. Configuration/network outages show an unavailable message.
- `safeReturnPath` only accepts `/ar` or `/en` paths. It rejects external/protocol-relative URLs, backslashes, whitespace/control characters, malformed encoding, traversal outside locale paths, and login/signup loops. Validation runs both before forwarding `next` and on the success route. API endpoints are not accepted as return destinations.
- Phone input accepts Saudi mobile local format, nine-digit national format, `966`, `+966` and `00966` international formats, spaces/dashes/parentheses, invisible direction marks from pasted contacts, and Arabic/Persian digits; sends E.164. Landlines and foreign numbers are rejected because this is Saudi SMS authentication.
- SMS codes use six digits. Wrong and expired codes share one message. Resend waits 60 seconds after successful sends and rate limits; changing phone preserves the current page's cooldown. The code step and its timer survive a reload or language switch for 10 minutes through `sessionStorage`. Supabase rate limits remain authoritative.
- `LogoutButton` calls the logout Server Action: `signOut({ scope: 'local' })`, writes deletion cookies, and redirects to localized login only on success. This signs out the current session, not every device. Supabase access JWTs can remain valid until expiry; sensitive operations must validate with `getOwner()`/`getUser()` and appropriate RLS.

## Environment and owner configuration

Set only these public variables in ignored `.env.local` or the deployment's environment mechanism:

```text
NEXT_PUBLIC_SUPABASE_URL=<project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

`.env.local` is ignored by the existing `.gitignore`. Public variables are inlined at build time; rebuild after configuring or changing them. Missing/invalid configuration disables the phone form with a translated message. No service-role key is required.

The project owner must enable Supabase Phone Auth, allow new phone sign-ups for this combined flow, configure an SMS provider that can deliver to Saudi mobiles, confirm six-digit OTP settings/expiry, and set the production Site URL. OTP verification here does not require an OAuth/email callback route. No dashboard, provider, account, migration, RLS, telephony, or deployment configuration was changed.

## Abuse protection: required before real SMS is enabled

The publishable key is public, so anyone can call Supabase `/auth/v1/otp` directly and skip this app. The app's limits cannot stop that. Treat the first three items below as release blockers.

1. **CAPTCHA (Supabase → Authentication → Attack Protection).** Create a Cloudflare Turnstile widget for the production domain, save its secret in Supabase, enable CAPTCHA, and set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` before rebuilding. Set the site key first: with CAPTCHA on and no key, every send fails. The form shows the widget only when the key is set and sends its single-use token through `sendOwnerOtp`. A browser that blocks `challenges.cloudflare.com` cannot pass the check and sees a retry message.
2. **Rate limits (Authentication → Rate Limits).** Lower the project-wide SMS limit to the expected volume, keep the per-number send interval at 60 seconds or more, and keep OTP expiry short. Failed-verification limits are per IP, and verification runs from the visitor's browser, so they see the real address.
3. **SMS spend caps (at the SMS provider, e.g. Twilio).** Set a hard monthly limit and a low balance with auto-recharge off, add usage alerts, and allow only Saudi Arabia (+966) in the provider's messaging geo permissions. Enable its SMS pumping protection if offered. Supabase has no spending cap for SMS, so this is what bounds the bill.
4. **Optional, strongest option.** A Supabase Send SMS Auth Hook pointing at a server endpoint can refuse delivery with shared, durable limits, including for direct API calls.

What the app enforces (`src/lib/supabase/otp-limit.ts`): Saudi numbers only, a CAPTCHA token when the site key is set, and 5 accepted sends per number and 30 per IP in 15 minutes. Only sends Supabase accepts count, so a bad CAPTCHA, a provider failure or an outage never uses up an owner's attempts. Visitors with no known address get no shared IP limit. These limits live in each server instance's memory, so they reset on cold starts and are not shared between instances. Server Actions also reject cross-origin posts.

Because codes are sent from the server, Supabase sees the server's address on `/otp`, not the visitor's. Supabase's SMS limit is project-wide, so that limit is unaffected. Forwarding the visitor's address with `Sb-Forwarded-For` would need a secret key, which this flow deliberately avoids. **Check in the first live test:** Supabase passes that address to Turnstile; confirm a send succeeds with CAPTCHA enabled. If it fails, verify the token in `sendOwnerOtp` or send from the browser instead.

Dependencies are exactly pinned: `@supabase/ssr@0.12.7`, `@supabase/supabase-js@2.119.0`. Existing dependency versions were preserved. The proxy uses `getClaims()` for cookie refresh, retains all original locale logic/exclusions, and adds no route gate. Auth-server outages do not block the demo: the proxy stops waiting after 2 seconds, `getOwner()` after 3 (reported as unavailable), sending after 10 and logout after 5. Session cookies are `Secure` outside `next dev` and `SameSite=Lax`. They are not `HttpOnly` because verification runs in the browser client, which writes them. Its cookie adapter forwards Supabase's cache-control headers with refreshed cookies. Server Components use the read client; cookie-mutating Server Actions must use `createWritableClient`.

Official references: [phone OTP](https://supabase.com/docs/guides/auth/phone-login), [SSR clients and server validation](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [OTP API](https://supabase.com/docs/reference/javascript/auth-signinwithotp), [session limitations](https://supabase.com/docs/guides/auth/server-side/advanced-guide). Installed Next.js 16.4.5 local docs reviewed: Proxy, cookies, and authentication with Cache Components. Session/search-parameter reads sit behind Suspense boundaries.

## Product integration points (owner follow-up; unchanged here)

- Welcome/landing navigation: `src/components/landing/LandingPage.tsx`, header beside `LocaleSwitcher`/`DemoAction`, and mobile menu entries in `LandingActions.tsx::MobileNavigation`. Add separate login/signup links using `href('/login')` and `href('/signup')`; keep `DemoAction` intact.
- Setup entry: link to `/{locale}/signup?next=` plus `encodeURIComponent('/' + locale + '/start')` when the owner chooses to connect setup. `src/app/[locale]/start/page.tsx::StartPage` and `confirmSetup()` currently own demo setup and the final `/app` navigation. Authentication does not replace that handler or persist its workspace.
- Dashboard controls: `src/components/shell/AppShell.tsx`, desktop sidebar footer beside `LocaleSwitcher` and mobile header beside the locale/settings controls. Add a login link using `href('/login')` (optionally `next=/{locale}/app`) and mount `LogoutButton` when server-validated identity is available.
- Any future server data operation must call `getOwner()` and enforce ownership/RLS at the operation. Proxy refresh alone is not authorization. Do not use `setupComplete`, workspace presence, localStorage, or client session presentation as identity proof.
- Auth copy is registered in `getMessages` as `m.auth`.
- The service worker never stores `/login`, `/signup`, `/login/success` or any `no-store` response.

## Verification

- `npx next typegen` generates the route helpers required by the repository's existing `PageProps`/`LayoutProps` references before standalone typechecking.
- `npm test`: 286 tests passed in 29 files, including auth input, error mapping, SSR refresh/cookie/cache headers, fresh server identity validation, missing configuration, and logout behavior with mocks.
- `npm run typecheck`, `npm run lint`: passed. `npm run build`: passed in the shorter Windows worktree path. Initial attempts encountered restricted font downloads and a Turbopack worker failure in the long workspace path; no application configuration was changed to bypass them.
- `scripts/qa-owner-auth.mjs` against the production server: ar/en × 375/1440 passed invalid phone, normalized send payload, duplicate send/verify prevention, wrong/expired codes, cooldown/resend, change phone, rate limits, network error text, input direction, and no horizontal overflow. Browser Auth requests are intercepted and server sends go to a local stub, so the build must point at `http://127.0.0.1:54399` (see the script header); mocks exist only in this QA script and unit tests.
- Existing `scripts/qa-screens.mjs` against the production server: full demo journey screenshots, ar/en × 375/1440, reported `NO PROBLEMS`.
- Separate dev server with blank public auth variables: configuration-unavailable UI and disabled phone field verified in both locales. Production browser check verified locale negotiation preserves `next` and unauthenticated success rejects an external destination.
- Real SMS verification, real account creation/sign-in, real session persistence after reload, and real logout against the supplied project: **not tested**. No test phone was authorized and no SMS was sent. Mocked checks do not establish live provider readiness.

## Design reference lock

Primary reference: existing Naqah `AGENT.md`, UI primitives, brand logo, and `globals.css`. Preserve Alexandria/Montserrat, ivory canvas, cream form surface, brown primary action, hairline border, and 44px+ controls. One field per step, clear change-number action, LTR phone/code inside RTL Arabic. Secondary reference: Refero bundled craft-details form/focus guidance. Live Refero research returned inactive subscription; no external style was invented or substituted. Existing fonts/colors/components serve as the direct-build target. Production screenshots inspected in Arabic mobile and English desktop and checked across both breakpoints/locales.

## Remaining owner steps

Review the feature branch, configure Auth/SMS, coordinate an explicit test phone, and run live sign-in/sign-up → reload → logout. Integrate product entry links and account controls separately when farm persistence and RLS are ready. No merge or deployment is part of this change.
