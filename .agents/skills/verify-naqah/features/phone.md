# Phone line

Settings → Connections shows live phone, WhatsApp, and owner-call status.
`POST /api/voice/inbound` starts a registered worker call; each Gather posts to
`POST /api/voice/turn`, and `POST /api/voice/status` returns 204.

Run `node scripts/verify-naqah.mjs voice --worker-phone '+966…'` against a
server started with `NAQAH_VOICE_SECRET` and `NAQAH_WORKER_PHONE`. Unit tests
exercise the handlers directly with form-encoded requests and mocked provider
fetches. See `docs/integrations/phone.md` for setup and limits.
