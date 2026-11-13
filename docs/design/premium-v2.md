# NAQAH Premium v2 — design brief

One direction for every page. Agents implement it; the lead keeps pages consistent. AGENT.md §4 and its
"Design rules" still apply; this brief sharpens them.

## Direction

**Modern Saudi technology × premium minimalism × authentic desert identity.** Calm, quiet confidence: the
product reassures an owner that the ranch is looked after («اطمئنان، دون انشغال»). It is a tool used daily by
livestock owners, not a marketing toy: answers first, generous whitespace, one focal point per screen.

## System (use tokens in `src/app/globals.css`; extend, don't fork)

- **Palette.** Milk-white ground (`ivory`/`cream`), ink `espresso`, warm `brown` for primary actions, `sand` and
  `gold` as desert accents (gold: decorative or large text only). Status colours stay muted (`ok/warn/danger/info`)
  and never carry meaning alone. No new gradients except dark scrims under text on photos.
- **Type.** Alexandria leads Arabic, Montserrat leads Latin; numbers in Latin digits. One scale for the app:
  page title (2xl/3xl, semibold, tight leading), section heading (lg, semibold), body (base, relaxed leading,
  Arabic +0.1 line height), meta (sm, `muted`). Avoid lone last words: `text-pretty` on paragraphs and headings.
- **Space and rhythm.** 4px grid. Page gutters 20px mobile / 40px desktop; sections 32px mobile / 48px desktop;
  inside cards 20/24px. Content max width ~72rem; reading width ~40rem.
- **Surfaces.** Cards: `radius-card`, hairline `stone` border, no shadow, never nested. Overlays (sheet, dialog,
  menus) may use `shadow-lift`. The espresso fill is reserved for the estate header and "your ranch's week".
- **Controls.** Primary = brown filled; secondary = hairline outline; tertiary = text link with underline offset.
  At most one primary per view region. 44px minimum targets. Visible focus ring (brown, 2px, offset 2px).
  Forms: label above, help below in `muted`, error in `danger` with an icon and text.
- **Icons.** Phosphor, regular weight in UI, fill only for state. Never in tinted tiles. The camel is
  `<CamelMark/>`, never an icon.
- **Imagery.** Real desert/camel photography from `public/images/landing` (credits in `asset-ledger.md`) on the
  landing and onboarding only; the app uses data visuals, not decoration. No stock illustrations, no AI art.
- **Motion.** Purposeful only: entrance fade/rise 180–260ms with `--ease-standard`, list stagger ≤ 40ms per item,
  sheet/dialog slide, state changes (saved, checked) with a short confirmation. Everything stops under
  `prefers-reduced-motion`. No perpetual loops.
- **States.** Every page has a designed empty state (one sentence + one action), a loading state
  (`role=status`, quiet skeleton or the camel), an error state (plain cause + retry), and a success confirmation
  that never claims more than the system confirmed.

## Page intents

- **Landing:** one photographic story; the first screen answers "what is this and why trust it".
- **Onboarding/auth:** few steps, one question per screen on mobile, progress always visible.
- **Overview:** keep the owner-requested call row (AGENT.md exception). Mobile order: ranch + one-sentence answer,
  call row, then *Needs your attention* before the full week strip and next-call details where possible.
- **Herd, Tasks, Calls:** same page header (title + one-sentence answer), scannable rows, filters as quiet
  segmented controls, details in sheets.
- **Call Lab:** primary call action above the fold on mobile; simulations clearly labelled.
- **Settings:** grouped, folded on mobile, every section one tap away, save state always visible.
- **Navigation:** desktop side rail, mobile bottom bar with clear active state; both identical in information.

## Quality bar

Verify on a production build (`npm run build && npx next start`) at 375×812 and 1440×900 in `/ar` and `/en`:
no horizontal scroll, no console errors, RTL mirroring correct, 44px targets, AA contrast, keyboard focus.
