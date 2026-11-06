# Owner authentication

Branch: `feature/owner-auth`. Integrated `origin/main` at `a3a1a66b8ef4c1d9f326559bf60c7456596a9f53` into feature tip `4e9709630637df431abc3a09239492b91264a484`. No teammate product changes were rewritten.

## Sign-in methods

| Method | Behavior |
| --- | --- |
| Phone + SMS | Default on `/{locale}/login` and `/{locale}/signup`. Existing Saudi mobile normalization, Arabic/Persian digits, plain `966` and pasted bidi-mark handling, LTR numbers, six-digit OTP, 60-second resend cooldown, rate-limit/network messages, change-number action, and duplicate-submit prevention are preserved. `sendOwnerOtp` applies main’s server-side CAPTCHA/limits before `signInWithOtp` with `shouldCreateUser: true`; new and existing phone accounts use the same flow. |
| Email + password | Choose Email, or open `/{locale}/login?method=email` / `/{locale}/signup?method=email`. Uses `signInWithPassword` / `signUp`. Email is trimmed; password is passed unchanged. Labels, email/password autocomplete, LTR inputs, password visibility, pending states, and duplicate-submit prevention are included. |
| Google | Continue with Google is available on both login and sign-up, from the phone or email choice. `signInWithOAuth({ provider: 'google' })` uses the existing SSR browser client's PKCE flow and redirects back to the localized callback route. |

Email sign-up does not assume confirmation is disabled. A returned session goes to success. No session shows a neutral confirmation message asking the owner to check inbox/spam and open the link in the same browser. Explicit duplicate errors and Supabase's obfuscated duplicate responses produce that same message. The UI does not inspect `identities` to disclose account existence. Invalid credentials, unconfirmed email, weak password, rate limits, provider unavailability, and network errors use fixed Arabic/English messages; raw backend messages are never displayed. The project's password policy remains authoritative. Password reset is not implemented in this extension.

Main's pending phone/code-step recovery is preserved for 10 minutes using `sessionStorage`, including the 60-second resend timer across reload and language changes. It stores no OTP or authenticated-session proof. Changing the phone clears that pending state; successful verification also clears it. Main's encoding-preserving return-path validator, localized metadata, auth-excluded service-worker caching, and timed session/logout helpers are retained.

## Callback, sessions, and redirects

- New GET route: `/ar/login/callback` and `/en/login/callback`. It calls `exchangeCodeForSession(code)` using the request's verifier cookies, also forwarding an optional `sb_flow_id` to support the installed auth-js version's per-flow verifier behavior.
- The callback writes session/deletion cookies and Supabase's cache headers onto the same redirect response. It sets `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. Missing/ambiguous codes, denied providers, invalid/expired codes, missing verifiers, configuration outages, and fetch failures return to localized login with a fixed translated error. Codes, provider errors, passwords, and tokens are not logged or forwarded to the success URL.
- Callback response `Location` headers are relative. This retains the browser's actual origin behind proxies or when Next uses an internal hostname. No `x-forwarded-host` value is trusted.
- Every successful method goes through the existing `/{locale}/login/success` route, which freshly validates with `getOwner()` -> `auth.getUser()` on the server. It shows a generic signed-in confirmation and logout by default; it redirects to a validated `next` only after validation. The confirmation explains that the platform still uses the browser workspace and account farm persistence is not connected. Main’s explicit Continue button remains, pointing to `/{locale}/app`; it is labelled Open platform rather than implying a real account farm.
- Main’s `getOwner()` waits for a request with `connection()` before starting session SDK work. This keeps the SDK's time-dependent background work outside prerendering with Next Cache Components.
- `safeReturnPath` remains the shared validator: only `/ar` or `/en` paths, no external/protocol-relative URLs, backslashes, controls/whitespace, malformed encoding, traversal outside locale paths, API paths, or login/signup/callback loops. The code exchange uses main’s secure cookie options and a 10-second server timeout. `next` is revalidated when building outgoing provider URLs, inside the callback, and on the success route.
- Auth language switches retain the selected email method and use main’s `searchForLocale` to move a validated `next` to the selected language; only known UI/error parameters are copied. Callback codes/tokens are not carried into language links.
- Existing proxy refresh and logout are unchanged. The proxy calls `getClaims()` without gating demo routes; protected data must independently validate identity. Logout calls `signOut({ scope: 'local' })`, clears cookies, and returns to localized login. JWT lifetime/revocation limitations remain as documented by Supabase; never authorize from localStorage, `setupComplete`, or a client flag.
- No farm, profile, workspace, or identity-linking mutation was added.

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


## Environment contract

The existing public auth variables are required:

```text
NEXT_PUBLIC_SUPABASE_URL=<Supabase project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Set these using ignored `.env.local` or deployment configuration; rebuild after changes because browser variables are inlined. Main’s optional `NEXT_PUBLIC_TURNSTILE_SITE_KEY` enables the security widget for phone and email forms. No new production variable, dependency, Google client secret, SMTP credential, service-role key, or SMS credential is required in this repository. Google/provider secrets stay in the provider/Supabase configuration. `.env.local` remains ignored. No package manifest, lockfile, translation registry, or proxy change was needed for this extension.

## Dashboard configuration for Mohammed

Use the actual deployment origin in place of `https://<APP_HOST>`. No dashboard settings were changed by this work.

