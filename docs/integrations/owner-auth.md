# Owner phone authentication

Branch: `feature/owner-auth`. Approved base: `c2db6d536ab97ae257d733f1ff3bf1e880933869`.

## Routes and behavior

- `/ar/login`, `/en/login`: owner phone → SMS code.
- `/ar/signup`, `/en/signup`: the same supported Supabase phone OTP flow, with sign-up wording.
- Both call `signInWithOtp({ phone, options: { shouldCreateUser: true, channel: 'sms' } })`. New owners can be created by Supabase; existing owners sign in. Neither flow reports whether an account exists. No profile or farm data is collected or written.
- `verifyOtp({ phone, token, type: 'sms' })` writes the session through the SSR browser cookie adapter. The browser then fully navigates to `/{locale}/login/success`.
- The success route calls `getOwner()` → `auth.getUser()` on the server. It shows a signed-in confirmation and logout by default. With a validated `next`, it redirects there only after server validation. Unauthenticated requests return to localized login. Configuration/network outages show an unavailable message.
- `safeReturnPath` only accepts `/ar` or `/en` paths. It rejects external/protocol-relative URLs, backslashes, whitespace/control characters, malformed encoding, traversal outside locale paths, and login/signup loops. Validation runs both before forwarding `next` and on the success route. API endpoints are not accepted as return destinations.
- Phone input accepts Saudi mobile local format, nine-digit national format, `+966` and `00966` international formats, spaces/dashes/parentheses, and Arabic/Persian digits; sends E.164. Landlines and foreign numbers are rejected because this is Saudi SMS authentication.
- SMS codes use six digits. Wrong and expired codes share one message. Resend waits 60 seconds after successful sends and rate limits; changing phone preserves the current page's cooldown. A page reload resets the UI timer; Supabase rate limits remain authoritative.
- `LogoutButton` calls the logout Server Action: `signOut({ scope: 'local' })`, writes deletion cookies, and redirects to localized login only on success. This signs out the current session, not every device. Supabase access JWTs can remain valid until expiry; sensitive operations must validate with `getOwner()`/`getUser()` and appropriate RLS.

## Environment and owner configuration

Set only these public variables in ignored `.env.local` or the deployment's environment mechanism:

```text
NEXT_PUBLIC_SUPABASE_URL=<project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

`.env.local` is ignored by the existing `.gitignore`. Public variables are inlined at build time; rebuild after configuring or changing them. Missing/invalid configuration disables the phone form with a translated message. No service-role key is required.

The project owner must enable Supabase Phone Auth, allow new phone sign-ups for this combined flow, configure an SMS provider that can deliver to Saudi mobiles, confirm six-digit OTP settings/expiry and desired rate limits, and set the production Site URL. Configure any SMS restrictions and spend limits in the dashboard. OTP verification here does not require an OAuth/email callback route. If CAPTCHA is required by project policy, a CAPTCHA UI/token integration is a follow-up before release; this feature does not change dashboard policy. No dashboard, provider, account, migration, RLS, telephony, or deployment configuration was changed.

Dependencies are exactly pinned: `@supabase/ssr@0.12.7`, `@supabase/supabase-js@2.119.0`. Existing dependency versions were preserved. The proxy uses `getClaims()` for cookie refresh, retains all original locale logic/exclusions, and adds no route gate. Auth-server outages do not block the demo. Its cookie adapter forwards Supabase's cache-control headers with refreshed cookies. Server Components use the read client; cookie-mutating Server Actions must use `createWritableClient`.

Official references: [phone OTP](https://supabase.com/docs/guides/auth/phone-login), [SSR clients and server validation](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs), [OTP API](https://supabase.com/docs/reference/javascript/auth-signinwithotp), [session limitations](https://supabase.com/docs/guides/auth/server-side/advanced-guide). Installed Next.js 16.4.5 local docs reviewed: Proxy, cookies, and authentication with Cache Components. Session/search-parameter reads sit behind Suspense boundaries.

## Product integration points (owner follow-up; unchanged here)

- Welcome/landing navigation: `src/components/landing/LandingPage.tsx`, header beside `LocaleSwitcher`/`DemoAction`, and mobile menu entries in `LandingActions.tsx::MobileNavigation`. Add separate login/signup links using `href('/login')` and `href('/signup')`; keep `DemoAction` intact.
- Setup entry: link to `/{locale}/signup?next=` plus `encodeURIComponent('/' + locale + '/start')` when the owner chooses to connect setup. `src/app/[locale]/start/page.tsx::StartPage` and `confirmSetup()` currently own demo setup and the final `/app` navigation. Authentication does not replace that handler or persist its workspace.
- Dashboard controls: `src/components/shell/AppShell.tsx`, desktop sidebar footer beside `LocaleSwitcher` and mobile header beside the locale/settings controls. Add a login link using `href('/login')` (optionally `next=/{locale}/app`) and mount `LogoutButton` when server-validated identity is available.
- Any future server data operation must call `getOwner()` and enforce ownership/RLS at the operation. Proxy refresh alone is not authorization. Do not use `setupComplete`, workspace presence, localStorage, or client session presentation as identity proof.
- `auth[locale]` follows `defineMessages` and is imported by auth components directly. No translation registry change was needed.

## Verification

- `npx next typegen` generates the route helpers required by the repository's existing `PageProps`/`LayoutProps` references before standalone typechecking.
- `npm test`: 247 tests passed in 27 files, including auth input, error mapping, SSR refresh/cookie/cache headers, fresh server identity validation, missing configuration, and logout behavior with mocks.
- `npm run typecheck`, `npm run lint`: passed. `npm run build`: passed in the shorter Windows worktree path. Initial attempts encountered restricted font downloads and a Turbopack worker failure in the long workspace path; no application configuration was changed to bypass them.
- `scripts/qa-owner-auth.mjs` against the production server: ar/en × 375/1440 passed invalid phone, normalized send payload, duplicate send/verify prevention, wrong/expired codes, cooldown/resend, change phone, rate limits, network error text, input direction, and no horizontal overflow. All browser Auth requests are intercepted; mocks exist only in this QA script and unit tests.
- Existing `scripts/qa-screens.mjs` against the production server: full demo journey screenshots, ar/en × 375/1440, reported `NO PROBLEMS`.
- Separate dev server with blank public auth variables: configuration-unavailable UI and disabled phone field verified in both locales. Production browser check verified locale negotiation preserves `next` and unauthenticated success rejects an external destination.
- Real SMS verification, real account creation/sign-in, real session persistence after reload, and real logout against the supplied project: **not tested**. No test phone was authorized and no SMS was sent. Mocked checks do not establish live provider readiness.

## Design reference lock

Primary reference: existing Naqah `AGENT.md`, UI primitives, brand logo, and `globals.css`. Preserve Alexandria/Montserrat, ivory canvas, cream form surface, brown primary action, hairline border, and 44px+ controls. One field per step, clear change-number action, LTR phone/code inside RTL Arabic. Secondary reference: Refero bundled craft-details form/focus guidance. Live Refero research returned inactive subscription; no external style was invented or substituted. Existing fonts/colors/components serve as the direct-build target. Production screenshots inspected in Arabic mobile and English desktop and checked across both breakpoints/locales.

## Remaining owner steps

Review the feature branch, configure Auth/SMS, coordinate an explicit test phone, and run live sign-in/sign-up → reload → logout. Integrate product entry links and account controls separately when farm persistence and RLS are ready. No merge or deployment is part of this change.
