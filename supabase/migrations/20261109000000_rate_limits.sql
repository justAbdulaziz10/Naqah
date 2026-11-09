create table public.rate_limit_buckets (
  key text primary key,
  count integer not null check (count >= 0),
  reset_at timestamptz not null
);
create index rate_limit_buckets_reset_at_idx on public.rate_limit_buckets (reset_at);

alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from anon, authenticated;
grant select, insert, update, delete on table public.rate_limit_buckets to service_role;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  consumed integer;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 240
    or p_limit is null or p_limit < 1
    or p_window_seconds is null or p_window_seconds < 1 then
    return false;
  end if;

  delete from public.rate_limit_buckets where reset_at <= now();

  insert into public.rate_limit_buckets as bucket (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    count = case when bucket.reset_at <= now() then 1 else bucket.count + 1 end,
    reset_at = case when bucket.reset_at <= now() then excluded.reset_at else bucket.reset_at end
  where bucket.reset_at <= now() or bucket.count < p_limit
  returning count into consumed;

  return found;
end;
$$;

create or replace function public.release_rate_limit(p_key text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  update public.rate_limit_buckets
  set count = count - 1
  where key = p_key and count > 0 and reset_at > now();
  return found;
end;
$$;

revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.release_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.release_rate_limit(text) to service_role;