1. **General / URL Configuration:** set the production Site URL. Add the localized application callback URLs to Supabase Auth's redirect allow list. Every generated callback URL has `method=email` or `method=google`, and can include a URL-encoded validated `next`. Query strings participate in Supabase's matching, so exact entries must include their queries. For variable return paths, narrow patterns such as these cover only the callback prefix:

   ```text
   https://<APP_HOST>/ar/login/callback?**
   https://<APP_HOST>/en/login/callback?**
   http://localhost:3000/ar/login/callback?**
   http://localhost:3000/en/login/callback?**
   ```

   Local entries are for development only; use the actual dev host/port if different (e.g. `127.0.0.1`). Exact examples without `next` are `https://<APP_HOST>/ar/login/callback?method=email` and `https://<APP_HOST>/en/login/callback?method=google`. Avoid a broad production `/**` allow-list entry. Application `next` validation still runs independently.

2. **Phone/SMS:** keep Phone Auth and phone sign-ups enabled for the combined OTP flow; configure a provider that can deliver to Saudi mobiles, six-digit codes, appropriate expiry, rate limits, and SMS restrictions/spend limits. No provider or telephony changes were made.

3. **Email:** enable Email/password and new-user sign-ups as desired. Decide whether Confirm email is enabled; both returned-session and confirmation-required responses are handled. Configure production email delivery/SMTP and sender settings in Supabase. Keep the Confirm sign-up template's link using `{{ .ConfirmationURL }}` so Supabase verifies the email and redirects to the `emailRedirectTo` callback with a PKCE code. The app supplies the localized callback with `method=email` and any safe `next`. A template hardcoded to the Site URL or one that sends only `token_hash` directly to the app must be adjusted by Mohammed; this extension provides the code-exchange callback, not a token-hash confirmation endpoint. PKCE confirmation must finish in the initiating browser with its verifier cookie. If a link is opened elsewhere, the owner may need to return to login with email/password after confirming. Test actual delivery/redirect behavior before release.

4. **Google:** enable Google in Supabase Auth Providers. Configure a Google OAuth Web application, consent screen/audience/test users, and the required Google client ID/secret in Supabase only. In Google Cloud, use the **Supabase provider callback URL shown in the dashboard**, typically `https://<PROJECT_REF>.supabase.co/auth/v1/callback`, as the authorized redirect URI. This is different from the app's `/ar/login/callback` and `/en/login/callback` routes, which belong in Supabase's redirect allow list. Configure authorized application origins as required by the Google OAuth client. This app uses redirect OAuth, not One Tap, so no Google JavaScript SDK/client-ID environment variable is added. Production consent/publishing requirements remain with Mohammed.

The existing Turnstile integration is preserved and is also passed through email sign-in/sign-up. Google uses the existing redirect OAuth flow. Dashboard configuration remains owner-managed.

## Account identities: unresolved product policy

No `linkIdentity`, `unlinkIdentity`, `updateUser`, account merging, phone matching, or custom email matching was added. Supabase's existing automatic identity-linking behavior is preserved: eligible identities with the same verified email may resolve to one Supabase user. A phone-only user and an email/Google user may instead have different user IDs; do not assume they represent the same owner or share a farm. Mohammed must decide future cross-method account/farm association before integration. This implementation does not decide or require a new linking policy.

## Confirmation returned to Login

- Auth-owned Login/Sign Up entry pages recognize an incoming PKCE `code` and forward it to the existing server callback. They do not leave a confirmation code sitting on the login form. Provider error descriptions are not displayed, logged, or forwarded.
- Before email or Google starts, `naqah-auth-return` remembers only a validated internal destination for one hour. If a provider Site URL fallback drops the callback query, the server revalidates this hint, exchanges the PKCE code using the verifier cookie, clears the hint, and follows the intended setup/platform path. The hint is never identity or farm-existence proof. Missing/invalid verifier codes still fail closed.
- Correct Supabase Site URL/redirect allow-list configuration is still required. For the development origin shown by the owner, add the applicable `http://localhost:3002/ar/login/callback?**` and `/en/login/callback?**` patterns; the app builds callback URLs from the initiating browser origin. Keep the same browser for PKCE confirmation. No dashboard settings were changed by this fix.

## Navigation and real farm persistence

