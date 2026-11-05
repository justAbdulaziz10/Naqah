# Owner authentication

Branch: `feature/owner-auth`. This extension starts at `4fe438e7dce587decaf16b34f7cc6408578060e0`, fetched from `origin/feature/owner-auth` before editing. The previous phone implementation began at approved base `c2db6d536ab97ae257d733f1ff3bf1e880933869`.

## Sign-in methods

| Method | Behavior |
| --- | --- |
| Phone + SMS | Default on `/{locale}/login` and `/{locale}/signup`. Existing Saudi mobile normalization, Arabic/Persian digits, LTR numbers, six-digit OTP, 60-second resend cooldown, rate-limit/network messages, change-number action, and duplicate-submit prevention are preserved. `signInWithOtp` has `shouldCreateUser: true`; new and existing phone accounts use the same flow. |
| Email + password | Choose Email, or open `/{locale}/login?method=email` / `/{locale}/signup?method=email`. Uses `signInWithPassword` / `signUp`. Email is trimmed; password is passed unchanged. Labels, email/password autocomplete, LTR inputs, password visibility, pending states, and duplicate-submit prevention are included. |
| Google | Continue with Google is available on both login and sign-up, from the phone or email choice. `signInWithOAuth({ provider: 'google' })` uses the existing SSR browser client's PKCE flow and redirects back to the localized callback route. |

Email sign-up does not assume confirmation is disabled. A returned session goes to success. No session shows a neutral confirmation message asking the owner to check inbox/spam and open the link in the same browser. Explicit duplicate errors and Supabase's obfuscated duplicate responses produce that same message. The UI does not inspect `identities` to disclose account existence. Invalid credentials, unconfirmed email, weak password, rate limits, provider unavailability, and network errors use fixed Arabic/English messages; raw backend messages are never displayed. The project's password policy remains authoritative. Password reset is not implemented in this extension.

## Callback, sessions, and redirects

- New GET route: `/ar/login/callback` and `/en/login/callback`. It calls `exchangeCodeForSession(code)` using the request's verifier cookies, also forwarding an optional `sb_flow_id` to support the installed auth-js version's per-flow verifier behavior.
- The callback writes session/deletion cookies and Supabase's cache headers onto the same redirect response. It sets `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`. Missing/ambiguous codes, denied providers, invalid/expired codes, missing verifiers, configuration outages, and fetch failures return to localized login with a fixed translated error. Codes, provider errors, passwords, and tokens are not logged or forwarded to the success URL.
- Callback response `Location` headers are relative. This retains the browser's actual origin behind proxies or when Next uses an internal hostname. No `x-forwarded-host` value is trusted.
- Every successful method goes through the existing `/{locale}/login/success` route, which freshly validates with `getOwner()` -> `auth.getUser()` on the server. It shows a generic signed-in confirmation and logout by default; it redirects to a validated `next` only after validation. The confirmation no longer claims that a phone number was verified when another method was used.
- The success page explicitly waits for a request with `connection()` inside its existing Suspense boundary before starting session SDK work. This keeps the SDK's time-dependent background work outside prerendering with Next Cache Components.
- `safeReturnPath` remains the shared validator: only `/ar` or `/en` paths, no external/protocol-relative URLs, backslashes, controls/whitespace, malformed encoding, traversal outside locale paths, API paths, or login/signup/callback loops. `next` is revalidated when building outgoing provider URLs, inside the callback, and on the success route.
- Auth language switches retain the selected email method and validated `next`; only known UI/error parameters are copied. Callback codes/tokens are not carried into language links.
- Existing proxy refresh and logout are unchanged. The proxy calls `getClaims()` without gating demo routes; protected data must independently validate identity. Logout calls `signOut({ scope: 'local' })`, clears cookies, and returns to localized login. JWT lifetime/revocation limitations remain as documented by Supabase; never authorize from localStorage, `setupComplete`, or a client flag.
- No farm, profile, workspace, or identity-linking mutation was added.

## Environment contract

Only the existing public auth variables are required:

