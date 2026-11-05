# NAQAH — Frontend Experience & Brand Handoff v1.0

> Complete text transcription of the existing 13-page handoff, not a new design proposal or summary. Approved, selected, provisional, optional and pending statuses are preserved.
>
> Source: `~/Downloads/NAQAH_Frontend_Experience_Build_Handoff_v1.0.pdf`, prepared 5 November 2026. Only this Markdown file has been added to the repository; the source PDF remains outside it.
>
> Conversion notes: PDF table cells are transcribed in row order beneath their column headings; page markers preserve provenance across split rows. Repeated running headers/footers were removed, and Arabic extraction artifacts were normalized. This transcription adds no approvals and does not authorize implementation. Resolve product conflicts using the source-of-truth hierarchy below.

<!-- Source page 1 of 13 -->

NAQAH | ناقة  — Frontend Experience & Brand Art Direction
Version: 1.0 — DESIGN / IMPLEMENTATION HANDOFF (not final product approval)
Prepared: 5 November 2026
Intended readers: NAQAH team, frontend designer, AI coding agent, investor-demo reviewers
Primary use: Apply the agreed experience and art direction to an already working web app after its core 
flows are functional. This is not an instruction to overwrite the existing application or backend.
Source-of-truth hierarchy: (1) Main NAQAH Product Requirements / owner decisions; (2) existing 
working app & confirmed technical behavior; (3) approved brand assets and brand identity; (4) this 
frontend/design handoff for the details it explicitly covers. If the documents conflict, STOP and 
flag the issue; do not silently invent or replace functionality. The designer may make cosmetic 
implementation choices only within the statuses defined below.
No overnight guarantee: this file is ready for a coding agent whenever the project is ready. It 
does not assume that any code, imagery, voice calls, payments, or tests have been completed.
## 00 — Non-negotiable boundaries
- NAQAH is a Saudi private camel estate operations service. Promise: «اطمئنان، دون انشغال» / 
Peace of Mind. Premium but discreet, never theatrical or flashy.
- Web app MVP for the owner, usable through a browser on desktop and mobile. NO native mobile 
app and NO worker web/app interface for the MVP. The worker communicates via regular 
telephone calls.
- One farm/estate and one worker per owner in the MVP. Do not add multi-estate management, 
extra roles or worker app.
- NO website AI chatbot. The actual AI experience is telephone voice.
- Worker initiates the weekly Basic or daily Ultimate farm reporting call to the AI. On a successful 
reporting update, AI calls the owner in both tiers, even when there is no important issue.
- Basic: one weekly farm information update at owner-defined scheduled reporting time, one owner-
initiated inquiry call per week, no Tickets. Ultimate: worker initiates one report per day on finishing 
their workday, unrestricted owner inquiries under current requirements, actionable instructions + task 
Tickets.
- Ultimate Tickets stay OPEN until worker explicitly confirms completion; scheduled tasks follow up at 
assigned times, unscheduled ones are revisited in later worker calls. Display History for closed tickets.
- Emergency pathway: worker contacts owner directly in an emergency. Do not add AI emergency 
dispatch or a new escalation ladder as an already-approved feature.
- Do not store audio call recordings. Show only structured extracted information in the web app 
and make the source/uncertainty clear. Do not describe old worker reports as fresh, independently 
verified information.
- Do not use mock successes in a live investor demo without unmistakable DEMO/sample labeling. All 
saved, notified, resolved, and ticket-completed badges must reflect real system state.
- The team's earlier user-reported Twilio/AI feasibility is not proof of current production reliability. 
Preserve existing provider integrations; do not switch vendors without explicit approval.
## 01 — Decision register: what is approved, selected, or pending
Item Current decision Status
Business positioning Private Estate / understated 
Saudi desert luxury
Approved brand direction
Brand promise «اطمئنان، دون انشغال» Approved
Brand personality The Quiet Steward: Discreet, 
Considered, Attentive, 
Composed, Dependable
Approved
Brand verbal tone Warm Discretion; 
Contemporary Saudi Arabic
Approved
Official logo ONE gold filled camel Approved — preserve

<!-- Source page 2 of 13 -->

