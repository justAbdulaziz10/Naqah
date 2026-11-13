# Voice bridge hosting runbook

Preparation only: no deployment, paid call, provider probe or migration is authorized here.

## Routing decision: one public voice origin

Keep Next on Vercel; run the bridge on an always-on small VPS in a Gulf/EU region
with a TLS reverse proxy (recommended). Fly.io in a suitable EU region is an alternative;
confirm current regional availability and latency before provisioning. Do not auto-stop it.
Example names below are placeholders, not provisioned domains.

- Twilio `<Stream>` connects to `NAQAH_BRIDGE_PUBLIC_URL=wss://calls.example.com/voice-bridge/media`.
- Next sets `NAQAH_PUBLIC_BASE_URL=https://calls.example.com` for Twilio HTTP callbacks.
- DNS for `calls.example.com` points to the bridge host, **not directly to Vercel**.
- The bridge serves `/voice-bridge/health`, `/voice-bridge/preflight` and the media upgrade.
  All other HTTP paths, including `/api/voice/*`, proxy to Next on Vercel.
- Bridge `NAQAH_BRIDGE_UPSTREAM=https://naqah.vercel.app` is a distinct, direct Next origin.
  Never set upstream to `https://calls.example.com`: that creates a proxy loop.
- The dashboard may remain at `https://naqah.vercel.app`; it is not the public voice origin.

`freeCallPreflight` compares **`https://${new URL(NAQAH_BRIDGE_PUBLIC_URL).host}` exactly
to `outboundConfig().baseUrl`**, the parsed HTTPS `.origin` of `NAQAH_PUBLIC_BASE_URL`.
Thus normalized hostname and any non-default port must match; it is not a comparison
against the Vercel dashboard URL, upstream URL, or a request Host header. Use a bare
HTTPS origin for the base and the exact WSS media URL (no query, fragment or credentials).
Health must also return `publicUrl` equal to the parsed bridge URL's `.href`, and
`maxCallSeconds` equal to Next's configured bridge limit. Keep URL spelling canonical.

The bridge preserves Host, forwarded headers, path/query and body when proxying.
Configure Vercel to accept `calls.example.com` as a custom domain/Host, provision its
certificate as needed, and verify there are no canonical-host redirects. This remains
necessary even though upstream uses the direct Vercel origin. Do not rewrite signed
webhook URLs/bodies. The outer reverse proxy must preserve `X-Twilio-Signature`, Host,
forwarded headers, raw paths and WebSocket upgrades. Public HTTPS/WSS uses valid TLS
on 443; proxy internally to port 3300. Allow >360 seconds for WebSocket connections.

## Environment ownership

- **Both:** identical `NAQAH_BRIDGE_PUBLIC_URL`, `TWILIO_AUTH_TOKEN`,
  `NAQAH_VOICE_SECRET` (at least 32 random bytes); match `NAQAH_CALL_TIME_LIMIT_SECONDS`
  (10–299, otherwise 300). Inject secrets at runtime, never into image layers or logs.
- **Next/Vercel only:** `NAQAH_PUBLIC_BASE_URL`, Twilio account SID/phone number,
  `NAQAH_VOICE_ENGINE=realtime`, mode/locale/allowlist and opt-in calling flags,
  Supabase URL/publishable/service keys and `CRON_SECRET`. Leave scheduling off until approved.
- **Bridge only:** `OPENAI_API_KEY`, `NAQAH_BRIDGE_UPSTREAM`, `PORT=3300`;
  optional DNS order, silence window and realtime voice (`marin` default).
  No Supabase credentials or Twilio account SID are needed here.
- Leave `NAQAH_REALTIME_URL` and `NAQAH_CALL_TRACE_DIR` unset in production.
  The latter explicitly enables local transcript files and must not be used on the host.

Internal session/tool/closed requests (bridge → Next) and preflight (Next → bridge)
share `NAQAH_VOICE_SECRET`: derive a key with HMAC-SHA256(secret, `naqah-bridge-internal`),
then sign `${timestamp}.${rawBody}`. Headers are `x-naqah-bridge-timestamp` (epoch ms)
and `x-naqah-bridge-signature` (hex); ±60 seconds allowed. Synchronize clocks and
rotate both sides together. Twilio upgrade signatures instead use `TWILIO_AUTH_TOKEN`
and the configured public WSS URL. Never expose either secret to the browser.

## Container and host lifecycle

From the repository root: `docker build -t naqah-voice-bridge:local services/voice-bridge`.
The allowlisted context contains only runtime files/manifests; `ws` is the sole pinned
dependency. Node 24 Alpine, non-root `node`, exec-form startup and IPv4-first DNS are defaults.
Inject environment through the host secret manager; publish 3300 only to the TLS proxy.
Use systemd/Docker restart-on-failure/boot; Docker HEALTHCHECK alone does not restart it.
SIGTERM stops accepting connections, closes Twilio/provider sockets, and waits for
bounded closed notices. Exit deadline is 12 seconds; allow at least 15 seconds at the host.
In-flight calls fall back/end on restart: schedule maintenance outside approved call windows.

Illustrative Fly configuration **in this doc only** (not a deployment instruction):
```toml
app = "replace-with-owned-bridge-app"
primary_region = "fra"
kill_signal = "SIGTERM"
kill_timeout = "15s"
[build]
  dockerfile = "Dockerfile" # context: services/voice-bridge
[env]
  PORT = "3300"
  NODE_OPTIONS = "--dns-result-order=ipv4first"
[http_service]
  internal_port = 3300
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1
[[http_service.checks]]
  method = "GET"
  path = "/voice-bridge/health"
  interval = "30s"
  timeout = "5s"
  grace_period = "10s"
```

## Health and monitoring

- Probe `https://calls.example.com/voice-bridge/health` every 30 seconds; alert after
  three failures. Expect `ok`, `publicUrl`, `maxCallSeconds`; this is liveness, not provider readiness.
- Alert on failed approved preflight checks (including `public_bridge_url`, bridge
  configuration and quota). Preflight opens provider connections; it is **not** an offline
  health check. Do not run it here or schedule it without approval.
- Each stream emits exactly one stdout JSON `event=call_ended` with `callSid` last six
  characters only (empty before valid start), `reason`, `durationMs` (since upgrade),
  `workerSpoke`. AMD is not supplied to the bridge, so `amd` is omitted, never inferred.
  No phone numbers, tickets, audio or transcripts appear in this summary.
- Alert on `openai_credit` immediately; alert on `bridge_error` spikes (e.g. ≥3 in 5 min),
  using call-ended summaries only to avoid double counting diagnostic events. Planned
  shutdowns currently map to `bridge_error`; correlate with `server_stopped` diagnostics.
- With scheduling enabled, alert if heartbeat is missing or older than 15 minutes.
  Run read-only as a privileged monitoring role (not anon/authenticated); never log secrets:
```sql
select last_run_at, outcome,
       (last_run_at is null or last_run_at < now() - interval '15 minutes') as stale
from (values ('report-calls')) as expected(job)
left join public.scheduler_heartbeats using (job);
```
Freshness alone is not success: also inspect heartbeat outcome, cron failures and missed calls.
