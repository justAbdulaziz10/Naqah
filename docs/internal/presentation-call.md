# Presentation: one real call (local only)

> Internal runbook for a supervised presentation call on the local demo stack.

## Before the presentation

1. Start an HTTPS tunnel to the local voice bridge. Set `PUBLIC_ORIGIN` to its HTTPS origin.
2. Set `CALL_SECRETS_FILE` to a private, untracked file and `APPROVED_WORKER_PHONE` to the consenting
   participant's number. Start a fresh local stack from the repository root. This recreates the local database.

   ```sh
   node scripts/test-call-local.mjs --live --dashboard-call --secrets "$CALL_SECRETS_FILE" \
     --public-url "$PUBLIC_ORIGIN" --allow "$APPROVED_WORKER_PHONE" --bridge-port 3302 --max-call-seconds 300
   ```

3. Set `NAQAH_PRESENTATION_EMAIL` and `NAQAH_PRESENTATION_PASSWORD` in the shell environment to
   credentials chosen for the local demo account. Seed the ranch with today still open for a report.

   ```sh
   PGHOST=127.0.0.1 PGPORT=54350 PGUSER=postgres node scripts/demo/seed-presentation.mjs \
     --db naqah_test_call --gateway http://127.0.0.1:54352 --worker-phone "$APPROVED_WORKER_PHONE" --end-yesterday
   ```

4. Set `DEMO_FARM_ID` to the ID of the seeded ranch, then run the preflight checks.

   ```sh
   node scripts/preflight-call.mjs --providers --secrets "$CALL_SECRETS_FILE" \
     --base "$PUBLIC_ORIGIN" --farm "$DEMO_FARM_ID"
   ```

5. Open `http://127.0.0.1:3301/ar/app` and sign in with the local demo credentials.

The seed writes about three weeks of history: daily reports and findings, briefings, instructions with retries, a
missed report call the worker returned, a No Answer ticket closed by a callback, closed tasks and owner inquiries.
To add the same history to a ranch seeded before it existed, without reseeding (back up first; it only adds rows, and
running it again adds nothing):
`node scripts/demo/enrich-presentation.mjs --db-url postgresql://postgres@127.0.0.1:54350/naqah_test_call --dry-run`,
then the same without `--dry-run`. Reload the Dashboard afterwards.

**Run again after a call** by running the seed command with `--reset` to remove the local demo ranch, then running it
again without `--reset`. A ranch normally takes one report a day. Limits stay: 3 calls an hour, 10 a day, no automatic redial.

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
