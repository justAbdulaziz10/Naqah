# Presentation: one real call (local only)

## Before the room (10 minutes)

1. Tunnel: `ngrok http --url=<your-ngrok-domain> 3302` (leave it running).
2. Stack (wipes and recreates the local database):
   `node scripts/test-call-local.mjs --live --dashboard-call --secrets /tmp/naqah-live-call/secrets.env --public-url https://<your-ngrok-domain> --allow +966500000073 --bridge-port 3302 --max-call-seconds 300`
3. Demo ranch, with today still open for a report:
   `PGHOST=127.0.0.1 PGPORT=54350 PGUSER=postgres node scripts/demo/seed-presentation.mjs --db naqah_test_call --gateway http://127.0.0.1:54352 --worker-phone +966500000073 --end-yesterday`
4. Free checks, no call: `node scripts/preflight-call.mjs --providers --secrets /tmp/naqah-live-call/secrets.env --base https://<your-ngrok-domain> --farm <demo farm id>`. All nine must say PASS.
5. Open `http://127.0.0.1:3301/ar/app`, sign in `demo@naqah.demo` / `naqah-demo-2026`.

The seed writes about three weeks of history: daily reports and findings, briefings, instructions with retries, a
missed report call the worker returned, a No Answer ticket closed by a callback, closed tasks and owner inquiries.
To add the same history to a ranch seeded before it existed, without reseeding (back up first; it only adds rows, and
running it again adds nothing):
`node scripts/demo/enrich-presentation.mjs --db-url postgresql://postgres@127.0.0.1:54350/naqah_test_call --dry-run`,
then the same without `--dry-run`. Reload the Dashboard afterwards.

**Run again after a call:** add `--reset` to step 3, then run step 3 again. A ranch takes one report a day, so
this is the only way to repeat the call. Limits stay: 3 calls an hour, 10 a day, no automatic redial.

## On stage (about 3 minutes)

1. Overview: «مزون مريضة», five open matters, and the last report from yesterday. Today shows «بانتظار التقرير».
2. Press «اتصال حقيقي» → «اتصل الآن». The phone rings. Answer it as أحمد, on speaker.
3. NAQAH: «هلا أحمد، معك مساعد ناقة الآلي لتقرير العزبة. كيف الحلال اليوم؟»
4. Suggested answers (any natural wording works):
   - «الحمد لله كلهم بخير بس مزون للحين تعبانة ووضحة ما تاكل زين» → «سلامتهم.»
   - «عشرين، كاملات»
   - «العلف يمكن خمسة وعشرين كيس، والموية مليانة» (water is never asked)
   - «الشبك صلحناه أمس، سليم» · «زينة» · «الدوا باقي بس قليل»
   - Milk: «يمكن ثلاثين لتر» · Visitors: «لا ما جا أحد»
   - Task: «إيه عزلتها وكلمت البيطري»
5. NAQAH reads the whole summary. Show a correction: «لا، العلف ثلاثين كيس» → «طيب، نعدلها. كيف العلف؟» → «ثلاثين كيس».
6. After the second read-back: «إيه احفظه». NAQAH: «انحفظ التحديث. يعطيك العافية، مع السلامة.» and hangs up.
7. Back on the Dashboard (it refreshes itself within seconds): today's report, Mazoon and Wadha in his words,
   feed 30 bags, medicine low. Open «المكالمات» for the call.

## If something goes wrong

- The button is disabled or shows a reason: read it; it names what to fix (tunnel, bridge, key, number, active call).
- The model can't hear: after three tries NAQAH continues by keypad («بنكمل المكالمة بالأزرار»). Press 1 to save.
- Emergency talk on stage: NAQAH tells the worker to call the owner directly. It never diagnoses.
- Fallback for the room: «محاكاة مكالمة» runs the same conversation without a phone and saves nothing.