Item Current decision Status
silhouette B1 with corrected 
rounded legs, exact user-
selected silhouette, no 
wordmark/circle/outline 
variations
exact source
Core colors Warm Ivory #F5F0E8, Cream 
White #FFFCF8, Espresso 
#29241F, Deep Brown 
#614832, Desert Sand 
#D2B48C, Soft Stone 
#DDD3C5, Desert Gold 
#B68A58
Approved
Typography Alexandria for Arabic, 
Montserrat for English
Previously selected / 
verify actual installed 
licensing and files before 
implementation
Icons Phosphor Icons Approved
Photography Heritage Portrait + Material 
Study; Working Estate for 
product explanation
Selected art direction
Heritage pattern family Woven Signature primary (A); 
Woven Frame secondary (B); 
fragmented motif (C) rarely
Selected art direction; 
final artwork pending
Additional editorial color Deep Crimson #8F3040 for 
cultural/artistic accents; not 
the safety/error color
Selected proposal, NOT 
official core palette 
amendment
Motion Woven Motion with Modern 
Editorial accents; Refined 
Expression with a few 
stronger Creative Editorial 
transitions
Selected direction; actual 
animations pending QA
Desert journey Artistic walking camel 
silhouette + light cinematic 
desert; chaptered journey, 
with a short cinematic 
opening (B + a touch of A)
Provisional landing-page 
concept
Tumbleweed Small sparse dry shrub rolling 
once or twice with the scroll; 
no looping/masking content
Optional concept, not 
approved for permanent 
inclusion
Welcome tone Warm Estate Welcome + 
Modern Guided Setup
Selected UX direction
Welcome layout B + C hybrid: Split Editorial 
text combined with a large 
cinematic image moment
Selected direction; exact 
responsive compositions 
proposed below
Owner dashboard Calm, functional, Arabic RTL, 
readable outdoors, not 
cinematic
Established design 
principle
DO NOT: replace the logo with a generated camel icon, animate/deform the approved logo, replace palette 
or fonts, or present a proposal as finalized without owner review.
## 02 — What the team is designing: four distinct experiences
1. Public marketing site — builds emotional interest, explains the value, visually tells the desert-to-
intelligence story, introduces Basic/Ultimate and a legitimate sign-up/interest action.
2. Authenticated Welcome — first-time owner welcome with brand warmth and a single clear start 
action; NOT a second marketing landing page.
3. Guided Owner Onboarding — subscription choice, initial one-estate setup, questions, worker, 
criteria, emergencies and reporting configuration, using current app capabilities.
4. Owner Dashboard / Web App — operational clarity: latest data, timestamps, important findings, 
and Ultimate tickets. Includes settings/edit controls already supported by product requirements.
Routing note: exact routes, signup/login provider, billing activation, payment, and whether Welcome is 
separate or part of onboarding are not decided by this handoff. Map this structure onto the routes and 
auth system already present; do not invent billing integrations.

<!-- Source page 3 of 13 -->

Recommended IA / page inventory — UI proposal (not mandated route structure)
Area Views / sections Purpose
Public Landing hero, How NAQAH 
Works, Voice-to-Data 
demonstration, 
Basic/Ultimate comparison, 
privacy/trust, CTA
Explain and sell service
Auth Sign-in / sign-up entry Use existing auth flow, no 
new provider decision
First-time Welcome Warm greeting, single 
obvious next step
Setup 7 onboarding groups 
described in Section 05
Capture approved owner 
settings
Owner Overview Latest farm update and 
attention items
Owner Farm/camels/resources Show entered and extracted 
information; avoid inventing 
clinical data models
Owner Questions & worker settings Review/update configured 
reporting questions and 
worker phone/language
Owner Reports / latest update Last source-attributed worker 
report and timestamp
Ultimate only Open Tickets / History Assignments and explicit 
worker-confirmed completion
Owner Preferences / importance 
criteria / emergency 
conditions / plan
Existing confirmed 
configuration only
When the backend doesn't provide a separate page or field, don't fabricate data. Compose simple sections 
from available records instead. The UX proposal is flexible; data behavior isn't.
## 03 — Public landing page: exact storytelling and sequencing proposal
Overall concept: The Desert Journey — heritage becomes clarity. Desktop may use generous whitespace 
and cinematic imagery; mobile should remain fast, readable and navigable. Full scroll control stays with the 
visitor.
Chapter
What visitor 
sees
Copy direction 
(illustrative, not 
legal/marketing 
approved)
Motion / 
transition
User value 
explained
01 Arrival Ivory / pale 
desert wide 
scene; artistic 
camel silhouette 
toward right; 
exact logo 
remains static in 
nav
« اطمئنان،
دون انشغال.»
Gentle text fade-
in; camel starts 
subtle walking 
as user scrolls
Brand promise
02 The Journey Small camel 
travels along 
sand horizon; 
distant dune 
layers, sparse 
breeze
« تبقى قريب
من حلالك، 
دون متابعة 
كل التفاصيل 
بنفسك.»
Scroll-linked 
movement, not 
auto-playing 
forever; light 
parallax
Daily oversight 
challenge
03 Woven 
Heritage
Close-up woven 
adornment and 
desert fabric, 
deep crimson 
accent
« أصالة في
الجذور. 
وضوح في 
التفاصيل.»
Photograph 
reveal → Woven 
Signature line → 
calm section 
break
Saudi cultural 
identity
04 Voice 
Becomes Clarity
Real product 
UI/demo: worker « من مكالمة Four optional step transitions; Actual product workflow, not

<!-- Source page 4 of 13 -->

