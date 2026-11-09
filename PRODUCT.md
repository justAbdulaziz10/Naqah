# Product

<!-- impeccable:product-schema 1 -->

Drafted from `AGENT.md` and `docs/NAQAH_FRONTEND_DESIGN.md`. It records approved facts only. Open
decisions stay open in `AGENT.md` §7 and handoff §13.

## Platform

web

## Users

- **Owner:** a Saudi camel owner with one private estate. Uses the website on desktop and mobile
  browsers to set up the estate, see the latest state and follow tasks. The default audience
  reads Arabic, right to left.
- **Worker:** uses an ordinary phone and never the website. There is no worker app or login.
- **Investor audience:** the current build is an investor MVP, shown with simulated data that is
  always labelled as demo or sample.

## Product Purpose

NAQAH is private camel-ranch operations management for one owner, one farm and one worker. The
worker calls the NAQAH AI voice agent, which asks the owner's configured questions and records
structured facts. After a successful update the AI calls the owner with only what matters. The
website is where the owner sets up the estate and checks its latest state.

Success is peace of mind: the owner knows the state of the estate without being busy with it.

## Positioning

The worker's ordinary phone call is the input. No app for the worker, no recordings, and the owner
receives facts labelled with where they came from and how certain they are.

## Operating Context

- Worker reporting: Basic, one report a week at the owner's chosen day and time. Ultimate, one report
  a day at the owner's chosen time.
- The AI calls the owner at the owner's chosen summary time after a saved report. Basic ends after
  the summary. Ultimate then asks for instructions on the phone.
- Emergencies: the worker calls the owner directly, never through the AI.
- The owner may read the dashboard outdoors on a phone.

## Capabilities and Constraints

- **Plans:** Basic has up to 5 custom questions, one owner call a week and no task tickets. Ultimate
  has unlimited questions and owner calls, and task tickets for actionable instructions.
- **Task tickets:** close only when the worker explicitly confirms. Deadlines never close them.
  Closed tickets move to History.
- **Missed worker calls:** three attempts total, 20 minutes apart. After the third, automatic calls
  stop. No new No Answer Ticket is created. Older tickets stay in history and still close if the
  worker calls back. Owner calls are not redialed.
- **Not approved, do not add:** native apps, a website chatbot, multiple farms or workers, diagnosis,
  purchasing, extra reporting updates, new channels, automated emergency dispatch.
- **Current state:** the demo runs in the browser. No real calls reach the dashboard, and nothing is
  charged. **Calling the worker from NAQAH is not connected**, so it must never look like it works.
  Simulation stays clearly labelled.
- **Terminology:** حلال for the herd, عزبة for the estate in Arabic; "task ticket" and "No Answer
  Ticket" are the product's terms for those records.

## Brand Commitments

- Name: NAQAH | ناقة. Promise: Peace of Mind, «اطمئنان، دون انشغال». Personality: The Quiet Steward.
- Premium but discreet, never theatrical or flashy. Warm, direct copy in contemporary Saudi Arabic;
  no hype, exclamation marks or emoji.
- The approved camel logo is never redrawn, outlined, distorted or animated.
- Palette and fonts are fixed by the handoff (§07): Alexandria for Arabic, Montserrat for English.
- The owner dashboard is calm, functional, Arabic RTL, readable outdoors and not cinematic.

## Evidence on Hand

- The sample estate in `src/domain/seed.ts` is illustrative, not a real farm or real results.
- No customers, testimonials, press or performance figures exist. Do not invent any.
- Predefined question wording is a draft.

## Product Principles

1. **Answer first.** The owner sees whether the estate needs them before anything else.
2. **Never claim more than the system knows.** Every fact shows its time and source. Old data is
   never presented as new, and nothing says saved, notified or done until it is.
3. **Facts, not diagnosis.** NAQAH reports what the worker said; it does not interpret it.
4. **Quiet by default.** Show what helps the current decision and keep the rest one step away.
5. **People and camels by name.** The estate is known by its names, not by counts.

## Accessibility & Inclusion

- Arabic and RTL are first-class. Latin digits in both languages; phone numbers and times stay
  left to right.
- Outdoor-readable contrast, about 44px touch targets, visible keyboard focus, scalable text, and
  respect for reduced motion. Status never relies on colour alone.