```text
NEXT_PUBLIC_SUPABASE_URL=<Supabase project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Set these using ignored `.env.local` or deployment configuration; rebuild after changes because browser variables are inlined. No new application variable, dependency, Google client secret, SMTP credential, service-role key, or SMS credential is required in this repository. Google/provider secrets stay in the provider/Supabase configuration. `.env.local` remains ignored. No package manifest, lockfile, translation registry, or proxy change was needed for this extension.

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

If CAPTCHA is required by project policy, the existing separate CAPTCHA token/UI integration remains a follow-up. This feature does not change that policy.

## Account identities: unresolved product policy

No `linkIdentity`, `unlinkIdentity`, `updateUser`, account merging, phone matching, or custom email matching was added. Supabase's existing automatic identity-linking behavior is preserved: eligible identities with the same verified email may resolve to one Supabase user. A phone-only user and an email/Google user may instead have different user IDs; do not assume they represent the same owner or share a farm. Mohammed must decide future cross-method account/farm association before integration. This implementation does not decide or require a new linking policy.

## Product integration points (unchanged)

- Welcome/landing: `src/components/landing/LandingPage.tsx` header beside `LocaleSwitcher`/`DemoAction`, and `LandingActions.tsx::MobileNavigation`. Add separate links to localized login/signup when ready; keep `DemoAction` intact.
- Setup entry: link to localized signup with a validated encoded `next=/{locale}/start`. `src/app/[locale]/start/page.tsx::StartPage` and `confirmSetup()` still own demo setup and the final `/app` navigation; this authentication does not persist their workspace.
- Dashboard: `src/components/shell/AppShell.tsx` desktop sidebar footer and mobile locale/settings header. Integrate a login link and `LogoutButton` using server-validated identity when farm persistence/RLS are ready. Existing demo gates are unchanged.
- Future protected data operations must call server identity validation and enforce ownership/RLS. Preserve the distinction between generic cached demo/offline UI and authenticated server data when the product owner integrates persistence/PWA behavior.

## Verification and test-only fixtures

- `npm test`: 278 tests in 29 files passed, including existing phone/session/logout tests plus email states, duplicate handling, callback cookie/cache-header forwarding, PKCE flow IDs, unsafe destinations, provider denial, missing configuration/verifiers, and callback failures.
- `npx next typegen`, `npm run typecheck`, `npm run lint`, `npm run build`: passed. No dependency or shared routing configuration changes were needed.
- Existing `scripts/qa-owner-auth.mjs`: ar/en x 375/1440 phone validation, E.164 payload, wrong/expired codes, duplicate send/verify, resend/cooldown, change phone, rate limit/network states, direction and overflow passed against the production build.
- New mock-provider browser suite: ar/en x 375/1440 email invalid/unconfirmed/rate/network/weak/duplicate states, confirmation enabled/disabled behavior, successful email/password, email/Google PKCE callback session cookies, phone success, page reload, forced session expiry/refresh, logout cookie deletion and server rejection afterward, safe `next`, provider denial, and auth language-switch state passed. This exercises the actual SDK/Next SSR adapters against fixtures, not real providers.
- Visual screenshots inspected against the existing Naqah design system: Alexandria/Montserrat, ivory/cream canvas, brown actions, hairline form border, existing controls, RTL Arabic, LTR inputs, and 44px+ controls. Existing design reference lock retained; no new design system or imagery was introduced.
- Existing `scripts/qa-screens.mjs`: full demo/locale production regression (ar/en x 375/1440) passed with `NO PROBLEMS`.
- **Not run:** real email delivery/confirmation/sign-in, real Google authorization/consent, or real SMS verification against the supplied project. No email/SMS was sent, no real OAuth login was performed, no existing user was changed, and no provider settings were edited. Mohammed must complete configuration and coordinate explicit test accounts/numbers.

To reproduce mock-only session QA against a normal production build, explicitly start a local test server with:

```text
NAQAH_AUTH_QA=mock-only node --import ./scripts/auth-qa-fixture.mjs node_modules/next/dist/bin/next start -p 3108
BASE=http://localhost:3108 node scripts/qa-auth-methods.mjs
```

Use shell-appropriate environment assignment (PowerShell: `$env:NAQAH_AUTH_QA='mock-only'`). `CHROMIUM_PATH` and `OUT` optionally select a local browser and screenshots directory. The fixture intercepts only the configured Auth server in the explicitly preloaded test process; the browser suite intercepts browser Auth calls. **Never preload this fixture into a deployment or ordinary app server.** It fabricates identity validation solely for tests and is never imported by application code. Normal `npm run start`, builds, and deployment paths do not load it.

Remaining steps: review this branch; configure the providers/redirects/templates; run coordinated real provider tests; decide identity/farm association; integrate product links and persistence separately. No merge or deployment is authorized by this change.

References: [Supabase Google PKCE](https://supabase.com/docs/guides/auth/social-login/auth-google), [email/password](https://supabase.com/docs/guides/auth/passwords), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs). Installed Next.js 16.4.5 docs reviewed: route handlers, cookies, authentication with Cache Components, and connection. Installed Supabase source/JSDoc reviewed: signUp, signInWithPassword, signInWithOAuth, exchangeCodeForSession, SSR clients/cookies, and PKCE redirect allow-list/flow-ID behavior.