- Authorized minimal edits: `src/components/landing/LandingPage.tsx` and `src/components/welcome/WelcomePage.tsx`. Existing Login links remain; Sign Up links were added using existing styles, including the landing mobile menu. Login passes `next=/{locale}/app`; Sign Up passes `next=/{locale}/start`. Welcome/onboarding primary actions, sample confirmation and Dashboard behavior are unchanged.
- Exact behavior: Sign Up -> chosen auth method -> server-validated session -> same-locale `/start` (existing setup wizard). Login -> chosen auth method -> server-validated session -> same-locale `/app` (platform). Email confirmation, if required, completes first. No farm data is created, loaded, imported, or attached by these redirects.
- Direct signup with no safe `next` defaults to `/start`; direct login defaults to `/app`. Explicit validated internal return paths remain supported. Generic New account / Already have an account links select the appropriate setup/platform destination instead of carrying the opposite intent. Language switches retain and localize the validated destination. The success route still verifies the session before any redirect.
- `/app` currently displays browser workspace/demo state. This is **not real account/farm integration**. No farm existence is inferred from browser storage, and no authenticated-route gate is added.
- Exact unfinished dependency: `docs/integrations/supabase-backend.md`, the account-mode migration plan steps 2–6. The teammate must wire account-mode loading through `src/server/farm/actions.ts::loadWorkspace` into `src/store/workspace.ts`, move Setup/Settings/Herd writes to owner actions, and isolate simulation. Any future import requires a separate explicit owner choice. Auth does not call `ensureFarm`, `loadWorkspace`, or change `AppShell`/the store.
- Backend migrations, RLS, real-project readiness, account identity/farm association, and live calls remain owner/teammate work. No additional teammate-file edits are awaiting approval.

## Verification and test-only fixtures

- `npm test`: 468 tests passed; 7 database integration tests skipped by the repository, including existing phone/session/logout tests plus email states, duplicate handling, callback cookie/cache-header forwarding, PKCE flow IDs, unsafe destinations, provider denial, missing configuration/verifiers, and callback failures.
- `npx next typegen`, `npm run typecheck`, `npm run lint`, `npm run build`: passed. No dependency or shared routing configuration edits beyond main’s imported changes were needed.
- Existing `scripts/qa-owner-auth.mjs`: ar/en x 375/1440 phone validation, E.164 payload, wrong/expired codes, duplicate send/verify, resend/cooldown, change phone, rate limit/network states, direction and overflow passed against the production build.
- New mock-provider browser suite: ar/en x 375/1440 email invalid/unconfirmed/rate/network/weak/duplicate states, confirmation enabled/disabled behavior, successful email/password, email/Google PKCE callback session cookies, phone success, page reload, pending phone OTP recovery across reload/language changes, forced session expiry/refresh, logout cookie deletion and server rejection afterward, safe `next`, provider denial, and auth language-switch state passed. This exercises the actual SDK/Next SSR adapters against fixtures, not real providers.
- Navigation QA: ar/en x 375/1024/1440 checks visible Login/Sign Up links, safe return paths, no overflow, unchanged Welcome -> setup action, and locale negotiation.
- Visual screenshots inspected against the existing Naqah design system: Alexandria/Montserrat, ivory/cream canvas, brown actions, hairline form border, existing controls, RTL Arabic, LTR inputs, and 44px+ controls. Existing design reference lock retained; no new design system or imagery was introduced.
- Existing `scripts/qa-screens.mjs`: full demo/locale production regression (ar/en x 375/1440) passed with `NO PROBLEMS`.
- **Not run:** real email delivery/confirmation/sign-in, real Google authorization/consent, or real SMS verification against the supplied project. No email/SMS was sent, no real OAuth login was performed, no existing user was changed, and no provider settings were edited. Mohammed must complete configuration and coordinate explicit test accounts/numbers.

To reproduce mock-only session QA against a production build made with the same local stub variables as main’s OTP QA, explicitly start a local test server with:

```text
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder-not-a-key npm run build
NAQAH_AUTH_QA=mock-only NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder-not-a-key node --import ./scripts/auth-qa-fixture.mjs node_modules/next/dist/bin/next start -p 3108
BASE=http://localhost:3108 node scripts/qa-auth-methods.mjs
```

Use shell-appropriate environment assignment (PowerShell: `$env:NAQAH_AUTH_QA='mock-only'`). `CHROMIUM_PATH` and `OUT` optionally select a local browser and screenshots directory. The fixture intercepts only the configured Auth server in the explicitly preloaded test process; the browser suite intercepts browser Auth calls. **Never preload this fixture into a deployment or ordinary app server.** It fabricates identity validation solely for tests and is never imported by application code. Normal `npm run start`, builds, and deployment paths do not load it.

For stub-only builds, explicitly leave `NEXT_PUBLIC_TURNSTILE_SITE_KEY` blank. Unit tests cover configured CAPTCHA requirements and email token forwarding; live Turnstile acceptance is a separate owner-coordinated provider check and was not performed.

Remaining steps: review the merge and auth-only diff; configure the providers/redirects/templates; run coordinated real provider tests; decide identity/farm association; integrate product links and persistence separately. No merge or deployment is authorized by this change.

References: [Supabase Google PKCE](https://supabase.com/docs/guides/auth/social-login/auth-google), [email/password](https://supabase.com/docs/guides/auth/passwords), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs). Installed Next.js 16.4.5 docs reviewed: route handlers, cookies, authentication with Cache Components, and connection. Installed Supabase source/JSDoc reviewed: signUp, signInWithPassword, signInWithOAuth, exchangeCodeForSession, SSR clients/cookies, and PKCE redirect allow-list/flow-ID behavior.
