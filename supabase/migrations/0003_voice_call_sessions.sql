-- NAQAH | ناقة — live call state. Applies on top of 0002_backend_foundation.sql.
--
-- A real call cannot be replayed from the farm on every webhook: a callback or a Basic owner
-- inquiry changes the farm mid-call, and the owner may edit questions while the worker is
-- answering. This row holds where one live call is, so the question list stays fixed for the
-- call, answers stay out of URLs and request logs, and a repeated webhook gets its first reply.
--
-- Working state, not history. No audio and no transcript: `session` is the dialogue position and
-- the structured draft. The row is deleted when Twilio reports the call ended, and stale rows are
-- removed on the next inbound call. Facts reach the farm only through apply_farm_changes.
create table voice_call_sessions (
  call_sid text primary key check (length(call_sid) between 1 and 64),
  farm_id uuid not null references farms (id) on delete cascade,
  party text not null check (party in ('worker', 'owner')),
  locale text not null check (locale in ('ar', 'en')),
  seq integer not null default 0 check (seq >= 0),   -- the Gather the caller is answering
  misses smallint not null default 0 check (misses >= 0),
  session jsonb not null,
  last_response text not null,                       -- TwiML for `seq`, returned to a repeated webhook
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index voice_call_sessions_farm on voice_call_sessions (farm_id);
create index voice_call_sessions_created on voice_call_sessions (created_at);

-- Service only, like voice_events. RLS is on with no policy, so owners and anon cannot reach it.
alter table voice_call_sessions enable row level security;
revoke all on table voice_call_sessions from public, anon, authenticated;
grant all on table voice_call_sessions to service_role;