Chapter
What visitor 
sees
Copy direction 
(illustrative, not 
legal/marketing 
approved)
Motion / 
transition
User value 
explained
calls AI → 
configured 
questions → 
extracted facts 
→ site updated 
→ AI calls owner
 بسيطة،
لصورة 
أوضح.»
user can 
advance without 
animation
generic AI 
claims
05 Arrival / CTA Calm still scene; 
no perpetual 
moving hero; 
meaningful CTA 
and plans
«حلالك، قريب 
منك.» + 
approved 
promise as 
needed
Settle and stop How to 
try/request 
access
Public content recommendation (section titles are proposed): What NAQAH Does → How a 
Daily/Weekly Update Works → Owner Receives a Call → Ultimate Ticket Follow-up → Basic vs 
Ultimate → Trust & Privacy → Get Started.
No misleading claims: if Voice-to-Data presentation is simulated, write illustrative example. If a call demo 
works, only show tested supported behavior. No invented user count, testimonials, or medical diagnosis.
Desert Journey interaction rules (proposed)
- B/A blend means a short cinematic opening plus chaptered storytelling: the walking camel appears 
early, disappears during functional content, may return in the closing brand scene.
- The walking silhouette is a new independent artwork, not the official camel logo with its legs 
transformed.
- Use one dominant hero effect; don't keep a pinned camel overlay above application forms or call-to-
action text.
- Avoid forcing visitors through a fixed-length sequence or scroll hijacking. Scrolling quickly must still 
land at the correct content.
- If scroll animation assets are unavailable, fall back to a strong still desert image and ordinary section 
transitions; the site remains complete.
- Tumbleweed/dry shrub: OPTIONAL one or two low-contrast passes behind content in desert chapters 
only, no distracting roll in forms, and never a brand mascot. Confirm local visual suitability; cliché 
Western tumbleweed isn't a Saudi heritage symbol by itself.
## 04 — Welcome: B + C hybrid direction
Selected experience: Warm Estate Welcome + Modern Guided Setup; Split Editorial composition 
with a Cinematic Image element, without rerunning the marketing-site scroll effects.
Desktop ≥ ~1024px (proposed layout)
- Main viewport uses a generous 2-part composition: ~45% reading area on Warm Ivory; ~55% tall 
cinematic camel portrait or heritage scene.
- Top: actual unmodified official logo in a quiet header; optional subtle small 'PRIVATE ESTATE' label.
- Reading area: small Deep Crimson editorial cue (provided it's approved as optional accent), warm 
Saudi Arabic heading, one concise paragraph, one primary Espresso CTA.
- Image area: one high-quality 4:5 / portrait crop; optionally extend beyond fold with a static image fill 
and a thin Woven Frame edge, NOT a heavy autoplay video.
- A small Woven Signature divider can punctuate the bottom; it should never resemble a second logo.
Mobile < ~768px (proposed layout)
- Stack: simple brand header → 35–42vh cropped hero image (or less on short screens) → Arabic 
heading/body → primary CTA.
- No text placed over noisy textile/photo. Use high contrast solid backgrounds.
- CTA large, easy to tap, visible without complicated horizontal scrolling; don't assume the image 
orientation will show the camel's face at every crop.
- Image loads responsively; on poor connection a warm ivory/soft stone fallback still looks intentional.

<!-- Source page 5 of 13 -->

Welcome copy (proposed, NOT already approved)
- Eyebrow: WELCOME TO NAQAH
- H1: اك الله في ناقةيّح.
- Body: ز مربطك والعامل المسؤول عنه، ونضبط طريقة المتابعة اللي تناسبكهّخلنا نج.
- CTA: ابدأ إعداد مربطك
- Secondary help (only if existing support/help flow exists): كيف تشتغل ناقة؟
Transition into onboarding
- On click: short fade/reveal ~250–400ms, then user lands on the existing first setup stage; do not 
delay form interaction just to play the motion.
- Never restart a giant cinematic animation on Back/refresh.
- Welcome should not falsely say an estate is already configured or ready when setup is incomplete.
## 05 — Owner Onboarding: guided, calm, not theatrical
Known setup requirements, presented here as seven UI groups. Grouping and order follow the current 
product document, but exact routes/fields/validation remain to be reconciled with the working app.
Group Owner does UI direction Data/logic guardrail
1. Subscription Chooses Basic or 
Ultimate
Two clear comparison 
cards; don't bury 
differences in tiny 
text
Prices and payment 
provider not 
decided; don't 
invent checkout
2. Estate / camels / 
resources
Enters one camel 
estate and current 
assets such as feed 
and fences
One focused section 
at a time with 
explanatory labels
Only one estate; 
don't invent 
mandatory farm 
attributes
3. Reporting 
questions
Reviews AI-proposed 
questions; edits/adds 
custom questions
Editable question list 
and plain-language 
helper text
Questions genuinely 
saved; AI can 
propose but owner 
controls final 
questions
4. Worker Registers one worker 
number and selects 
language
Phone number + 
language, with 
concise call 
explanation
Use actual 
implemented 
supported languages; 
number alone not 
secure proof
5. Important criteria Sets what counts as 
important for owner's 
update call
Simple 
toggles/options/input
s as configured by 
actual backend
No invented 
thresholds; don't 
auto-diagnose animal 
health
6. Emergencies Defines emergency 
cases
Clear informational 
note that worker 
calls owner 
directly
Don't add 
unapproved 
emergency dispatch 
flow
7. Reporting schedule Basic: owner selects 
weekly time. 
Ultimate: worker calls 
on finishing day
Contextual 
instructions that 
change by tier
Ultimate has no 
fixed reporting 
clock; don't schedule 
AI daily outbound 
worker call
Reusable setup UX patterns (recommendations)
- One main question/group per screen or concise section; clear step labels in everyday Saudi Arabic, 
RTL.
- Show a progress indicator that truthfully reflects completed fields, not an arbitrary “percent 
complete”.

<!-- Source page 6 of 13 -->

- Navigation: التالي / السابق, حفظ  or إنهاء الإعداد at the actual final stage.
- Required vs optional fields should mirror existing backend validation; do not guess what is required.
- Preserve existing entered values on navigation and validation errors. Persisting progress across 
sessions has NOT been approved or verified. Do not claim auto-save until tested.
- When AI question generation is loading, show specific state: ز أسئلة المتابعةهّنج... with retry on 
failure. Do not create fake questions as if AI returned them.
- Worker language displayed as selected; no made-up voice-language capabilities.
- Completion state tells user what comes next: worker calls the AI and first actual report populates 
dashboard. Never show fabricated live farm data.
Onboarding copy / states (proposed)
Situation Suggested Saudi Arabic UI copy
Blank worker phone  أدخل رقم العامل اللي بيستخدمه في
المكالمات.
Invalid input تأكد من صيغة الرقم وحاول مرة ثانية.
Saving جاري حفظ الإعدادات...
Save confirmed تم حفظ الإعدادات.
Saving failed  ما قدرنا نحفظ التغييرات. حاول مرة
ثانية.
First setup completed  صار مربطك جاهز لاستقبال أول
تحديث من العامل. Only if actual 
configuration is valid
No farm report yet ما وصل أول تقرير للحلال إلى الآن.
Avoid chatty hype, tech jargon (MCP / LLM / Prompt), invented performance promises and excessive emojis.
## 06 — Owner Dashboard and product UI (useful, not decorative)
Core view hierarchy — recommended
1. Top summary: estate name (user-chosen; fallback «الحظيرة»), آخر تحديث actual timestamp, 
reporting source, freshness indication if known.
2. Attention: important worker-reported issues that match current configuration, attributed and not 
treated as verified medical fact.
3. Current estate status: current worker-reported feed, camel observations, fences/resources only 
where such records actually exist.
4. Reporting questions / worker setup: easy access to approved configuration.
5. Ultimate: Open Tickets with clear due/status and closed History; no fake tickets in Basic.
6. Subscription info: clear Basic/Ultimate limitations where relevant; don't imply payments are 
integrated if they aren't.
Critical states to design (mandatory to handle visually, no new business logic)
State What the UI communicates
No first report Friendly zero state: no information yet; last 
update absent, never fake stock figures
Report received Show actual time, source أفاد العامل and 
reported quantities
Stale data آخر تحديث كان ... rather than  كل شيء
تمام on its own
Partial / unknown غير معروف / تقريبًا / بحاجة إلى تأكيد

<!-- Source page 7 of 13 -->

State What the UI communicates
Loading Skeleton/quiet loading indicator in the 
affected area, not an entire bouncing 
interface
Network / tool failure Clear issue + retry, no false success
Owner call missed Show source-of-truth reporting status if 
backend records it; no fictional phone-call 
statuses
Ticket open (Ultimate) Explicit OPEN state, owner instruction and due 
time if provided
Ticket complete (Ultimate) CLOSED only after explicit worker 
confirmation; visible in History
Empty Tickets ما فيه مهام مفتوحة حاليًا. ;not All tasks 
complete unless supported
Basic features Do not render Ultimate tickets as functional; 
any upgrade CTA is purely a design proposal if 
subscription switching is built
Dashboard rule: no walking camel, tumbleweed, persistent scroll narrative, large video or decorative 
crimson “error” styles. Outdoor-readable contrast; touch targets approximately 44px minimum 
recommended, visible keyboard focus, text scalable, large tap spacing.
## 07 — Visual design tokens and composition guidance
Core palette — preserve exactly
Token idea Hex Role
--naqah-ivory #F5F0E8 Main warm background
--naqah-cream #FFFCF8 Soft surfaces
--naqah-espresso #29241F Primary readable text, high-
contrast CTA
--naqah-brown #614832 Secondary text/quiet branded 
elements
--naqah-sand #D2B48C Borders/background warmth, 
only with contrast checks
--naqah-stone #DDD3C5 Low-attention dividers
--naqah-gold #B68A58 Official camel logo and 
restrained prestige touches
--naqah-crimson-editorial #8F3040 PROPOSED accent for 
heritage/editorial graphics 
only
Deep Crimson use: line accents, Woven Signature, small editorial eyebrows, selected storytelling frames, 
some art-directed textile imagery. Do not make every button crimson. Do not use this same token as a critical 
alert/error semantic color; design function-specific status colors separately after accessibility checks.
Suggested color balance (not enforceable): mostly cream/ivory and dark readable text, restrained 
brown/gold, small Deep Crimson accent (roughly 3–5% of authored UI graphics). The percentage does not 
apply to photographs of real woven fabrics.
Typography and layout
- Existing type direction: Alexandria Arabic; Montserrat English. Confirm font licensing and local 
availability for web embedding. Never ship proprietary font files from unrelated sources.
- Arabic content RTL with correct punctuation, mixed English numerals, telephone numbers and time 
handling. English microcopy may use Montserrat sparingly.
- For public site: big editorial headlines + concise copy; alternate asymmetric image/text compositions 
with calm whitespace. For setup: clear step labels, plain sentences, consistent inputs. For dashboard: 
functional hierarchy over oversized text.
- Suggested layout foundations to adapt to existing UI: main content max width around 1200–1360px; 
desktop 12-column conceptual grid; mobile comfortable side padding 16–24px; vertical spacing 24–
56px between major application sections; larger editorial spacing for public.

<!-- Source page 8 of 13 -->

- Do not force decorative all-caps English inside essential Arabic workflows. Preserve readable line 
height and scalable text.
- Phosphor Icons family (previously selected). Prefer consistent weights; no emoji substituting for 
interface icons.
- Respect high contrast in strong sunlight. Gold-on-ivory tiny text is not acceptable.
## 08 — Motion & interaction specification — proposed defaults
Motion personality: Woven Motion base + selective Modern Editorial emphasis; Refined Expression 
intensity with occasional bigger section transitions. No gimmicky overshooting/bounce or endless animation.
Motion token Proposed duration Where Constraint
micro-fast 120–180ms Hover, press, focus 
feedback
Immediately 
responsive
panel-transition 220–350ms Steps, drawers, tabs Never delay usable 
controls
editorial-reveal 450–650ms Large 
heading/paragraph 
reveal
Once on entry; no 
opacity trap
woven-reveal 550–800ms Signature stripe / 
chapter divider
Rare, settle 
permanently
image-reveal 650–900ms Hero or editorial 
imagery
No perpetual zoom
scroll-camel tied to scroll position Marketing desert 
chapters
Respects quick-scroll 
and Reduced Motion
dune-parallax tied to scroll, very 
light
Only marketing 
desert chapters
Avoid jank/viewport 
trap
- Suggested ease for standard entrances: soft ease-out (e.g., cubic-bezier(0.22,1,0.36,1)), not a 
requirement if existing animation system uses equivalent curves.
- Suggested visual displacement: text about 8–18px, restrained photo scale about 1.02–1.04, no 
enormous screen travel.
- Woven Signature: reveal → complete → stop ; don't leave lines looping, pulsing or crawling.
- Keep animations GPU-friendly where possible; optimize media and prefer transforms/opacities, not 
layout-heavy effects.
- prefers-reduced-motion must leave a beautiful static layout with all core content accessible.
- No forced sound, autoplaying narrated voice, scroll hijacking, cursor-following clutter or motion that 
covers reading areas.
Signatures (only one or two per journey)
1. Camel walk as the opening chapter's main signature — use a dedicated silhouette or image 
sequence distinct from logo.
2. Woven photograph-to-pattern transition between cultural imagery and technology explanation.
3. Optional tumbleweed / dry shrub: one sparse background pass only after art-direction review; 
remove if distracting or too Western-coded.
## 09 — Media and image acquisition plan
OWNER-SELECTED OPTIONAL PHOTO LIBRARIES: ArabsStock (https://arabsstock.com/) and Adobe Stock 
(https://stock.adobe.com/) for Saudi heritage, camel portraits and premium materials; Unsplash 
(https://unsplash.com/s/photos/camel-desert) and Pexels (https://www.pexels.com/search/camel%20desert/) 
for free atmospheric desert photography. These are browsing options the owner likes, NOT approved 
individual images or mandatory purchases.
Licensing: obtain the required item-specific licenses for ArabsStock/Adobe Stock and avoid Editorial Use Only 
advertising assets. Unsplash/Pexels permit many commercial web uses under their terms, but third-party 
rights must still be checked. Never reuse watermarked previews or source imagery in the official logo.
Search and selection: try «مربط إبل» ,«سدو» ,«زينة الإبل», “Saudi camel portrait”, “camel adornment 
textile”, “minimal sand dunes”. Shortlist 2–3 options for each hero/welcome placement, record the actual 
source and license, review authentic Saudi details and cropping, select one, then optimize and add to the 
existing project. Use a labeled fallback if no approved asset is ready.

<!-- Source page 9 of 13 -->

Recommended source strategy
1. Best for exclusive brand-defining images: commission a local camel-estate photographer or 
create commissioned/AI-assisted original scenes; review cultural details and obtain written 
commercial usage rights. You must not imply AI-generated images are photographs of actual NAQAH 
clients or real farms.
2. Fast free secondary images: Unsplash, Pexels. Both generally allow commercial website use, 
subject to each image's rights and depicted brands/people/artwork. Keep source and license record.
3. Specific Saudi heritage/commercial stock: ArabsStock, Adobe Stock; license the actual item for 
web/marketing. Avoid Editorial Use Only assets for advertising.
4. Cultural reference, not automatic commercial reuse: UNESCO — Al Sadu, SPA/press photos, 
resort websites and the user-provided screenshot are mood references; get explicit rights before 
using published images in commercial NAQAH branding.
5. Production requirement: obtain optimized original/full-quality files, not search-result 
thumbnails/screenshots or hotlinked third-party URLs.
Exact asset shot list (production backlog)
Asset ID
Intended 
visual Location
Desired 
source 
format/aspec
t Priority
Fallback if 
missing
LOGO-01 Exact 
approved 
gold filled 
camel B1 
silhouette
All nav, 
favicon if 
legible, brand 
assets
Original 
transparent 
PNG 
currently 
available; 
ideally 
vectorized 
without 
altering 
shape after 
approval
P0 Text NAQAH 
while asset 
integration is 
blocked; do 
not fabricate 
another 
camel logo
IMG-01 Wide Saudi 
dunes, ample 
negative 
space, art-
directed 
sun/earth 
tones
Public hero 16:9–21:9, 
~2400px 
wide high-res 
source
P0 Static ivory + 
authentic 
licensed 
desert still
IMG-02 Distinct 
Arabian 
camel with 
crimson 
woven 
adornment, 
hero portrait
Welcome 
B+C / 
heritage 
portrait
4:5 / 3:4 
high-res
P0 Licensed 
camel close-
up with 
honest 
neutral crop
IMG-03 Macro of 
woven camel 
adornment / 
Sadu-
influenced 
textile
Heritage 
section; 
transition
3:2 or 4:3 
~1800px+
P1 Original 
abstract 
geometry 
pending 
review
IMG-04 Authentic 
camel estate 
working 
scene: 
worker, 
feeding, 
fenced area
How-it-
works/
product 
context
16:9 P1 Clean 
typographic 
explanation 
with UI 
diagram
IMG-05 Calm desert 
closing frame
Closing CTA 16:9 P2 Re-crop 
licensed 
IMG-01 if 
license 
allows
MOTION-01 Independen
t walking 
camel 
artwork — 
Public scroll 
chapter
Transparent 
sprite 
frames/seque
nce or 
P1 Fixed camel 
silhouette/stil
l image

<!-- Source page 10 of 13 -->

Asset ID
Intended 
visual Location
Desired 
source 
format/aspec
t Priority
Fallback if 
missing
not logo lightweight 
vector 
animation; 
design 
decision 
pending
MOTION-02 Light dunes 
foreground/b
ackground 
planes
Public 
chapter
Transparent 
lightweight 
layers
P2 Static dunes
MOTION-03 Small dry 
shrub / 
tumbleweed
Optional 
desert detail
Lightweight 
illustration 
with 
transparent 
background
P3 optional Remove 
entirely
PAT-01 Woven 
Signature 
horizontal 
motif
Divider/Brand 
Book
Editable 
vector, 
bespoke 
original 
geometry
P1 Plain thin 
Deep 
Crimson rule
PAT-02 Woven 
Frame 
secondary 
motif
Editorial 
blocks
Editable 
vector, same 
geometry 
family
P2 Plain subtle 
border
PAT-03 Fragmented 
motif
Rare accents Editable 
vector with 
same source 
motif
P3 optional Omit
DEMO-01 Legitimate 
screenshot/re
cording of 
actual app 
flow or 
clearly 
labeled demo
How it works 
+ investor 
presentation
Crisp 
desktop/mobi
le screenshot 
or muted 
short video
P0 once core 
flow works
Four-step 
static 
explanatory 
visual
Suggested production directory scheme, adapt to repository:
public/
  brand/naqah-official-camel.png
  patterns/woven-signature.svg
  patterns/woven-frame.svg
  images/hero-desert.webp
  images/welcome-camel.webp
  images/heritage-textile.webp
  images/working-estate.webp
  images/closing-desert.webp
  motion/walking-camel/...
  motion/dunes/...
  motion/tumbleweed/...
This is an asset target map, not a claim those files exist in the repository. Do not generate or overwrite 
these names when corresponding assets are missing.

<!-- Source page 11 of 13 -->

Asset licensing log — necessary for investment-ready presentation
For each actual photo/video: asset_id, source_url, photographer/creator, license_name, 
commercial_usage_verified_date, proof/license receipt, model/property release if relevant, 
approved_crops, original_filename, optimized_filename, status. Do not rely on an AI agent's 
memory of the terms; save proof.
## 10 — Copy and verbal experience — examples only
Location Proposed copy Constraint
Public hero اطمئنان، دون انشغال. Approved brand promise
Hero supporting line ناقة تتابع تفاصيل الحلال 
وتوصل لك ما يهم عبر 
مكالمات واضحة.
Proposal; review factual 
accuracy
Public how it works  العامل يتصل. ناقة تستمع وتوثّق. وأنت يوصلك التحديث.
Only if implementation 
matches
Welcome title حيّاك الله في ناقة. Proposal
Welcome CTA ابدأ إعداد مربطك Proposal
First report empty  ما وصل أول تقرير
للحلال إلى الآن.
Must reflect actual backend 
status
Latest update آخر تحديث :[actual 
timestamp]
Must bind to actual 
timestamp; label timezone 
sensibly
Worker-reported health note  أفاد العامل بأن وضحة
ما أكلت بشكل طبيعي.
No veterinary diagnosis
No priority items reported ما وردت ملاحظات مهمة 
في آخر تقرير من 
العامل.
Not “كل شيء سليم 
100%”
Ultimate open ticket مهمة مفتوحة — بانتظار 
تأكيد العامل
Does not auto-close at due 
time
Writing system: Contemporary Saudi, naturally warm, short and clear. First show status and action; deeper 
detail on demand. No AI hype, no excessive exclamation marks, no promises of perfect care.
## 11 — Build order for the AI agent once core functionality is ready
Instruction: polish existing app without rewriting working API routes, database workflows, Twilio 
logic, agent tools, subscription limits or ticket transitions. Begin with a short current-app audit. Create 
a checkpoint/branch and confirm git diff; don't push/deploy without approval.
Stage Work Deliverable/acceptance
0. Audit Inspect current routes, 
components, responsive 
behavior, actual auth and 
data fields
Route inventory + missing-
asset report + safe changes 
list
1. Tokens Apply core colors, type if 
licensed/available, Phosphor 
icon consistency, Arabic RTL
Shared presentation tokens; 
no layout regressions
2. Welcome Add B+C hybrid design 
mapped to actual onboarding 
route
Desktop/mobile welcome with 
real CTA and honest setup 
status

<!-- Source page 12 of 13 -->

Stage Work Deliverable/acceptance
3. Onboarding Restyle existing groups with 
progress, 
error/loading/success visuals
All 7 approved groups 
covered; plan-specific 
schedule correct
4. Dashboard Quiet high-contrast hierarchy; 
real latest data / empty 
states; tickets only Ultimate
Correct Basic/Ultimate state 
mapping; outdoor-friendly 
readability
5. Public storytelling Build marketing site chapters 
with static images first
Site complete without any 
scroll animation
6. Signature motion Add Woven Signature and 
independent scroll camel 
progressively
Smooth, reduced-motion 
capable, non-blocking; mobile 
fallback
7. Polish/QA Device/browser tests, 
accessibility, performance, 
actual call-data demo
No broken flows, no false 
statuses, no unauthorized 
brand changes
Priority rule if time is constrained: real working forms/dashboard > truthful data states > responsive & 
accessible design > images > decorative scroll animation/tumbleweed. Do not sacrifice the core demo to 
finish animation.
AI coding-agent handoff prompt (paste after the app is working)
Use NAQAH_Frontend_Experience_Build_Handoff_v1.0.md as the design/experience 
brief, alongside the master NAQAH product requirements and the existing working code. Do 
not implement immediately. First inspect the repository and give me (1) the current 
route/component inventory, (2) what already satisfies the brief, (3) missing licensed imagery/brand 
assets, and (4) a minimal safe implementation sequence. Then implement only after approval in 
small reviewable phases. Preserve the exact official camel logo, the core brand palette, RTL and 
functional Basic/Ultimate behavior; use Deep Crimson #8F3040 only as a proposed restrained 
editorial accent. Do not touch Twilio, MCP, database/API logic or subscription rules unless 
separately asked. Do not invent test results or fake data. If motion/image assets are absent, use 
clearly labeled placeholders or still fallbacks, not unapproved image substitutions. Test 
desktop/mobile, keyboard navigation, reduced-motion and existing functional flows. At the end 
show changed files, screenshots or descriptions, tests run, and remaining gaps; do not 
commit/push/deploy without permission.
## 12 — Frontend QA / acceptance checklist
- ☐ Real source-of-truth status preserved; no fake updates/AI completion promises.
- ☐ Existing worker inbound report flow and owner outbound notification not changed.
- ☐ Basic and Ultimate behavior visually differentiated correctly; no Ultimate Tickets in Basic.
- ☐ One farm / one worker UX; no phantom extra accounts or mobile-only routes.
- ☐ Welcome B+C works on desktop, tablet and phone, without forced animations.
- ☐ Onboarding supports all approved groups and preserves data on reasonable navigation (subject to 
actual save behavior).
- ☐ Fields have visible labels, real validation feedback, accessible focus indicators, keyboard support.
- ☐ Reports show actual update timestamp and worker attribution; approximate/unknown 
information labeled.
- ☐ Tickets remain open until confirmed by worker and History uses real backend state.
- ☐ Photos are licensed originals or clearly marked placeholders; source ledger exists; no watermarks 
or unlicensed screenshots.
- ☐ Exact approved gold camel logo is preserved; the walking camel is a separate design.
- ☐ Crimson appears in artistic accents only and never substitutes semantic critical alerts.
- ☐ Strong contrast, responsive crop, adequate tap targets and readable Arabic in sunlight.
- ☐ Reduced-motion version is coherent; no scroll trapping, looping tumbleweed or surprise sound.
- ☐ Landing is meaningful with motion disabled and images absent/slow.
- ☐ Lighthouse/performance findings (if tested) recorded honestly; no unsupported performance 
scores.
- ☐ Existing code build, lint, automated tests and manual report/ticket flows pass, or gaps are listed 
accurately.

<!-- Source page 13 of 13 -->

## 13 — Open decisions and approval flags
Topic Current state / explicit question
Deep Crimson Selected art direction but not yet formally 
added to official core palette. Decide whether 
to finalize editorial-only token.
Photography Actual photos, photographer, image 
source/license and crop have not yet been 
selected.
Walking camel Artistic silhouette is a provisional concept; 
actual art, number of frames and 
implementation technique not chosen.
Tumbleweed Optional cultural/environmental test; decide 
to keep/remove after seeing a simple 
static/mock prototype.
Welcome B+C Direction selected; verify exact 
desktop/mobile image/text proportion after 
prototype.
Editorial pattern drawings A+B+C hierarchy selected; bespoke vector 
artwork still needs design and approval.
Final motion parameters Values here are initial recommendations; 
confirm after performance/accessibility 
review.
Brand typography assets Alexandria/Montserrat selection to verify and 
license for web use.
Authentication, payments and signup Not specified by this design document; do not 
invent providers or checkout.
Product requirements Basic callback quota, Basic instructions, extra 
Ultimate update attempts, ticket creation in 
owner inquiry calls, retry 
categories/exhaustion, emergency categories 
behavior and exact Basic schedule window 
remain owner decisions.
AI conversation identity Voice personality defined; precise 
escalation/owner-call style and final voice 
samples not fully approved.
Sign-off rule: New ideas are recorded as PROPOSAL until the product owner explicitly approves. This 
document may be handed to a teammate now, but the chosen design directions should not be mistaken for 
final assets or functional specifications.
## 14 — Reference links and licensing notes
- Aman — reference for restrained luxury/large visual storytelling (inspiration only).
- Aesop Saudi — editorial spacing/material sensitivity (inspiration only).
- Our Habitas AlUla — desert atmosphere/cultural context (inspiration only).
- UNESCO — Traditional weaving of Al Sadu — cultural reference, not permission to reproduce media.
- Unsplash terms and licensing — may be used commercially under terms, with separate third-party 
rights considerations.
- Pexels license — permitted commercial uses and restrictions.
- Adobe Stock usage and licensing — licensed commercial content; exclude editorial-only stock from 
advertising.
- ArabsStock — Saudi-oriented stock source; verify license for each specific asset.
- SPA Camel Festival heritage reference — heritage reference only, not automatically reusable 
marketing imagery.
End of v1.0 frontend handoff.

## Source PDF hyperlink targets

- <https://ich.unesco.org/en/RL/traditional-weaving-of-al-sadu-02158>
- <https://stock.adobe.com/>
- <https://arabsstock.com/>
- <https://www.pexels.com/license/>
- <https://unsplash.com/license>
- <https://www.spa.gov.sa/N2233622>
- <https://helpx.adobe.com/stock/web/common-questions/usage-licensing.html>
- <https://unsplash.com/terms>
- <https://www.ourhabitas.com/alula/>
- <https://sa.aesop.com/>
- <https://www.aman.com/>

<!-- Source PDF SHA-256: 7f9b7a210e4f02d32ebd03b11e44813870246c49258bacadb2b7465d3a8636ed -->
